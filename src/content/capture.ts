import { VIDEO } from '../config.ts';
import { accumulatePalette, computeMetrics, type FrameSample } from '../analysis/metrics.ts';
import type { AnalysisFrameSize, FrameMetrics } from '../types/analysis.ts';
import { localError } from '../utils/errors.ts';
import { log } from '../utils/logger.ts';

/**
 * Reading frames out of a page video.
 *
 * The uncomfortable truth this module is built around: for a Media Source
 * video — which is most of what people watch — the bytes exist nowhere we can
 * reach except the live element. There is no hidden copy to scrub. Sampling
 * therefore moves the playhead the user is watching, visibly, and the honest
 * response is to say so beforehand (the panel does) and to put everything back
 * afterwards (this module does).
 *
 * Frames never leave this context as pixels. Each one is reduced to a handful
 * of numbers here, and only the two dozen frames finally chosen as evidence are
 * encoded as images.
 */

interface PlaybackState {
  currentTime: number;
  paused: boolean;
}

function capturePlaybackState(video: HTMLVideoElement): PlaybackState {
  return { currentTime: video.currentTime, paused: video.paused };
}

/**
 * One scrub session per analysis, instead of one per sampling call.
 *
 * Every sampling call used to restore playback state in a `finally`. The
 * pipeline calls `sampleFine` once per candidate — up to twenty-six times —
 * plus coarse, medium, evidence, global and thumbnail passes. That was roughly
 * thirty restores per analysis, each an awaited seek back to the user's
 * position followed immediately by a seek away again: several seconds of pure
 * overhead on streamed video, and the viewer watching their frame snap home and
 * leave thirty times.
 *
 * The session is reference-counted rather than a plain flag so that a sampling
 * call made outside an analysis still restores correctly on its own. The
 * service worker takes the outer reference for the duration of the run, which
 * holds the count above zero and defers every intermediate restore to the end.
 */
const sessions = new Map<HTMLVideoElement, { state: PlaybackState; depth: number }>();

function acquire(video: HTMLVideoElement): void {
  const existing = sessions.get(video);
  if (existing) {
    existing.depth += 1;
    return;
  }
  sessions.set(video, { state: capturePlaybackState(video), depth: 1 });
}

async function release(video: HTMLVideoElement): Promise<void> {
  const session = sessions.get(video);
  if (!session) return;
  session.depth -= 1;
  if (session.depth > 0) return;
  sessions.delete(video);
  await restorePlaybackState(video, session.state);
}

/** Opened by the service worker for the length of an analysis. */
export function beginScrubSession(video: HTMLVideoElement): void {
  acquire(video);
}

/**
 * Closed in the orchestrator's `finally`, so the playhead comes home whether
 * the run completed, failed, or was cancelled mid-seek.
 */
export async function endScrubSession(video: HTMLVideoElement): Promise<void> {
  await release(video);
}

export async function restorePlaybackState(video: HTMLVideoElement, state: PlaybackState): Promise<void> {
  try {
    await seekTo(video, state.currentTime);
    if (!state.paused) await video.play().catch(() => undefined);
  } catch (error) {
    log.warn('could not restore playback state', { error: String(error) });
  }
}

/**
 * Seeks and resolves with the time actually reached.
 *
 * Never resolves with the *requested* time: for streamed content the browser
 * may land on a nearby keyframe, and everything downstream — the timeline, the
 * evidence labels, the recreate prompt — depends on knowing where we really
 * are. Reporting the request back would be a small, compounding lie.
 */
export function seekTo(video: HTMLVideoElement, time: number): Promise<number> {
  const target = Math.max(0, Math.min(time, Number.isFinite(video.duration) ? video.duration - 0.01 : time));

  if (Math.abs(video.currentTime - target) < 0.005) return Promise.resolve(video.currentTime);

  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new DOMException('Seek timed out', 'TimeoutError'));
    }, VIDEO.seekTimeoutMs);

    const onSeeked = (): void => {
      cleanup();
      resolve(video.currentTime);
    };
    const onError = (): void => {
      cleanup();
      reject(new Error('Video element reported an error while seeking'));
    };
    function cleanup(): void {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    }

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = target;
  });
}

/**
 * RGBA rather than grayscale.
 *
 * Grayscale alone is blind to a grade change — a warm-to-cool shift at constant
 * brightness moves no luma histogram at all — so the colour signal has to
 * survive this far. The buffer is 9KB per frame at analysis resolution, which
 * is not worth optimising away.
 */
function drawFrame(
  video: HTMLVideoElement,
  context: OffscreenCanvasRenderingContext2D,
  size: AnalysisFrameSize,
): Uint8Array {
  context.drawImage(video, 0, 0, size.width, size.height);
  const { data } = context.getImageData(0, 0, size.width, size.height);
  return new Uint8Array(data.buffer.slice(0));
}

/**
 * Samples the video at the given times and returns per-frame measurements.
 *
 * A seek that times out is skipped rather than fatal — one unreachable frame in
 * a hundred is a gap in the series, not a failed analysis. More than half
 * failing means the element is not really seekable, and that *is* fatal, because
 * every timestamp after it would be fiction.
 */
export async function sampleMetrics(
  video: HTMLVideoElement,
  timestamps: number[],
  size: AnalysisFrameSize,
  signal: AbortSignal,
): Promise<{ metrics: FrameMetrics[]; palette: number[] }> {
  if (timestamps.length === 0) return { metrics: [], palette: [] };

  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw localError('VIDEO_INACCESSIBLE');

  acquire(video);
  const samples: FrameSample[] = [];
  let failures = 0;

  try {
    // A playing video moves under the sampler; pausing makes each `seeked`
    // correspond to exactly the frame we then draw.
    video.pause();

    for (const timestamp of timestamps) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      try {
        const actual = await seekTo(video, timestamp);
        samples.push({ time: actual, rgba: drawFrame(video, context, size), width: size.width, height: size.height });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        failures += 1;
        if (failures > timestamps.length / 2) throw localError('SEEK_FAILED');
      }
    }
  } finally {
    // Restoring is not conditional on success. A cancelled analysis that leaves
    // someone's video parked at 00:04 is a bug, not a detail — but with a
    // session open the restore is deferred to the end of the run rather than
    // happening between every pass.
    await release(video);
  }

  return { metrics: computeMetrics(samples), palette: [...accumulatePalette(samples)] };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read frame'));
    reader.readAsDataURL(blob);
  });
}

/** Encodes the handful of frames that will actually be shown to the model. */
export async function captureFrames(
  video: HTMLVideoElement,
  times: Array<{ id: string; time: number }>,
  maxWidth: number,
  quality: number,
  signal: AbortSignal,
): Promise<Array<{ id: string; time: number; dataUrl: string }>> {
  if (times.length === 0) return [];

  const aspect = video.videoHeight && video.videoWidth ? video.videoHeight / video.videoWidth : 9 / 16;
  const width = Math.min(maxWidth, video.videoWidth || maxWidth);
  const height = Math.max(2, Math.round(width * aspect));

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw localError('VIDEO_INACCESSIBLE');

  acquire(video);
  const frames: Array<{ id: string; time: number; dataUrl: string }> = [];

  try {
    video.pause();
    for (const entry of times) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      try {
        const actual = await seekTo(video, entry.time);
        context.drawImage(video, 0, 0, width, height);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        frames.push({ id: entry.id, time: actual, dataUrl: await blobToDataUrl(blob) });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        log.warn('evidence frame capture failed', { time: entry.time, error: String(error) });
      }
    }
  } finally {
    await release(video);
  }

  return frames;
}
