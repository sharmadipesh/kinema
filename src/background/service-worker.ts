import { readFrames } from '../storage/frame-store.ts';
import { readHistory } from '../storage/history.ts';
import { generateRecreateGuide } from '../services/transport/openai-transport.ts';
import type { ContentEvent, DetectionReport, PanelEvent, PanelRequest, PanelResponse } from '../types/messages.ts';
import type { ContentReply } from '../types/messages.ts';
import { isFriendlyError, localError, unknownError } from '../utils/errors.ts';
import { createId } from '../utils/id.ts';
import { log } from '../utils/logger.ts';
import { serveRpc } from '../utils/port-rpc.ts';
import { clearAllArtifacts } from './artifacts.ts';
import { registerOffscreenPort, abortOffscreen, closeOffscreen } from './offscreen-host.ts';
import { runAnalysis } from './orchestrator.ts';
import {
  adoptAnalysis,
  advance,
  cancelActive,
  clearAnalysis,
  getState,
  failSession,
  hydrate,
  isTerminal,
  newSession,
  restartSession,
  onStateChanged,
  setUpload,
  startSession,
} from './session-registry.ts';
import {
  activeTab,
  commandVideo,
  ensureInjected,
  findVideo,
  forgetTab,
  forgetVideo,
  getReport,
  scriptability,
  recordDetection,
} from './tab-videos.ts';

/**
 * Service worker — the extension's only privileged context.
 *
 * It owns three things nothing else may: the session lifecycle, the OpenAI
 * call, and storage. It owns the model call specifically so the user's key
 * never has to exist anywhere a page could reach; the build fails if anything
 * under `src/content/` so much as imports the module that reads it.
 *
 * MV3 terminates this worker aggressively, so nothing here assumes module state
 * survives between events. Anything that must persist goes to storage, and the
 * panel and offscreen document hold ports open during a run precisely so the
 * worker is not suspended in the middle of one.
 */

log.info('service worker started', { version: __EXTENSION_VERSION__, mode: __BUILD_MODE__ });

/**
 * Opening the side panel — and, just as importantly, earning the right to read
 * the tab underneath it.
 *
 * `setPanelBehavior({ openPanelOnActionClick: true })` looks like the obvious
 * way to do this, and it is a trap. Chrome consumes the toolbar click itself,
 * so `chrome.action.onClicked` never fires — and with it the extension never
 * receives the `activeTab` grant that clicking the action is supposed to
 * confer. The panel then opens onto a tab it cannot script, cannot read the URL
 * of, and reports as "permission needed" on a perfectly ordinary web page.
 *
 * So the click is handled here instead. `chrome.sidePanel.open()` is called
 * inside the handler, which still counts as the user gesture it requires, and
 * the grant lands where it is needed. The script is injected immediately after,
 * so the panel finds videos already listed rather than racing its own first
 * detection against a permission it does not have yet.
 */
try {
  void chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false }).catch((error: unknown) => {
    log.warn('could not set side panel behaviour', { error: String(error) });
  });
} catch (error) {
  log.warn('side panel API unavailable', { error: String(error) });
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  const tabId = tab.id;

  // Opened first and without an intervening await: `sidePanel.open` must be
  // called synchronously within the gesture or Chrome rejects it.
  void chrome.sidePanel
    .open({ tabId })
    .catch((error: unknown) => log.warn('could not open side panel', { error: String(error) }))
    .then(() => {
      // `activeTab` is granted for this tab now. Force the injection rather
      // than trusting the cache: a previous attempt on this tab may have failed
      // precisely because the grant did not exist yet.
      if (scriptability(tab.url) === 'no') return undefined;
      return ensureInjected(tabId, true).catch(() => undefined);
    });
});

/**
 * Switching tabs with the panel open leaves it describing a tab the user is no
 * longer looking at. The panel is told to look again; whether it may is a
 * separate question, answered by the injection attempt.
 */
chrome.tabs.onActivated.addListener(() => {
  broadcast({ type: 'event:tab-changed' });
});

// -- Panel connections -------------------------------------------------------

const panels = new Set<{ emit(event: unknown): void }>();

function broadcast(event: PanelEvent): void {
  for (const panel of panels) panel.emit(event);
}

onStateChanged((next) => {
  broadcast({ type: 'event:state', state: next });
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'mi:offscreen') {
    registerOffscreenPort(port);
    return;
  }
  if (port.name !== 'mi:panel') return;

  const channel = serveRpc<PanelRequest, PanelResponse>(port, handlePanelRequest);
  panels.add(channel);
  port.onDisconnect.addListener(() => {
    panels.delete(channel);
    log.debug('panel disconnected', { remaining: panels.size });
  });
});

