import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../components/EmptyState.tsx';
import { ErrorState } from '../components/ErrorState.tsx';
import { FilmIcon } from '../components/Icons.tsx';
import { Button } from '../components/ui/Button.tsx';
import { OPENAI_ORIGIN_PATTERN } from '../services/model-defaults.ts';
import { requestHostPermission } from '../services/permissions.ts';
import type { EvidenceFrame } from '../types/analysis.ts';
import type { FriendlyError } from '../types/domain.ts';
import type { DetectionReport, PanelEvent, PanelRequest, PanelResponse } from '../types/messages.ts';
import type { AnalysisSession, MotionAnalysis, MotionEvent, RecreateGuide, RecreatePlatform } from '../types/motion.ts';
import type { AnalysisSource, DetectedVideo, UploadedVideo } from '../types/video.ts';
import { isFriendlyError, localError, unknownError } from '../utils/errors.ts';
import { formatClock } from '../utils/time.ts';
import { AnalysisProgress } from './motion/AnalysisProgress.tsx';
import { EventDetail } from './motion/EventDetail.tsx';
import { EventList } from './motion/EventList.tsx';
import { Overview } from './motion/Overview.tsx';
import { Timeline } from './motion/timeline/Timeline.tsx';
import { UploadDrop } from './motion/UploadDrop.tsx';
import { VideoCard } from './motion/VideoCard.tsx';
import { VideoSelect } from './motion/VideoSelect.tsx';

type Mode = 'detect' | 'upload';

interface Props {
  request<T extends PanelResponse>(payload: PanelRequest): Promise<T>;
  subscribe(listener: (event: PanelEvent) => void): () => void;
  session: AnalysisSession | null;
  analysis: MotionAnalysis | null;
  error: FriendlyError | null;
  connectionReady: boolean;
  onOpenSettings(): void;
}

/**
 * The Analyze screen: the whole product, in one column.
 *
 * It is a small state machine over four situations — nothing detected, a video
 * ready, an analysis running, an analysis done — plus a detail view layered on
 * top. Everything expensive lives in the service worker; this component asks
 * for things and renders what comes back.
 */
