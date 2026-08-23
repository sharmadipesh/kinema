import { VIDEO } from '../config.ts';
import type { AnalysisFrameSize } from '../types/analysis.ts';
import { localError } from '../utils/errors.ts';
import { log } from '../utils/logger.ts';

/**
 * An uploaded video, decoded in the offscreen document.
 *
 * This is the best case the product has, and the reason uploads are offered as
 * the fallback for every restricted page video: the object URL is
 * extension-origin, so the canvas is never tainted, seeking is frame-accurate,
 * and nobody's playback is disturbed because this element is not on screen and
 * nobody is watching it.
 */

interface DecodedFrame {
  time: number;
  /** RGBA at analysis resolution; colour metrics are derived downstream. */
  rgba: Uint8Array;
  width: number;
  height: number;
}

export class OffscreenVideoSource {
  private video: HTMLVideoElement | null = null;
  private objectUrl: string | null = null;

  async load(objectUrl: string): Promise<{ duration: number; width: number; height: number }> {
    this.release();

    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    // Never appended to the document: it is a decoder, not a player.

    /**
     * The object URL was minted by the side panel. Both documents share the
     * extension's origin, so assigning it directly is expected to work — but
     * "expected to" is not a thing to build a pipeline on when the failure mode
     * is a decode error that looks exactly like an unsupported codec.
     *
     * So: try the handed-over URL, and if the element rejects it, re-fetch the
     * blob and mint a local one. The second path proves whether the problem was
     * the handover or the file, and the user gets the accurate message either
     * way.
     */
    const attach = (url: string): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(localError('DECODE_FAILED'));
        }, 20_000);

        const onLoaded = (): void => {
          cleanup();
          resolve();
        };
        const onError = (): void => {
          cleanup();
          reject(localError('UNSUPPORTED_FORMAT'));
        };
        function cleanup(): void {
          clearTimeout(timer);
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError);
        }

        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        video.addEventListener('error', onError, { once: true });
        video.src = url;
        video.load();
      });

    this.video = video;
    this.objectUrl = objectUrl;

    try {
      await attach(objectUrl);
    } catch (error) {
      log.warn('direct object URL failed, re-fetching the blob', { error: String(error) });
      let localUrl: string;
      try {
        localUrl = URL.createObjectURL(await (await fetch(objectUrl)).blob());
      } catch {
        // The blob is genuinely unreachable from here. Report the original
        // failure rather than inventing a new one.
        throw error;
      }
      this.objectUrl = localUrl;
      await attach(localUrl);
    }

    if (!Number.isFinite(video.duration) || video.duration <= 0) throw localError('DECODE_FAILED');

    return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
  }

  /**
   * Measures the real frame rate by watching frames being presented.
   *
   * `requestVideoFrameCallback` reports how many frames the compositor has
   * presented and the media time of each, which makes this an actual
   * measurement rather than a guess. When the API is unavailable, or the sample
   * is too short to be meaningful, it returns null — and the product then shows
   * no frame rate at all, which is the correct thing to show when you do not
   * know one.
   */
  async measureFps(): Promise<number | null> {
    const video = this.requireVideo();
    if (typeof video.requestVideoFrameCallback !== 'function') return null;

    return new Promise<number | null>((resolve) => {
      let firstMediaTime: number | null = null;
      let firstPresented: number | null = null;
      let handle = 0;
      const settle = (value: number | null): void => {
        clearTimeout(timer);
        video.cancelVideoFrameCallback?.(handle);
        video.pause();
        video.currentTime = 0;
        resolve(value);
      };
      const timer = setTimeout(() => settle(null), 3000);

      const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
        if (firstMediaTime === null) {
          firstMediaTime = metadata.mediaTime;
          firstPresented = metadata.presentedFrames;
        } else {
          const elapsed = metadata.mediaTime - firstMediaTime;
          const frames = metadata.presentedFrames - (firstPresented ?? 0);
          if (elapsed > 0.4 && frames > 4) {
            const fps = frames / elapsed;
            // Anything outside this range is a measurement artefact, not a
            // frame rate, and is better reported as unknown.
            settle(fps > 5 && fps < 130 ? Number(fps.toFixed(2)) : null);
            return;
          }
        }
        handle = video.requestVideoFrameCallback(onFrame);
      };

      video.currentTime = 0;
      handle = video.requestVideoFrameCallback(onFrame);
      void video.play().catch(() => settle(null));
    });
  }

  async sample(
    timestamps: number[],
    size: AnalysisFrameSize,
    signal: AbortSignal,
  ): Promise<DecodedFrame[]> {
    const video = this.requireVideo();
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw localError('DECODE_FAILED');

    video.pause();
    const frames: DecodedFrame[] = [];
    let failures = 0;

    for (const timestamp of timestamps) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      try {
        const time = await this.seek(timestamp);
        context.drawImage(video, 0, 0, size.width, size.height);
        const { data } = context.getImageData(0, 0, size.width, size.height);
        frames.push({ time, rgba: new Uint8Array(data.buffer.slice(0)), width: size.width, height: size.height });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        failures += 1;
        if (failures > timestamps.length / 2) throw localError('SEEK_FAILED');
      }
    }

    return frames;
  }

  async capture(
    times: Array<{ id: string; time: number }>,
    maxWidth: number,
    quality: number,
    signal: AbortSignal,
  ): Promise<Array<{ id: string; time: number; dataUrl: string }>> {
    const video = this.requireVideo();
    const aspect = video.videoWidth ? video.videoHeight / video.videoWidth : 9 / 16;
    const width = Math.min(maxWidth, video.videoWidth || maxWidth);
    const height = Math.max(2, Math.round(width * aspect));

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw localError('DECODE_FAILED');

    video.pause();
    const frames: Array<{ id: string; time: number; dataUrl: string }> = [];

    for (const entry of times) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      try {
        const time = await this.seek(entry.time);
        context.drawImage(video, 0, 0, width, height);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        frames.push({ id: entry.id, time, dataUrl: await blobToDataUrl(blob) });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        log.warn('evidence capture failed', { time: entry.time, error: String(error) });
      }
    }

    return frames;
  }

  release(): void {
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
      this.video = null;
    }
    if (this.objectUrl) {
      // The panel created it, but only one context can meaningfully revoke it
      // and this is the one that finished with it.
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  private requireVideo(): HTMLVideoElement {
    if (!this.video) throw localError('NO_VIDEO');
    return this.video;
  }

  private seek(time: number): Promise<number> {
    const video = this.requireVideo();
    const target = Math.max(0, Math.min(time, video.duration - 0.01));
    if (Math.abs(video.currentTime - target) < 0.002) return Promise.resolve(video.currentTime);

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
        reject(new Error('decode error while seeking'));
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
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read frame'));
    reader.readAsDataURL(blob);
  });
}
