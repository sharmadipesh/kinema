import { EVIDENCE } from '../analysis/config.ts';
import type { AnalysisFrameSize, FrameMetrics } from '../types/analysis.ts';
import type { OffscreenResponse } from '../types/messages.ts';
import type { AnalysisSource, UploadedVideo } from '../types/video.ts';
import type { VideoMetadata } from '../types/motion.ts';
import { localError } from '../utils/errors.ts';
import { offscreenRequest } from './offscreen-host.ts';
import { commandVideo, findVideo } from './tab-videos.ts';
import type { ContentReply } from '../types/messages.ts';

/**
 * The sampling abstraction.
 *
 * Two very different worlds sit behind one interface. An uploaded file is
 * decoded in the offscreen document, where the canvas is never tainted, seeks
 * are accurate and nobody is watching. A page video can only be read from the
 * live element in the tab, which means the user sees it scrub.
 *
 * The pipeline should not care which it is dealing with, and it does not — but
 * it can ask, via `disturbsPlayback`, because the panel has to warn before it
 * starts moving someone's playhead.
 */

export interface FrameSampler {
  readonly id: string;
  /** True when sampling visibly moves a video the user is watching. */
  readonly disturbsPlayback: boolean;
  metadata(): Promise<VideoMetadata>;
  /** Pass A: a wide, cheap sweep to locate activity. */
  sampleCoarse(timestamps: number[], size: AnalysisFrameSize): Promise<FrameMetrics[]>;
  /** Pass B: densifies the regions the coarse pass found busy. */
  sampleMedium(timestamps: number[], size: AnalysisFrameSize): Promise<FrameMetrics[]>;
  /** Pass C: resolves peak and velocity around one candidate. */
  sampleFine(timestamps: number[], size: AnalysisFrameSize): Promise<FrameMetrics[]>;
  captureEvidence(times: Array<{ id: string; time: number }>): Promise<Array<{ id: string; time: number; dataUrl: string }>>;
  thumbnail(time: number): Promise<string | null>;
  /** RGB bins counted while sampling. Empty when nothing was sampled. */
  paletteBins(): number[];
  /**
   * Opens a scrub session for the whole run, so intermediate passes stop
   * restoring the playhead between every sampling call.
   */
  beginSession(): Promise<void>;
  release(): Promise<void>;
}

/** A video playing in a tab. Frames come from the live element. */
class PageSampler implements FrameSampler {
  readonly disturbsPlayback = true;
  private bins: number[] = [];

  constructor(
    readonly id: string,
    private readonly runId: string,
  ) {}

  async metadata(): Promise<VideoMetadata> {
    const located = findVideo(this.id);
    if (!located) throw localError('VIDEO_GONE');
    const { video } = located;
    if (!video.duration || !Number.isFinite(video.duration)) throw localError('VIDEO_INACCESSIBLE');
    // No fps: measuring it would mean playing the user's video for a second to
    // count presented frames, and a number is not worth that. Omitted, not
    // guessed.
    return { duration: video.duration, width: video.width, height: video.height };
  }

  private async sample(timestamps: number[], size: AnalysisFrameSize): Promise<FrameMetrics[]> {
    const reply = await commandVideo<ContentReply & { for: 'content:sample' }>(this.id, {
      type: 'content:sample',
      videoId: this.id,
      timestamps,
      size,
      runId: this.runId,
    });
    this.mergeBins(reply.palette);
    return reply.metrics;
  }

  paletteBins(): number[] {
    return this.bins;
  }

  /** Summed across passes, so the palette reflects the whole video. */
  private mergeBins(bins: number[] | undefined): void {
    if (!bins?.length) return;
    if (this.bins.length === 0) this.bins = [...bins];
    else for (const [index, count] of bins.entries()) this.bins[index] = (this.bins[index] ?? 0) + count;
  }

  sampleCoarse(timestamps: number[], size: AnalysisFrameSize): Promise<FrameMetrics[]> {
    return this.sample(timestamps, size);
  }

  sampleMedium(timestamps: number[], size: AnalysisFrameSize): Promise<FrameMetrics[]> {
    return this.sample(timestamps, size);
  }

  sampleFine(timestamps: number[], size: AnalysisFrameSize): Promise<FrameMetrics[]> {
    return this.sample(timestamps, size);
  }

