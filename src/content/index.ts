import { VIDEO } from '../config.ts';
import { EVIDENCE } from '../analysis/config.ts';
import type { ContentCommand, ContentEvent, ContentReply, Result } from '../types/messages.ts';
import { isFriendlyError, localError, unknownError } from '../utils/errors.ts';
import { log } from '../utils/logger.ts';
import { debounce, rateLimit } from '../utils/schedule.ts';
import {
  beginScrubSession,
  captureFrames,
  endScrubSession,
  restorePlaybackState,
  sampleMetrics,
  seekTo,
} from './capture.ts';
import { probeFrameAccess } from './frame-access.ts';
import { hasNavigated, routeKeyOf } from './navigation.ts';
import { snapshot, watchElement } from './video-registry.ts';

/**
 * Content script.
 *
 * This bundle renders nothing and holds no credential. It is the only context
 * that can touch a page's video element, so it owns exactly four jobs:
 * discovery, seeking, time reporting, and frame capture. Everything else — the
 * pipeline, the model call, the UI — happens elsewhere.
 *
 * Design rules it exists to enforce:
 *
 *  - The page keeps working exactly as before. Every listener is passive; no
 *    site handler is wrapped, replaced, or prevented.
 *  - Nothing is sampled without an explicit user action upstream. Being
 *    injected does not start anything; detection is a read, and a read only.
 *  - Playback state is always restored, including when an analysis is cancelled
 *    halfway through.
 */

const INJECTION_FLAG = '__motionInspectorInjected';

interface GlobalWithFlag {
  [INJECTION_FLAG]?: boolean;
}

function alreadyInjected(): boolean {
  const scope = window as unknown as GlobalWithFlag;
  if (scope[INJECTION_FLAG]) return true;
  scope[INJECTION_FLAG] = true;
  return false;
}

if (alreadyInjected()) {
  log.debug('already injected, skipping');
} else {
  bootstrap();
}