export function AnalyzeScreen({
  request,
  subscribe,
  session,
  analysis,
  error,
  connectionReady,
  onOpenSettings,
}: Props) {
  const [mode, setMode] = useState<Mode>('detect');
  const [report, setReport] = useState<DetectionReport | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadedVideo | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [localFailure, setLocalFailure] = useState<FriendlyError | null>(null);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [frames, setFrames] = useState<EvidenceFrame[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [seekFailed, setSeekFailed] = useState(false);

  const running = Boolean(session && !['completed', 'cancelled', 'failed', 'idle'].includes(session.status));
  const analysedVideoId = session?.sourceKind === 'page' ? session.videoId : null;

  // -- Detection -------------------------------------------------------------

  const detect = useCallback(
    async (force = false) => {
      setDetecting(true);
      setLocalFailure(null);
      try {
        const response = await request<PanelResponse & { for: 'panel:detect-videos' }>({
          type: 'panel:detect-videos',
          grantPermission: force,
        });
        setReport(response.report);
        setSelectedVideoId((current) =>
          current && response.report.videos.some((video) => video.id === current)
            ? current
            : (response.report.videos[0]?.id ?? null),
        );
      } catch (caught) {
        setLocalFailure(isFriendlyError(caught) ? caught : unknownError());
      } finally {
        setDetecting(false);
      }
    },
    [request],
  );

  useEffect(() => {
    void detect(false);
  }, [detect]);

  // Live updates: a feed hydrating, a route change, a player upgrading.
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'event:videos') {
          setReport(event.report);
          setSelectedVideoId((current) =>
            current && event.report.videos.some((video) => video.id === current)
              ? current
              : (event.report.videos[0]?.id ?? null),
          );
        }
        if (event.type === 'event:video-gone' && event.videoId === selectedVideoId) {
          setSelectedVideoId(null);
        }
        if (event.type === 'event:tab-changed') {
          setReport(null);
          setSelectedVideoId(null);
          void detect(false);
        }
      }),
    [subscribe, selectedVideoId, detect],
  );

  const selectedVideo: DetectedVideo | null = useMemo(
    () => report?.videos.find((video) => video.id === selectedVideoId) ?? null,
    [report, selectedVideoId],
  );

  // -- Playback sync ---------------------------------------------------------

  /**
   * Sync is asked for only while a completed analysis is on screen. Reporting
   * a page's playhead position when nothing is using it would be pointless
   * traffic and a needless thing to be listening to.
   */
  useEffect(() => {
    if (!analysedVideoId || !analysis) return undefined;
    void request({ type: 'panel:set-sync', videoId: analysedVideoId, enabled: true }).catch(() => undefined);
    return () => {
      void request({ type: 'panel:set-sync', videoId: analysedVideoId, enabled: false }).catch(() => undefined);
    };
  }, [analysedVideoId, analysis, request]);

  const eventsRef = useRef<MotionEvent[]>([]);
  eventsRef.current = analysis?.events ?? [];

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type !== 'event:time') return;
        setCurrentTime(event.currentTime);
        // The active event is whichever the playhead is inside, or the most
        // recent one within a second — long enough to still feel current,
        // short enough not to claim a moment that has passed.
        const active = [...eventsRef.current]
          .reverse()
          .find((entry) => {
            const end = entry.endTime ?? entry.startTime + 1;
            return event.currentTime >= entry.startTime - 0.05 && event.currentTime <= end;
          });
        setActiveEventId(active?.id ?? null);
      }),
    [subscribe],
  );

  // -- Evidence frames -------------------------------------------------------

  const openEvent = useMemo(
    () => analysis?.events.find((event) => event.id === openEventId) ?? null,
    [analysis, openEventId],
  );

  useEffect(() => {
    if (!openEvent) {
      setFrames([]);
      return undefined;
    }
    const ids = [
      openEvent.evidence?.beforeFrameId,
      openEvent.evidence?.duringFrameId,
      openEvent.evidence?.afterFrameId,
    ].filter((id): id is string => Boolean(id));
    if (ids.length === 0) {
      setFrames([]);
      return undefined;
    }

    // Frames live in IndexedDB rather than in this component's state, so a long
    // session does not accumulate megabytes of base64 in the React tree. Every
    // frame id is `<analysisId>:<candidateId>-<role>`, which is what makes the
    // owning analysis recoverable from the event alone — including for an
    // analysis reopened from History days later.
    const analysisId = ids[0]?.split(':')[0];
    if (!analysisId) {
      setFrames([]);
      return undefined;
    }

    let cancelled = false;
    void chrome.runtime
      .sendMessage({ type: 'mi:read-frames', analysisId })
      .then((response: { ok: boolean; data?: EvidenceFrame[] }) => {
        if (cancelled || !response?.ok || !response.data) return;
        setFrames(response.data.filter((frame) => ids.includes(frame.id)));
      })
      .catch(() => {
        if (!cancelled) setFrames([]);
      });

    return () => {
      cancelled = true;
    };
  }, [openEvent]);

  // -- Actions ---------------------------------------------------------------

  const startAnalysis = useCallback(
    async (analysisSource: AnalysisSource) => {
      setLocalFailure(null);
      setOpenEventId(null);
      if (!connectionReady) {
        setLocalFailure(localError('KEY_MISSING'));
        return;
      }
      try {
        await request({ type: 'panel:start-analysis', source: analysisSource });
      } catch (caught) {
        setLocalFailure(isFriendlyError(caught) ? caught : unknownError());
      }
    },
    [connectionReady, request],
  );

  const jumpTo = useCallback(
    async (event: MotionEvent): Promise<boolean> => {
      // An analysis reopened from History has no live video behind it. Saying so
      // beats a button that looks armed and does nothing.
      if (!analysedVideoId) {
        setSeekFailed(true);
        return false;
      }
      setSeekFailed(false);
      try {
        const response = await request<PanelResponse & { for: 'panel:seek' }>({
          type: 'panel:seek',
          videoId: analysedVideoId,
          timestamp: event.startTime,
          play: false,
        });
        // Honest about the outcome: the panel does not move its own playhead
        // and call that success.
        if (!response.outcome.ok) {
          setSeekFailed(true);
          return false;
        }
        setCurrentTime(response.outcome.actualTime);
        return true;
      } catch {
        setSeekFailed(true);
        return false;
      }
    },
    [analysedVideoId, request],
  );

  const recreate = useCallback(
    async (eventId: string, platform: RecreatePlatform): Promise<RecreateGuide> => {
      const response = await request<PanelResponse & { for: 'panel:recreate' }>({
        type: 'panel:recreate',
        eventId,
        platform,
      });
      return response.guide;
    },
    [request],
  );

  const registerUpload = useCallback(
    async (video: UploadedVideo) => {
      setUpload(video);
      await request({ type: 'panel:register-upload', upload: video }).catch(() => undefined);
    },
    [request],
  );

  // -- Render ----------------------------------------------------------------

  if (openEvent && analysis) {
    return (
      <div className="px-3.5 pb-4 pt-1">
        <EventDetail
          event={openEvent}
          frames={frames}
          onBack={() => setOpenEventId(null)}
          onJump={() => jumpTo(openEvent)}
          onRecreate={(platform) => recreate(openEvent.id, platform)}
        />
      </div>
    );
  }

  if (running && session) {
    return (
      <div className="px-3.5 pb-4 pt-2">
        <AnalysisProgress
          session={session}
          onCancel={() => void request({ type: 'panel:cancel-analysis', sessionId: session.id }).catch(() => undefined)}
        />
      </div>
    );
  }

  if (analysis) {
    return (
      <div className="space-y-3.5 px-3.5 pb-4 pt-2">
        <header>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-md font-semibold text-ink">Motion analysis</h2>
            <button
              type="button"
              onClick={() => void request({ type: 'panel:clear-analysis' }).catch(() => undefined)}
              className="rounded-xs px-1 py-0.5 text-2xs text-ink-subtle transition-colors hover:bg-[var(--mi-hover)] hover:text-ink"
            >
              New analysis
            </button>
          </div>
          <p className="tabular mt-0.5 text-xs text-ink-subtle">
            {formatClock(0)} — {formatClock(analysis.video.duration)} · {analysis.events.length}{' '}
            {analysis.events.length === 1 ? 'event' : 'events'}
          </p>
        </header>

        <Timeline
          duration={analysis.video.duration}
          events={analysis.events}
          activeEventId={activeEventId}
          selectedEventId={null}
          videoId={analysedVideoId}
          initialTime={currentTime}
          subscribe={subscribe}
          onSelect={(event) => setOpenEventId(event.id)}
        />

        {seekFailed ? (
          <p className="text-2xs text-critical">The video did not respond to that jump. It may have been replaced.</p>
        ) : null}

        <Overview analysis={analysis} />

        <EventList
          events={analysis.events}
          activeEventId={activeEventId}
          onOpen={(event) => setOpenEventId(event.id)}
          onJump={(event) => void jumpTo(event)}
        />
      </div>
    );
  }

  const rawFailure = error ?? localFailure;
  // A dropped port is a reconnect, not a failure. It resolves itself, and the
  // request layer already retries — showing it would be alarming and useless.
  const failure = rawFailure?.code === 'PORT_CLOSED' ? null : rawFailure;
  const needsSiteAccess = failure?.code === 'PAGE_PERMISSION';
  const cancelled = session?.status === 'cancelled' && !failure;

  return (
    <div className="space-y-3 px-3.5 pb-4 pt-2">
      {cancelled ? (
        <div className="rounded-md border border-line bg-surface-raised px-2.5 py-2" role="status">
          <p className="text-sm font-medium text-ink">Analysis cancelled</p>
          <p className="mt-0.5 text-xs text-ink-muted">Nothing was sent to OpenAI.</p>
        </div>
      ) : null}

      {needsSiteAccess ? (
        <div className="rounded-md border border-line bg-surface-raised px-2.5 py-2.5" role="status">
          <p className="text-sm font-medium text-ink">Not connected to this tab</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            Motion Inspector asks for no site access when you install it, so it needs your go-ahead per tab. Click the
            Motion Inspector toolbar icon on the tab you want to inspect.
          </p>
          <div className="mt-2.5">
            <Button variant="secondary" size="sm" onClick={() => void detect(true)} disabled={detecting}>
              {detecting ? 'Checking…' : 'Try again'}
            </Button>
          </div>
        </div>
      ) : failure ? (
        <ErrorState
          error={failure}
          title={titleForError(failure)}
          {...(failure.code === 'KEY_MISSING' || failure.code === 'OPENAI_PERMISSION'
            ? {
                action: {
                  label: failure.code === 'KEY_MISSING' ? 'Open Settings' : 'Grant access',
                  onClick: () => {
                    if (failure.code === 'KEY_MISSING') {
                      onOpenSettings();
                      return;
                    }
                    void requestHostPermission(OPENAI_ORIGIN_PATTERN.replace('/*', '/'));
                  },
                },
              }
            : {})}
          onDismiss={() => {
            setLocalFailure(null);
            void request({ type: 'panel:clear-analysis' }).catch(() => undefined);
          }}
        />
      ) : null}

      {mode === 'upload' ? (
        <>
          <button
            type="button"
            onClick={() => setMode('detect')}
            className="text-xs text-ink-muted transition-colors hover:text-ink"
          >
            ← Detect a video on this page
          </button>
          <UploadDrop
            upload={upload}
            busy={running}
            onReady={(video) => void registerUpload(video)}
            onClear={() => setUpload(null)}
            onAnalyze={() => {
              if (!upload) return;
              void startAnalysis({ kind: 'upload', uploadId: upload.id, label: upload.name });
            }}
          />
        </>
      ) : report?.unreachable ? (
        <EmptyState
          icon={<FilmIcon size={16} />}
          title="This page can't be inspected"
          body="Chrome does not allow extensions to read its own pages or the Web Store. Open a normal web page, or upload a video file."
        >
          <Button variant="primary" size="sm" onClick={() => setMode('upload')}>
            Upload video
          </Button>
        </EmptyState>
      ) : selectedVideo ? (
        <>
          <VideoSelect videos={report?.videos ?? []} selectedId={selectedVideoId} onSelect={setSelectedVideoId} />
          <VideoCard
            video={selectedVideo}
            currentTime={selectedVideo.currentTime}
            busy={running || detecting}
            onUploadInstead={() => setMode('upload')}
            onAnalyze={() =>
              void startAnalysis({
                kind: 'page',
                videoId: selectedVideo.id,
                tabId: report?.tabId ?? 0,
                label: selectedVideo.title ?? 'Video',
                pageUrl: report?.pageUrl ?? '',
              })
            }
          />
          <button
            type="button"
            onClick={() => void detect(true)}
            className="text-2xs text-ink-subtle transition-colors hover:text-ink"
          >
            Rescan this page
          </button>
        </>
      ) : (
        <>
          <EmptyState
            icon={<FilmIcon size={16} />}
            title={detecting ? 'Looking for videos…' : 'No video detected'}
            body="Open a video on any website and Motion Inspector will analyse its motion, transitions, effects and visual changes."
          >
            <div className="flex gap-1.5">
              <Button variant="primary" size="sm" onClick={() => setMode('upload')}>
                Upload video
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void detect(true)} disabled={detecting}>
                Detect again
              </Button>
            </div>
          </EmptyState>

          <section>
            <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Supported sources</h3>
            <p className="text-xs leading-relaxed text-ink-muted">
              Instagram · YouTube · TikTok · Vimeo · X · Websites · Local videos
            </p>
            <p className="mt-1.5 text-2xs leading-relaxed text-ink-subtle">
              Works with browser-accessible videos and uploaded video files. Some protected or restricted videos may
              require manual upload.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function titleForError(error: FriendlyError): string {
  switch (error.code) {
    case 'KEY_MISSING':
      return 'OpenAI API key required';
    case 'KEY_REJECTED':
      return 'Unable to authenticate';
    case 'ABORTED':
      return 'Analysis cancelled';
    case 'FRAMES_RESTRICTED':
    case 'FRAMES_PROTECTED':
      return 'Frames unavailable';
    case 'VIDEO_INACCESSIBLE':
      return 'Video unavailable';
    case 'UNSUPPORTED_FORMAT':
      return 'Unsupported video format';
    case 'PAGE_PERMISSION':
      return 'Not connected to this tab';
    case 'TAB_UNREACHABLE':
      return "Can't read this tab";
    case 'NO_CANDIDATES':
      return 'Nothing to report';
    default:
      return 'Analysis failed';
  }
}