async function handlePanelRequest(request: PanelRequest): Promise<PanelResponse> {
  switch (request.type) {
    case 'panel:get-state':
      return { for: 'panel:get-state', state: await hydrate() };

    case 'panel:detect-videos':
      return { for: 'panel:detect-videos', report: await detect(request.grantPermission) };

    case 'panel:probe-frame-access': {
      const reply = await commandVideo<ContentReply & { for: 'content:probe' }>(request.videoId, {
        type: 'content:probe',
        videoId: request.videoId,
      });
      return {
        for: 'panel:probe-frame-access',
        videoId: reply.videoId,
        frameAccess: reply.frameAccess,
        ...(reply.reason ? { reason: reply.reason } : {}),
      };
    }

    case 'panel:register-upload':
      setUpload(request.upload);
      return { for: 'panel:register-upload' };

    case 'panel:start-analysis': {
      const session = newSession({
        id: createId('session'),
        videoId: request.source.kind === 'page' ? request.source.videoId : request.source.uploadId,
        sourceKind: request.source.kind,
        label: request.source.label,
      });
      const signal = startSession(session, request.source);
      // Deliberately not awaited: the panel gets its session id immediately and
      // watches the run through pushed stage events.
      void runAnalysis({ sessionId: session.id, source: request.source, label: request.source.label, signal });
      return { for: 'panel:start-analysis', session };
    }

    case 'panel:cancel-analysis': {
      const cancelled = cancelActive(request.sessionId);
      if (cancelled) {
        // The abort signal stops this worker's own awaits; these stop the work
        // already running in the other two contexts. Without them the sampler
        // would keep seeking a video nobody is waiting for any more.
        abortOffscreen();
        const state = getState();
        if (state.source?.kind === 'page') {
          await commandVideo(state.source.videoId, { type: 'content:abort', runId: request.sessionId }).catch(
            () => undefined,
          );
        }
        advance(request.sessionId, 'cancelled');
      }
      return { for: 'panel:cancel-analysis', cancelled };
    }

    case 'panel:retry-stage': {
      /**
       * Retry the model work, keep the local work.
       *
       * The whole point of storing artifacts: a rate-limited or timed-out
       * interpretation should cost one call, not a second full scrub of
       * somebody's video. Falls through to a normal run when the artifacts have
       * expired or the analysis version moved on.
       */
      const state = getState();
      if (!state.session || state.session.id !== request.sessionId || !state.source) {
        return { for: 'panel:retry-stage', started: false };
      }
      const signal = restartSession(request.sessionId);
      if (!signal) return { for: 'panel:retry-stage', started: false };

      void runAnalysis({
        sessionId: request.sessionId,
        source: state.source,
        label: state.session.label,
        signal,
        resumeFromArtifacts: request.stage === 'interpretation',
      });
      return { for: 'panel:retry-stage', started: true };
    }

    case 'panel:clear-analysis':
      clearAnalysis();
      void clearAllArtifacts();
      return { for: 'panel:clear-analysis' };

    case 'panel:seek': {
      const reply = await commandVideo<ContentReply & { for: 'content:seek' }>(request.videoId, {
        type: 'content:seek',
        videoId: request.videoId,
        timestamp: request.timestamp,
        play: request.play,
      });
      return { for: 'panel:seek', outcome: reply.outcome };
    }

    case 'panel:set-sync':
      await commandVideo(request.videoId, {
        type: 'content:set-sync',
        videoId: request.videoId,
        enabled: request.enabled,
      });
      return { for: 'panel:set-sync' };

    case 'panel:recreate': {
      const state = getState();
      const event = state.analysis?.events.find((entry) => entry.id === request.eventId);
      if (!state.analysis || !event) throw localError('NO_VIDEO');
      const guide = await generateRecreateGuide({
        event,
        platform: request.platform,
        video: state.analysis.video,
      });
      if (!guide.ok) throw guide.error;
      return { for: 'panel:recreate', guide: guide.data };
    }

    case 'panel:load-history': {
      const item = (await readHistory()).find((entry) => entry.id === request.itemId);
      if (!item) throw localError('NO_VIDEO');
      adoptAnalysis(item.analysis, item.title);
      return { for: 'panel:load-history', analysis: item.analysis };
    }

    default: {
      // Exhaustiveness guard: a new request type without a handler is a compile
      // error rather than a silent no-op.
      const exhaustive: never = request;
      log.warn('unknown panel request', { request: exhaustive });
      throw unknownError();
    }
  }
}

/**
 * Finds videos in the tab the user is looking at.
 *
 * Injection, then a short collection window: each frame reports itself on load,
 * and a page with an embed has more than one frame to hear from. Waiting a
 * fraction of a second beats returning an empty list the user then has to press
 * a button to correct.
 */
