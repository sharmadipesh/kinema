import type { FrameMetrics } from '../types/analysis.ts';
import type { MotionDirection } from '../types/motion.ts';
import { DETECTION } from './config.ts';

/**
 * Frame measurement. Pure functions over pixel buffers, no DOM, no messaging —
 * which is what lets the content script, the offscreen document and the Web
 * Worker all share exactly one implementation, and lets the whole thing be
 * unit-tested without a browser.
 *
 * Everything here is a *measurement*. Nothing here decides what an event is
 * called; that is `candidates.ts` (which thresholds these numbers) and the
 * model (which interprets the frames). Keeping the three apart is what lets the
 * product explain why it thinks something happened.
 */

const HISTOGRAM_BINS = 32;

/** Rec. 709 luma, which matches how the eye weights the channels. */
export function toGrayscale(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let index = 0, pixel = 0; pixel < gray.length; pixel += 1, index += 4) {
    gray[pixel] =
      (0.2126 * (rgba[index] ?? 0) + 0.7152 * (rgba[index + 1] ?? 0) + 0.0722 * (rgba[index + 2] ?? 0)) | 0;
  }
  return gray;
}

export function meanLuma(gray: Uint8Array): number {
  if (gray.length === 0) return 0;
  let total = 0;
  for (let index = 0; index < gray.length; index += 1) total += gray[index] ?? 0;
  return total / gray.length / 255;
}

export function histogram(gray: Uint8Array): Float64Array {
  const bins = new Float64Array(HISTOGRAM_BINS);
  if (gray.length === 0) return bins;
  const scale = HISTOGRAM_BINS / 256;
  for (let index = 0; index < gray.length; index += 1) {
    const bin = Math.min(HISTOGRAM_BINS - 1, ((gray[index] ?? 0) * scale) | 0);
    bins[bin] = (bins[bin] ?? 0) + 1;
  }
  for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) bins[bin] = (bins[bin] ?? 0) / gray.length;
  return bins;
}

/**
 * Chi-square distance between two normalised histograms, mapped to 0–1.
 *
 * Preferred over a plain pixel difference for detecting a cut, because it does
 * not care where things moved to — a fast pan changes every pixel while leaving
 * the tonal distribution largely intact, and a cut usually does the opposite.
 * Both signals are used together in `candidates.ts` for exactly that reason.
 */
export function histogramDistance(a: Float64Array, b: Float64Array): number {
  let total = 0;
  for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
    const left = a[bin] ?? 0;
    const right = b[bin] ?? 0;
    const sum = left + right;
    if (sum > 0) total += ((left - right) * (left - right)) / sum;
  }
  // The metric maxes out at 2 for disjoint distributions.
  return Math.min(1, total / 2);
}

export function meanAbsoluteDifference(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let total = 0;
  for (let index = 0; index < length; index += 1) total += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  return total / length / 255;
}

/**
 * Fraction of pixels sitting on a strong gradient.
 *
 * Used as a sanity signal rather than a detector: a frame whose edge density
 * collapses to near zero has gone blank — a fade, a flash, or a decoder that
 * handed us nothing — and that is worth distinguishing from a cut to another
 * detailed shot.
 */
export function edgeDensity(gray: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let strong = 0;
  let counted = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const dx = Math.abs((gray[index + 1] ?? 0) - (gray[index - 1] ?? 0));
      const dy = Math.abs((gray[index + width] ?? 0) - (gray[index - width] ?? 0));
      if (dx + dy > 40) strong += 1;
      counted += 1;
    }
  }
  return counted === 0 ? 0 : strong / counted;
}

export interface MotionEstimate {
  dx: number;
  dy: number;
  magnitude: number;
  divergence: number;
}

const SEARCH_RADIUS = 6;

/** Sum of absolute differences for one block at one candidate shift. */
function blockSad(
  prev: Uint8Array,
  curr: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  shiftX: number,
  shiftY: number,
): number {
  let total = 0;
  let counted = 0;
  for (let y = y0; y < y1; y += 2) {
    const sourceY = y - shiftY;
    if (sourceY < 0 || sourceY >= height) continue;
    for (let x = x0; x < x1; x += 2) {
      const sourceX = x - shiftX;
      if (sourceX < 0 || sourceX >= width) continue;
      total += Math.abs((curr[y * width + x] ?? 0) - (prev[sourceY * width + sourceX] ?? 0));
      counted += 1;
    }
  }
  return counted === 0 ? Number.POSITIVE_INFINITY : total / counted;
}

/**
 * Block-matching motion estimate over four quadrants.
 *
 * Four blocks rather than one, because the *difference* between the quadrant
 * vectors is the interesting part: vectors that agree mean the camera
 * translated, vectors that point outward from the centre mean the frame
 * expanded — a zoom in, or a push. That radial component is `divergence`, and
 * it is the only honest way to tell a zoom from a pan without optical flow.
 *
 * Integer shifts only, on a 64x36 image, sampled every other pixel: roughly
 * 100k operations per frame pair, which is cheap enough to run inline in a
 * content script without stealing a frame from the page.
 */