function bootstrap(): void {
  log.info('content script ready', { frame: window.top === window.self ? 'top' : 'sub' });

  /** Latest element map. Rebuilt on every scan; ids are stable across rebuilds. */
  let elements = new Map<string, HTMLVideoElement>();
  /** Ids from the previous scan, so a disappearance can be reported rather than inferred. */
  let knownIds = new Set<string>();
  /** Per-run abort, so a cancelled analysis stops seeking immediately. */
  const runs = new Map<string, AbortController>();
  let syncing: { videoId: string; video: HTMLVideoElement; stop(): void } | null = null;

  function scanAndReport(probe: boolean): ContentReply & { for: 'content:detect' } {
    /**
     * Every element gets lifecycle listeners, including ones seen before —
     * `watchElement` is idempotent via a WeakSet. This is what makes an
     * in-place source swap observable at all: a feed that recycles one
     * `<video>` fires no DOM mutation, so without these the registry would go
     * on serving the previous clip's identity indefinitely.
     */
    const result = snapshot({ probe, onElement: (video) => watchElement(video, onVideoChanged) });
    elements = result.elements;

    /**
     * A video that has left the page is reported, not merely forgotten. The
     * panel needs to know so an analysis bound to it can say so, instead of
     * discovering the loss later when a seek fails.
     */
    const currentIds = new Set(result.videos.map((video) => video.id));
    for (const id of knownIds) {
      if (!currentIds.has(id)) push({ type: 'content-event:gone', videoId: id });
    }
    knownIds = currentIds;

    return { for: 'content:detect', videos: result.videos, siteLabel: result.siteLabel, pageUrl: location.href };
  }

  function push(event: ContentEvent): void {
    try {
      if (!chrome.runtime?.id) return;
      void chrome.runtime.sendMessage(event).catch(() => undefined);
    } catch {
      // The extension was reloaded. Nothing to do from here.
    }
  }

  function announce(): void {
    const detected = scanAndReport(true);
    push({
      type: 'content-event:videos',
      videos: detected.videos,
      siteLabel: detected.siteLabel,
      pageUrl: detected.pageUrl,
    });
  }

  function require(videoId: string): HTMLVideoElement {
    const element = elements.get(videoId);
    if (element?.isConnected) return element;
    // One rescan before giving up: a single-page app may have re-rendered the
    // player without changing its source, in which case the id still resolves.
    scanAndReport(false);
    const retry = elements.get(videoId);
    if (retry?.isConnected) return retry;
    throw localError('VIDEO_GONE');
  }

  // -- Live discovery --------------------------------------------------------

  /**
   * Videos appear late and often: a feed hydrates, a player upgrades from a
   * poster, a route changes. Announcing on a debounce keeps the panel honest
   * without turning every mutation into a message.
   */
  const announceSoon = debounce(announce, 400);

  /**
   * Coalesced: a single source swap fires loadstart, emptied, durationchange
   * and loadedmetadata in quick succession, and each would otherwise trigger
   * its own full scan.
   */
  const onVideoChanged = (): void => announceSoon();

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof HTMLVideoElement) {
        announceSoon();
        return;
      }
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && (node.tagName === 'VIDEO' || node.querySelector?.('video'))) {
          announceSoon();
          return;
        }
      }
      for (const node of record.removedNodes) {
        if (node instanceof HTMLElement && (node.tagName === 'VIDEO' || node.querySelector?.('video'))) {
          announceSoon();
          return;
        }
      }
    }
  });
  /**
   * `src` is watched as well as the tree.
   *
   * Covers pages that swap a plain progressive source in place. It does not
   * cover Media Source playback, where `currentSrc` is a blob URL that changes
   * with no attribute mutation at all — the element listeners in
   * `watchElement` are what catch that, and they are the load-bearing half.
   */
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
  });

  /**
   * Single-page navigation. History methods are patched to emit an event so the
   * extension can react without polling `location` — the originals are called
   * first and restored on teardown, so the page's own routing is untouched.
   */
  const emitNavigation = (): void => {
    window.dispatchEvent(new Event('mi:navigation'));
  };
  const routeKey = (): string => routeKeyOf(location);
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);
  history.pushState = function patched(...args: Parameters<History['pushState']>) {
    originalPushState(...args);
    emitNavigation();
  };
  history.replaceState = function patched(...args: Parameters<History['replaceState']>) {
    originalReplaceState(...args);
    emitNavigation();
  };
  window.addEventListener('popstate', emitNavigation);

  let lastRoute = routeKey();
  const onNavigation = debounce(() => {
    const next = routeKey();
    if (!hasNavigated(lastRoute, next)) return;
    lastRoute = next;
    stopSync();
    announce();
  }, 250);
  window.addEventListener('mi:navigation', onNavigation);

  // -- Playback sync ---------------------------------------------------------

  /**
   * `timeupdate` fires about four times a second, which is already the right
   * rate for a playhead a person is watching. The rate limit is belt and braces
   * for browsers that fire it faster, and costs nothing when they do not.
   */
  function startSync(videoId: string): void {
    stopSync();
    const video = require(videoId);
    const send = rateLimit(() => {
      push({ type: 'content-event:time', videoId, currentTime: video.currentTime, paused: video.paused });
    }, VIDEO.syncIntervalMs);

    const onEnded = (): void => push({ type: 'content-event:time', videoId, currentTime: video.currentTime, paused: true });

    video.addEventListener('timeupdate', send, { passive: true });
    video.addEventListener('seeked', send, { passive: true });
    video.addEventListener('play', send, { passive: true });
    video.addEventListener('pause', send, { passive: true });
    video.addEventListener('ended', onEnded, { passive: true });

    syncing = {
      videoId,
      video,
      stop() {
        video.removeEventListener('timeupdate', send);
        video.removeEventListener('seeked', send);
        video.removeEventListener('play', send);
        video.removeEventListener('pause', send);
        video.removeEventListener('ended', onEnded);
      },
    };
    send();
  }

  function stopSync(): void {
    syncing?.stop();
    syncing = null;
  }

  // -- Command handling ------------------------------------------------------

  async function handle(command: ContentCommand): Promise<ContentReply> {
    switch (command.type) {
      case 'content:detect':
        return scanAndReport(true);

      case 'content:probe': {
        const result = probeFrameAccess(require(command.videoId));
        return {
          for: 'content:probe',
          videoId: command.videoId,
          frameAccess: result.frameAccess,
          ...(result.reason ? { reason: result.reason } : {}),
        };
      }

      case 'content:seek': {
        const video = require(command.videoId);
        try {
          const actualTime = await seekTo(video, command.timestamp);
          if (command.play) await video.play().catch(() => undefined);
          return { for: 'content:seek', outcome: { ok: true, actualTime } };
        } catch (error) {
          // Reported honestly: the panel shows that the jump did not happen
          // rather than moving its own playhead and pretending.
          return {
            for: 'content:seek',
            outcome: { ok: false, actualTime: video.currentTime, reason: String(error) },
          };
        }
      }

      case 'content:set-sync':
        if (command.enabled) startSync(command.videoId);
        else stopSync();
        return { for: 'content:set-sync' };

      case 'content:sample': {
        const controller = new AbortController();
        runs.set(command.runId, controller);
        try {
          const sampled = await sampleMetrics(require(command.videoId), command.timestamps, command.size, controller.signal);
          return { for: 'content:sample', metrics: sampled.metrics, palette: sampled.palette };
        } finally {
          runs.delete(command.runId);
        }
      }

      case 'content:capture': {
        const controller = new AbortController();
        runs.set(command.runId, controller);
        try {
          const frames = await captureFrames(
            require(command.videoId),
            command.times,
            command.maxWidth,
            EVIDENCE.jpegQuality,
            controller.signal,
          );
          return { for: 'content:capture', frames };
        } finally {
          runs.delete(command.runId);
        }
      }

      case 'content:begin-scrub':
        beginScrubSession(require(command.videoId));
        return { for: 'content:begin-scrub' };

      case 'content:end-scrub': {
        // Best effort: the element may already be gone if the page navigated
        // mid-run, and failing to restore a video that no longer exists is not
        // a failure worth surfacing.
        const video = elements.get(command.videoId);
        if (video?.isConnected) await endScrubSession(video);
        return { for: 'content:end-scrub' };
      }

      case 'content:restore': {
        const video = elements.get(command.videoId);
        if (video?.isConnected) await restorePlaybackState(video, { currentTime: video.currentTime, paused: video.paused });
        return { for: 'content:restore' };
      }

      case 'content:abort': {
        runs.get(command.runId)?.abort(new DOMException('Cancelled by user', 'AbortError'));
        runs.delete(command.runId);
        return { for: 'content:abort' };
      }

      default: {
        // Exhaustiveness guard: adding a command without handling it here
        // becomes a compile error rather than a silent no-op.
        const exhaustive: never = command;
        throw new Error(`unhandled command ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  chrome.runtime.onMessage.addListener((message: ContentCommand, _sender, sendResponse: (r: Result<ContentReply>) => void) => {
    if (!message || typeof message.type !== 'string' || !message.type.startsWith('content:')) {
      return undefined;
    }

    handle(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) => {
        log.warn('command failed', { type: message.type, error: String(error) });
        sendResponse({ ok: false, error: isFriendlyError(error) ? error : unknownError() });
      });
    return true;
  });

  // -- Lifecycle -------------------------------------------------------------

  const teardown = (): void => {
    observer.disconnect();
    stopSync();
    for (const controller of runs.values()) controller.abort(new DOMException('Page closing', 'AbortError'));
    runs.clear();
    announceSoon.cancel();
    onNavigation.cancel();
    window.removeEventListener('mi:navigation', onNavigation);
    window.removeEventListener('popstate', emitNavigation);
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
  };
  window.addEventListener('pagehide', teardown, { once: true });

  // Announced immediately, not on the debounce: the service worker's detection
  // window is shorter than the debounce, so routing the boot announce through
  // it meant the first detect after injection always came back empty.
  announce();
}
