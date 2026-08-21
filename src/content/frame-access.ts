import type { FrameAccess, FrameAccessReason } from '../types/video.ts';
import { log } from '../utils/logger.ts';

/**
 * Can we actually read this video's pixels?
 *
 * This is a **capability test, not a bypass**. It draws one frame to a tiny
 * canvas and tries to read it back. If the browser refuses, we accept the
 * refusal and tell the user to upload the file instead. Nothing here touches
 * EME, protected streams, or any security boundary — and nothing should ever be
 * added here that does.
 *
 * Why a probe at all: a video element being present says nothing about whether
 * its frames are readable. A cross-origin source without CORS taints the canvas
 * and `getImageData` throws; a `blob:` source from Media Source Extensions is
 * usually origin-clean and works; encrypted media never works. None of that can
 * be predicted from the hostname, so it is measured, once, per element.
 */

export interface ProbeResult {
  frameAccess: FrameAccess;
  reason?: FrameAccessReason;
}

export function probeFrameAccess(video: HTMLVideoElement): ProbeResult {
  // Encrypted media. We do not attempt to read protected frames, and say so
  // plainly rather than reporting a vague failure.
  if (video.mediaKeys) return { frameAccess: 'restricted', reason: 'protected' };

  // HAVE_CURRENT_DATA. Nothing decoded yet means nothing to test — and an
  // unloaded video is not a restricted one.
  if (video.readyState < 2) return { frameAccess: 'unknown', reason: 'no-frame' };

  const width = 32;
  const height = Math.max(8, Math.round((width * (video.videoHeight || 9)) / (video.videoWidth || 16)));

  try {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return { frameAccess: 'unknown', reason: 'no-frame' };

    context.drawImage(video, 0, 0, width, height);
    // The throwing call. A tainted canvas fails exactly here.
    const { data } = context.getImageData(0, 0, width, height);

    let min = 255;
    let max = 0;
    for (let index = 0; index < data.length; index += 4) {
      const value = data[index] ?? 0;
      if (value < min) min = value;
      if (value > max) max = value;
    }

    if (max - min > 2) return { frameAccess: 'available' };

    /**
     * Perfectly uniform pixels. Two very different things look like this: a
     * genuinely black frame (an intro, a letterboxed pause, t=0 on many
     * encoders) and a protected composition path handing back an empty buffer.
     *
     * Guessing wrong in the pessimistic direction tells a user their video is
     * unreadable when it is fine. So a uniform frame is only called restricted
     * once the video has actually been playing past its opening — otherwise it
     * stays 'unknown' and is probed again later.
     */
    if (!video.paused && video.currentTime > 0.5) return { frameAccess: 'restricted', reason: 'blank' };
    return { frameAccess: 'unknown', reason: 'no-frame' };
  } catch (error) {
    log.debug('frame probe blocked', { error: String(error) });
    return { frameAccess: 'restricted', reason: 'tainted' };
  }
}