export function estimateMotion(
  prev: Uint8Array,
  curr: Uint8Array,
  width: number,
  height: number,
): MotionEstimate {
  const halfWidth = width >> 1;
  const halfHeight = height >> 1;
  const quadrants = [
    { x0: 0, y0: 0, x1: halfWidth, y1: halfHeight, cx: -1, cy: -1 },
    { x0: halfWidth, y0: 0, x1: width, y1: halfHeight, cx: 1, cy: -1 },
    { x0: 0, y0: halfHeight, x1: halfWidth, y1: height, cx: -1, cy: 1 },
    { x0: halfWidth, y0: halfHeight, x1: width, y1: height, cx: 1, cy: 1 },
  ];

  const vectors: Array<{ dx: number; dy: number; cx: number; cy: number }> = [];

  for (const quadrant of quadrants) {
    let bestScore = Number.POSITIVE_INFINITY;
    let bestX = 0;
    let bestY = 0;
    for (let shiftY = -SEARCH_RADIUS; shiftY <= SEARCH_RADIUS; shiftY += 1) {
      for (let shiftX = -SEARCH_RADIUS; shiftX <= SEARCH_RADIUS; shiftX += 1) {
        const score = blockSad(
          prev, curr, width, height,
          quadrant.x0, quadrant.y0, quadrant.x1, quadrant.y1,
          shiftX, shiftY,
        );
        /**
         * Ties resolve toward zero motion, explicitly.
         *
         * This is not a nicety. A block with no detail in one axis — a vertical
         * bar pattern, a sky, a letterbox bar — matches equally well at every
         * shift along it, and simply keeping the first winner hands back
         * whichever extreme the loop reached first. That is a confident,
         * fabricated vector for a region that carries no motion information at
         * all, and it would propagate straight into a "direction" the product
         * prints as measured fact.
         */
        const improved = score < bestScore - 1e-6;
        const tiedButSmaller =
          Math.abs(score - bestScore) <= 1e-6 && shiftX * shiftX + shiftY * shiftY < bestX * bestX + bestY * bestY;

        if (improved || tiedButSmaller) {
          bestScore = score;
          bestX = shiftX;
          bestY = shiftY;
        }
      }
    }
    vectors.push({ dx: bestX, dy: bestY, cx: quadrant.cx, cy: quadrant.cy });
  }

  const dx = vectors.reduce((sum, vector) => sum + vector.dx, 0) / vectors.length;
  const dy = vectors.reduce((sum, vector) => sum + vector.dy, 0) / vectors.length;

  // Radial component of each vector once the shared translation is removed.
  const radial =
    vectors.reduce((sum, vector) => {
      const norm = Math.SQRT1_2; // each quadrant centre sits on a 45-degree diagonal
      return sum + ((vector.dx - dx) * vector.cx + (vector.dy - dy) * vector.cy) * norm;
    }, 0) / vectors.length;

  return {
    dx,
    dy,
    magnitude: Math.min(1, Math.hypot(dx, dy) / width),
    divergence: radial / SEARCH_RADIUS,
  };
}

/**
 * Eight-way compass, or a zoom when the radial component dominates.
 *
 * Returns undefined rather than guessing when nothing moved meaningfully —
 * a direction label on a static frame is fabricated precision.
 */
export function describeDirection(estimate: MotionEstimate, width: number): MotionDirection | undefined {
  const translation = Math.hypot(estimate.dx, estimate.dy);
  const zoom = Math.abs(estimate.divergence) * SEARCH_RADIUS;

  if (zoom > translation * (1 / DETECTION.zoomDominance) && zoom > 0.6) {
    return estimate.divergence > 0 ? 'outward' : 'inward';
  }
  // Below a fifth of a search step there is no defensible direction.
  if (translation < Math.max(0.6, width * 0.008)) return undefined;

  const angle = (Math.atan2(estimate.dy, estimate.dx) * 180) / Math.PI;
  const octant = Math.round(((angle + 360) % 360) / 45) % 8;
  return (['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'] as const)[octant];
}

export interface FrameSample {
  time: number;
  gray: Uint8Array;
  width: number;
  height: number;
}

/**
 * Reduces a run of frames to per-frame metrics.
 *
 * The first frame has no predecessor, so its difference fields are zero by
 * definition rather than by omission — `candidates.ts` skips index 0 for
 * exactly that reason.
 */
export function computeMetrics(samples: FrameSample[]): FrameMetrics[] {
  const metrics: FrameMetrics[] = [];
  let previous: FrameSample | null = null;
  let previousHistogram: Float64Array | null = null;

  for (const sample of samples) {
    const bins = histogram(sample.gray);
    const base = {
      time: sample.time,
      meanLuma: meanLuma(sample.gray),
      edgeDensity: edgeDensity(sample.gray, sample.width, sample.height),
    };

    if (!previous || !previousHistogram) {
      metrics.push({
        ...base,
        diff: 0,
        histDiff: 0,
        lumaDelta: 0,
        motionX: 0,
        motionY: 0,
        motionMagnitude: 0,
        divergence: 0,
      });
    } else {
      const motion = estimateMotion(previous.gray, sample.gray, sample.width, sample.height);
      metrics.push({
        ...base,
        diff: meanAbsoluteDifference(previous.gray, sample.gray),
        histDiff: histogramDistance(previousHistogram, bins),
        lumaDelta: base.meanLuma - meanLuma(previous.gray),
        motionX: motion.dx,
        motionY: motion.dy,
        motionMagnitude: motion.magnitude,
        divergence: motion.divergence,
      });
    }

    previous = sample;
    previousHistogram = bins;
  }

  return metrics;
}