  async captureEvidence(times: Array<{ id: string; time: number }>) {
    const reply = await commandVideo<ContentReply & { for: 'content:capture' }>(this.id, {
      type: 'content:capture',
      videoId: this.id,
      times,
      maxWidth: EVIDENCE.frameMaxWidth,
      runId: this.runId,
    });
    return reply.frames;
  }

  async thumbnail(time: number): Promise<string | null> {
    const frames = await this.captureEvidence([{ id: 'thumb', time }]);
    return frames[0]?.dataUrl ?? null;
  }

  async beginSession(): Promise<void> {
    await commandVideo(this.id, { type: 'content:begin-scrub', videoId: this.id }).catch(() => undefined);
  }

  async release(): Promise<void> {
    await commandVideo(this.id, { type: 'content:end-scrub', videoId: this.id }).catch(() => undefined);
  }
}

/** A file the user chose. Decoded in the offscreen document. */
class UploadSampler implements FrameSampler {
  readonly disturbsPlayback = false;
  private bins: number[] = [];
  private loaded: { duration: number; width: number; height: number } | null = null;

  constructor(
    readonly id: string,
    private readonly upload: UploadedVideo,
  ) {}

  async metadata(): Promise<VideoMetadata> {
    if (!this.loaded) {
      const response = await offscreenRequest<OffscreenResponse & { for: 'offscreen:load' }>({
        type: 'offscreen:load',
        objectUrl: this.upload.objectUrl,
      });
      this.loaded = { duration: response.duration, width: response.width, height: response.height };
    }

    // fps is measurable here — the file is ours, playing it costs nothing and
    // disturbs nobody. A null result stays null rather than becoming a guess.
    const fps = await offscreenRequest<OffscreenResponse & { for: 'offscreen:measure-fps' }>({
      type: 'offscreen:measure-fps',
    })
      .then((response) => response.fps)
      .catch(() => null);

    return { ...this.loaded, ...(fps !== null ? { fps } : {}) };
  }

  private async sample(timestamps: number[], size: AnalysisFrameSize): Promise<FrameMetrics[]> {
    const response = await offscreenRequest<OffscreenResponse & { for: 'offscreen:sample' }>({
      type: 'offscreen:sample',
      timestamps,
      size,
    });
    this.mergeBins(response.palette);
    return response.metrics;
  }

  paletteBins(): number[] {
    return this.bins;
  }

  private mergeBins(bins: number[] | undefined): void {
    if (!bins?.length) return;
    if (this.bins.length === 0) this.bins = [...bins];
    else for (const [index, count] of bins.entries()) this.bins[index] = (this.bins[index] ?? 0) + count;
  }

  sampleCoarse(timestamps: number[], size: AnalysisFrameSize): Promise<FrameMetrics[]> {
    return this.sample(timestamps, size);
  }

  sampleMedium(timestamps: number[], size: AnalysisFrameSize): Promise<FrameMetrics[]> {
    return this.sample(timestamps, size);
  }

  sampleFine(timestamps: number[], size: AnalysisFrameSize): Promise<FrameMetrics[]> {
    return this.sample(timestamps, size);
  }

  async captureEvidence(times: Array<{ id: string; time: number }>) {
    const response = await offscreenRequest<OffscreenResponse & { for: 'offscreen:capture' }>({
      type: 'offscreen:capture',
      times,
      maxWidth: EVIDENCE.frameMaxWidth,
    });
    return response.frames;
  }

  async thumbnail(time: number): Promise<string | null> {
    const response = await offscreenRequest<OffscreenResponse & { for: 'offscreen:thumbnail' }>({
      type: 'offscreen:thumbnail',
      time,
      maxWidth: 160,
    });
    return response.dataUrl;
  }

  /** Nothing to defer: this element is off-screen and nobody is watching it. */
  async beginSession(): Promise<void> {
    return Promise.resolve();
  }

  async release(): Promise<void> {
    await offscreenRequest({ type: 'offscreen:release' }).catch(() => undefined);
  }
}

export function createSampler(source: AnalysisSource, upload: UploadedVideo | null, runId: string): FrameSampler {
  if (source.kind === 'page') return new PageSampler(source.videoId, runId);
  if (!upload || upload.id !== source.uploadId) throw localError('NO_VIDEO');
  return new UploadSampler(source.uploadId, upload);
}
