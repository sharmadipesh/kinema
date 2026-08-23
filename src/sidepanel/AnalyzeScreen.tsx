import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../components/EmptyState.tsx';
import { ErrorState } from '../components/ErrorState.tsx';
import { FilmIcon } from '../components/Icons.tsx';
import { Button } from '../components/ui/Button.tsx';
import { APP_NAME } from '../config.ts';
import { OPENAI_ORIGIN_PATTERN } from '../services/model-defaults.ts';
import { requestHostPermission } from '../services/permissions.ts';
import type { EvidenceFrame } from '../types/analysis.ts';
import type { FriendlyError } from '../types/domain.ts';
import type { DetectionReport, PanelEvent, PanelRequest, PanelResponse } from '../types/messages.ts';
import type {
  AnalysisRole,
  AnalysisSession,
  MotionAnalysis,
  MotionCategory,
  MotionEvent,
  RecreateGuide,
  RecreatePlatform,
} from '../types/motion.ts';
import type { AnalysisSource, DetectedVideo, UploadedVideo } from '../types/video.ts';
import { isFriendlyError, localError, unknownError } from '../utils/errors.ts';
import { formatClock } from '../utils/time.ts';
import { useAnalysisHealth } from '../hooks/useAnalysisHealth.ts';
import { AnalysisProgress } from './motion/AnalysisProgress.tsx';
import { EventDetail } from './motion/EventDetail.tsx';
import { EventList } from './motion/EventList.tsx';
import {
  CoverageSection,
  MotionProfileSection,
  RhythmSection,
  ScenesSection,
  TransitionsSection,
  TypographySection,
} from './motion/AnalysisSections.tsx';
import { Overview } from './motion/Overview.tsx';
import { Timeline } from './motion/timeline/Timeline.tsx';
import { UploadDrop } from './motion/UploadDrop.tsx';
import { VideoCard } from './motion/VideoCard.tsx';
import { VideoSelect } from './motion/VideoSelect.tsx';
import { DetectionInspector } from './motion/DetectionInspector.tsx';
import { CreateView } from './blueprint/CreateView.tsx';
import { EditView } from './blueprint/EditView.tsx';
import { StoryView, useAnalysisFrames } from './blueprint/StoryView.tsx';
import { RoleFilter } from './blueprint/RoleFilter.tsx';
import { ReadinessCheck } from './blueprint/Readiness.tsx';

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
  /**
   * Why a jump did not happen, not merely that it did not.
   *
   * "No source bound" and "the video refused" are different situations with
   * different remedies, and the panel used to report both as "the video did not
   * respond to that jump" — which, for a history entry with nothing attached,
   * blamed a video that was never asked.
   */
  const [seekIssue, setSeekIssue] = useState<'none' | 'no-source' | 'failed'>('none');
  const [categoryFilter, setCategoryFilter] = useState<MotionCategory | null>(null);
  const [resultTab, setResultTab] = useState<ResultTab>('overview');
  const [role, setRole] = useState<AnalysisRole>('all');

  const running = Boolean(session && !['completed', 'cancelled', 'failed', 'idle'].includes(session.status));
  const health = useAnalysisHealth(session, running);
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
        setSelectedVideoId((current) => pickVideo(response.report.videos, current));
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
          setSelectedVideoId((current) => pickVideo(event.report.videos, current));
        }
        if (event.type === 'event:video-gone') {
          setReport((current) =>
            current ? { ...current, videos: current.videos.filter((video) => video.id !== event.videoId) } : current,
          );
          if (event.videoId === selectedVideoId) setSelectedVideoId(null);
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
          .filter((entry) => entry.role === 'primary')
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

  /**
   * Every frame from this analysis, for the Story board's stage thumbnails.
   *
   * `analysis.id` is authoritative. The frame-id split behind it is the
   * fallback for entries written before 2.1 carried an id — and it is only a
   * fallback because it cannot work at all for an analysis that captured no
   * frames, which is exactly when the board most needs to explain itself.
   */
  const analysisId = useMemo(() => {
    if (analysis?.id) return analysis.id;
    const firstFrameId = analysis?.events.find((event) => event.evidence?.frameIds?.length)?.evidence?.frameIds?.[0];
    return firstFrameId?.split(':')[0] ?? null;
  }, [analysis]);
  const allFrames = useAnalysisFrames(analysisId);

  const openEvent = useMemo(
    () => analysis?.events.find((event) => event.id === openEventId) ?? null,
    [analysis, openEventId],
  );

  useEffect(() => {
    if (!openEvent) {
      setFrames([]);
      return undefined;
    }
    const ids = openEvent.evidence?.frameIds ?? [];
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

  const seekTo = useCallback(
    async (timestamp: number): Promise<boolean> => {
      if (!analysedVideoId) {
        setSeekIssue('no-source');
        return false;
      }
      setSeekIssue('none');
      try {
        const response = await request<PanelResponse & { for: 'panel:seek' }>({
          type: 'panel:seek',
          videoId: analysedVideoId,
          timestamp,
          play: false,
        });
        if (!response.outcome.ok) {
          setSeekIssue('failed');
          return false;
        }
        setCurrentTime(response.outcome.actualTime);
        return true;
      } catch {
        setSeekIssue('failed');
        return false;
      }
    },
    [analysedVideoId, request],
  );

  const jumpTo = useCallback(
    async (event: MotionEvent): Promise<boolean> => {
      // An analysis reopened from History has no live video behind it. Saying so
      // beats a button that looks armed and does nothing.
      if (!analysedVideoId) {
        setSeekIssue('no-source');
        return false;
      }
      setSeekIssue('none');
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
          setSeekIssue('failed');
          return false;
        }
        setCurrentTime(response.outcome.actualTime);
        return true;
      } catch {
        setSeekIssue('failed');
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
          secondaries={(analysis.events ?? []).filter((entry) => openEvent.containsIds?.includes(entry.id))}
          frames={frames}
          onBack={() => setOpenEventId(null)}
          onJump={() => jumpTo(openEvent)}
          onSeek={(time) => void seekTo(time)}
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
          health={health}
          onCancel={() => void request({ type: 'panel:cancel-analysis', sessionId: session.id }).catch(() => undefined)}
          onRetryStage={() =>
            void request({ type: 'panel:retry-stage', sessionId: session.id, stage: 'interpretation' }).catch(
              () => undefined,
            )
          }
        />
      </div>
    );
  }

  if (analysis) {
    const blueprint = analysis.blueprint;
    // A tab with nothing behind it is worse than a missing tab: it reads as a
    // broken feature. Story and Create only appear once there is content.
    const tabs: ResultTab[] = [
      'overview',
      ...(blueprint?.storyStages.length ? (['story'] as const) : []),
      ...(blueprint && (blueprint.creativeDirection.length > 0 || blueprint.equipment.length > 0 || blueprint.camera)
        ? (['create'] as const)
        : []),
      ...(blueprint?.editorToolkit?.cutMap.length || blueprint?.editorToolkit?.editMap.length
        ? (['edit'] as const)
        : []),
    ];
    const active = tabs.includes(resultTab) ? resultTab : 'overview';

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
          {analysis.localOnly ? (
            <p className="mt-1.5 rounded-sm bg-surface-sunken px-2 py-1.5 text-2xs leading-relaxed text-caution">
              Interpretation was unavailable, so these are measured changes without a technique reading. Timestamps are
              still accurate.
            </p>
          ) : null}
          <p className="tabular mt-0.5 text-xs text-ink-subtle">
            {formatClock(0)} — {formatClock(analysis.video.duration)} ·{' '}
            {analysis.events.filter((event) => event.role === 'primary').length} events
            {analysis.scenes.length > 1 ? ` · ${analysis.scenes.length} shots` : ''}
          </p>
        </header>

        {tabs.length > 1 ? (
          <nav className="mi-scroll-x -mx-0.5 flex gap-0.5 px-0.5" aria-label="Analysis sections">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setResultTab(tab)}
                aria-current={active === tab ? 'page' : undefined}
                className={[
                  'shrink-0 rounded-sm px-2 py-1 text-xs font-medium capitalize transition-colors duration-fast',
                  active === tab ? 'bg-[var(--mi-hover)] text-ink' : 'text-ink-muted hover:text-ink',
                ].join(' ')}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </nav>
        ) : null}

        {/* The role filter reorders recommendations, so it belongs to the views
            that have some. Overview is measurement, and Story is a fixed
            chronology — a control that visibly does nothing in either is worse
            than one that is simply absent. */}
        {active === 'create' || active === 'edit' ? <RoleFilter role={role} onChange={setRole} /> : null}

        {active === 'story' ? (
          <StoryView
            analysis={analysis}
            frames={allFrames}
            title={session?.label ?? 'Analysis'}
            canSeek={analysedVideoId !== null}
            onSeek={(time) => void seekTo(time)}
          />
        ) : active === 'create' ? (
          <CreateView analysis={analysis} role={role} />
        ) : active === 'edit' ? (
          <EditView analysis={analysis} role={role} onSeek={(time) => void seekTo(time)} />
        ) : (
          <>
        <Timeline
          duration={analysis.video.duration}
          events={analysis.events.filter((event) => event.role === 'primary')}
          activeEventId={activeEventId}
          selectedEventId={null}
          videoId={analysedVideoId}
          initialTime={currentTime}
          subscribe={subscribe}
          onSelect={(event) => setOpenEventId(event.id)}
        />

        {seekIssue === 'no-source' ? (
          <p className="text-2xs text-ink-subtle">
            This analysis is not attached to a live video, so its timestamps cannot be jumped to. Open the page again
            and re-detect to scrub along with it.
          </p>
        ) : seekIssue === 'failed' ? (
          <p className="text-2xs text-critical">The video did not respond to that jump. It may have been replaced.</p>
        ) : null}

        <Overview analysis={analysis} />

        {/* Derived sections, collapsed by default. The timeline is the product;
            these are the supporting argument, not competitors for attention. */}
        <div className="space-y-1.5">
          <RhythmSection
            {...(analysis.rhythm ? { rhythm: analysis.rhythm } : {})}
            {...(analysis.rhythmNote ? { note: analysis.rhythmNote } : {})}
          />
          <ScenesSection scenes={analysis.scenes} onSeek={(time) => void seekTo(time)} />
          <MotionProfileSection profile={analysis.motionProfile} />
          <TransitionsSection
            events={analysis.events}
            activeCategory={categoryFilter}
            onFilter={setCategoryFilter}
          />
          <TypographySection events={analysis.events} onOpen={(event) => setOpenEventId(event.id)} />
          <CoverageSection
            {...(analysis.coverage ? { coverage: analysis.coverage } : {})}
            {...(analysis.blueprint?.unavailable?.length
              ? { unavailable: analysis.blueprint.unavailable }
              : {})}
          />
          <ReadinessCheck analysis={analysis} onJump={setResultTab} />
        </div>

        <EventList
          events={analysis.events}
          activeEventId={activeEventId}
          categoryFilter={categoryFilter}
          onCategoryFilter={setCategoryFilter}
          onOpen={(event) => setOpenEventId(event.id)}
          onJump={(event) => void jumpTo(event)}
        />
          </>
        )}
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
            {APP_NAME} asks for no site access when you install it, so it needs your go-ahead per tab. Click the
            {` ${APP_NAME} `}toolbar icon on the tab you want to inspect.
          </p>
          <div className="mt-2.5">
            <Button variant="secondary" size="sm" onClick={() => void detect(true)} disabled={detecting}>
              {detecting ? 'Checking…' : 'Try again'}
            </Button>
          </div>
        </div>
      ) : failure && session?.resumable ? (
        <div className="rounded-md border border-line bg-surface-raised p-3" role="alert">
          <p className="text-sm font-medium text-ink">{titleForError(failure)}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">{failure.message}</p>
          {/* The distinction worth drawing: the video was measured successfully
              and only the interpretation failed, so retrying costs one model
              call rather than another full scrub. */}
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-subtle">
            The local analysis of this video finished and is preserved.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                void request({
                  type: 'panel:retry-stage',
                  sessionId: session.id,
                  stage: 'interpretation',
                }).catch(() => undefined)
              }
            >
              Retry AI analysis
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLocalFailure(null);
                void request({ type: 'panel:clear-analysis' }).catch(() => undefined);
              }}
            >
              Start over
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
          <DetectionInspector report={report} selectedId={selectedVideoId} analysedId={analysedVideoId} />
        </>
      ) : (
        <>
          <EmptyState
            icon={<FilmIcon size={16} />}
            title={detecting ? 'Looking for videos…' : 'No video detected'}
            body={`Open a video on any website and ${APP_NAME} will analyse its motion, transitions, effects and visual changes.`}
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

          <DetectionInspector report={report} selectedId={selectedVideoId} analysedId={analysedVideoId} />

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

/**
 * Keeps a still-present selection, otherwise takes the scored leader.
 *
 * Deliberately not `videos[0]` on a raw list: the registry now sorts by an
 * actual active-video score, and holding a selection that has left the page
 * would let an analysis start against a reference that no longer resolves.
 */
function pickVideo(videos: DetectedVideo[], current: string | null): string | null {
  if (current && videos.some((video) => video.id === current)) return current;
  return videos.find((video) => video.likelyActive)?.id ?? videos[0]?.id ?? null;
}

type ResultTab = 'overview' | 'story' | 'create' | 'edit';

const TAB_LABELS: Record<ResultTab, string> = {
  overview: 'Overview',
  story: 'Story',
  create: 'Create',
  edit: 'Edit',
};

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
    case 'VIDEO_REPLACED':
      return 'Analysis interrupted';
    case 'STAGE_TIMEOUT':
      return 'A step stopped responding';
    case 'RATE_LIMITED':
      return 'OpenAI limited the request';
    case 'VIDEO_GONE':
      return 'Lost access to this video';
    case 'SEEK_FAILED':
      return "The video couldn't be sampled";
    case 'TAB_UNREACHABLE':
      return "Can't read this tab";
    case 'NO_CANDIDATES':
      return 'Nothing to report';
    default:
      return 'Analysis failed';
  }
}