async function detect(force: boolean): Promise<DetectionReport> {
  const tab = await activeTab();
  if (!tab?.id) throw localError('TAB_UNREACHABLE');

  // Only a URL we can actually see and know to be off-limits earns the
  // "can't be inspected" message. An unknown URL means no grant yet, so we try
  // — and a failed injection reports the permission problem accurately.
  if (scriptability(tab.url) === 'no') {
    return { tabId: tab.id, pageUrl: tab.url ?? '', siteLabel: 'This page', videos: [], unreachable: true };
  }

  await ensureInjected(tab.id, force);
  await new Promise((resolve) => setTimeout(resolve, 350));

  return (
    getReport(tab.id) ?? {
      tabId: tab.id,
      pageUrl: tab.url ?? '',
      siteLabel: 'This page',
      videos: [],
      unreachable: false,
    }
  );
}

// -- Content script events ---------------------------------------------------

chrome.runtime.onMessage.addListener((message: ContentEvent, sender) => {
  const tabId = sender.tab?.id;
  if (!tabId || typeof message?.type !== 'string' || !message.type.startsWith('content-event:')) return undefined;

  switch (message.type) {
    case 'content-event:videos': {
      const report = recordDetection(tabId, sender.frameId ?? 0, message.videos, message.siteLabel, message.pageUrl);
      broadcast({ type: 'event:videos', report });
      break;
    }
    case 'content-event:time':
      broadcast({
        type: 'event:time',
        videoId: message.videoId,
        currentTime: message.currentTime,
        paused: message.paused,
      });
      break;
    case 'content-event:gone': {
      forgetVideo(tabId, message.videoId);
      broadcast({ type: 'event:video-gone', videoId: message.videoId });

      /**
       * If the analysis was bound to this video, it cannot continue — and it
       * must never quietly continue against a different one. Failing loudly
       * here is the difference between "the page changed" and an analysis whose
       * timestamps silently describe footage nobody asked about.
       */
      const state = getState();
      const session = state.session;
      if (
        session &&
        session.sourceKind === 'page' &&
        session.videoId === message.videoId &&
        !isTerminal(session.status)
      ) {
        log.warn('analysed video disappeared mid-run', { videoId: message.videoId });
        cancelActive(session.id);
        abortOffscreen();
        failSession(session.id, localError('VIDEO_REPLACED'));
      }
      break;
    }
  }
  return undefined;
});

// -- Tab lifecycle -----------------------------------------------------------

chrome.tabs.onRemoved.addListener((tabId) => forgetTab(tabId));

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  /**
   * A document-replacing navigation invalidates every video id from the old
   * one. Keeping them would let a seek land in a page that no longer exists,
   * and `commandVideo` would sit on it for the full three-minute tab timeout.
   *
   * Keyed on `status` alone. Requiring `url` as well missed the plain case —
   * a reload of the same address carries no `url` — while an in-page route
   * change carries `url` with no `status`, and that one must *not* clear the
   * tab: the content script is still alive there and re-announces itself.
   */
  if (changeInfo.status !== 'loading') return;

  /**
   * A session bound to this tab cannot survive the document that owns its
   * video. Nothing else reports this: the content script is destroyed without
   * getting to send `content-event:gone`, so without this the run would hang
   * on a video id that can no longer resolve.
   */
  const state = getState();
  const session = state.session;
  if (session && session.sourceKind === 'page' && !isTerminal(session.status)) {
    const located = findVideo(session.videoId);
    if (located?.tabId === tabId) {
      log.warn('analysed tab navigated away mid-run', { tabId, videoId: session.videoId });
      cancelActive(session.id);
      abortOffscreen();
      failSession(session.id, localError('VIDEO_REPLACED'));
    }
  }

  forgetTab(tabId);
});

chrome.runtime.onSuspend.addListener(() => {
  void closeOffscreen();
});

// -- Panel-only helper -------------------------------------------------------

/**
 * Evidence frames are read straight from IndexedDB by the panel, but History
 * entries opened later need them too and the panel has no session to ask about.
 * Exposed as a plain message so both paths share one implementation.
 */
chrome.runtime.onMessage.addListener((message: { type?: string; analysisId?: string }, _sender, sendResponse) => {
  if (message?.type !== 'mi:read-frames' || typeof message.analysisId !== 'string') return undefined;
  readFrames(message.analysisId)
    .then((frames) => sendResponse({ ok: true, data: frames }))
    .catch((error: unknown) => sendResponse({ ok: false, error: isFriendlyError(error) ? error : unknownError() }));
  return true;
});
