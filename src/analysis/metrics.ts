import type { FrameMetrics } from '../types/analysis.ts';
import { accumulate, createAccumulator, type PaletteAccumulator } from './palette.ts';
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
/** 4x4x4 RGB. Coarse on purpose: this is for grade shifts, not colour science. */
const RGB_BINS = 4;
const CHROMA_BINS = RGB_BINS * RGB_BINS * RGB_BINS;

/** Rec. 709 luma, which matches how the eye weights the channels. */
export function toGrayscale(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
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
 * Coarse RGB histogram.
 *
 * Exists because luma is blind to the thing colourists spend their day on: a
 * warm-to-cool grade shift at constant brightness moves the luma histogram
 * barely at all. Four levels per channel is enough to see a palette move and
 * cheap enough to run on every sampled frame.
 */
export function chromaHistogram(rgba: Uint8ClampedArray | Uint8Array, pixels: number): Float64Array {
  const bins = new Float64Array(CHROMA_BINS);
  if (pixels === 0) return bins;
  for (let pixel = 0, index = 0; pixel < pixels; pixel += 1, index += 4) {
    const r = ((rgba[index] ?? 0) * RGB_BINS) >> 8;
    const g = ((rgba[index + 1] ?? 0) * RGB_BINS) >> 8;
    const b = ((rgba[index + 2] ?? 0) * RGB_BINS) >> 8;
    const bin = (r * RGB_BINS + g) * RGB_BINS + b;
    bins[bin] = (bins[bin] ?? 0) + 1;
  }
  for (let bin = 0; bin < CHROMA_BINS; bin += 1) bins[bin] = (bins[bin] ?? 0) / pixels;
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
  const bins = Math.min(a.length, b.length);
  for (let bin = 0; bin < bins; bin += 1) {
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
 * Two jobs. A frame whose edge density collapses has gone blank — a fade, a
 * flash, a decoder that handed us nothing. And a frame whose edge density drops
 * *while it is moving* has gone soft, which is the only direct evidence of
 * motion blur available from pixels alone, and the difference between calling
 * something a whip pan and merely a fast cut.
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

// -- Motion ------------------------------------------------------------------

export interface MotionEstimate {
  dx: number;
  dy: number;
  magnitude: number;
  divergence: number;
  /** True when the search hit its limit: the real motion is at least this fast. */
  saturated: boolean;
}

/** Coarse-level search radius. Doubled by the pyramid, so ±6 here reaches ±12. */
const COARSE_RADIUS = 6;
/** Refinement radius at full resolution, around the coarse result. */
const FINE_RADIUS = 2;

/** 2x2 box downsample. Halves the resolution, doubles the effective search range. */
function halve(gray: Uint8Array, width: number, height: number): { gray: Uint8Array; width: number; height: number } {
  const w = width >> 1;
  const h = height >> 1;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const source = (y * 2) * width + x * 2;
      out[y * w + x] =
        (((gray[source] ?? 0) + (gray[source + 1] ?? 0) + (gray[source + width] ?? 0) + (gray[source + width + 1] ?? 0)) >> 2);
    }
  }
  return { gray: out, width: w, height: h };
}

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
  step: number,
): number {
  let total = 0;
  let counted = 0;
  for (let y = y0; y < y1; y += step) {
    const sourceY = y - shiftY;
    if (sourceY < 0 || sourceY >= height) continue;
    for (let x = x0; x < x1; x += step) {
      const sourceX = x - shiftX;
      if (sourceX < 0 || sourceX >= width) continue;
      total += Math.abs((curr[y * width + x] ?? 0) - (prev[sourceY * width + sourceX] ?? 0));
      counted += 1;
    }
  }
  return counted === 0 ? Number.POSITIVE_INFINITY : total / counted;
}

interface Block {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
}

function quadrants(width: number, height: number): Block[] {
  const halfWidth = width >> 1;
  const halfHeight = height >> 1;
  return [
    { x0: 0, y0: 0, x1: halfWidth, y1: halfHeight, cx: -1, cy: -1 },
    { x0: halfWidth, y0: 0, x1: width, y1: halfHeight, cx: 1, cy: -1 },
    { x0: 0, y0: halfHeight, x1: halfWidth, y1: height, cx: -1, cy: 1 },
    { x0: halfWidth, y0: halfHeight, x1: width, y1: height, cx: 1, cy: 1 },
  ];
}

function search(
  prev: Uint8Array,
  curr: Uint8Array,
  width: number,
  height: number,
  block: Block,
  centreX: number,
  centreY: number,
  radius: number,
  step: number,
): { dx: number; dy: number; atLimit: boolean } {
  let bestScore = Number.POSITIVE_INFINITY;
  let bestX = centreX;
  let bestY = centreY;

  for (let shiftY = centreY - radius; shiftY <= centreY + radius; shiftY += 1) {
    for (let shiftX = centreX - radius; shiftX <= centreX + radius; shiftX += 1) {
      const score = blockSad(prev, curr, width, height, block.x0, block.y0, block.x1, block.y1, shiftX, shiftY, step);

      /**
       * Ties resolve toward zero motion, explicitly.
       *
       * A block with no detail in one axis — a vertical bar pattern, a sky, a
       * letterbox bar — matches equally well at every shift along it, and
       * simply keeping the first winner hands back whichever extreme the loop
       * reached first. That is a confident, fabricated vector for a region that
       * carries no motion information at all.
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

  return {
    dx: bestX,
    dy: bestY,
    atLimit: Math.abs(bestX - centreX) === radius || Math.abs(bestY - centreY) === radius,
  };
}

/**
 * Hierarchical block-matching motion estimate over four quadrants.
 *
 * Two levels, because a single-level ±6 search saturates at about 9% of frame
 * width per sample — and a whip pan blows straight through that, pinning every
 * fast movement at the same reported magnitude. Searching a half-resolution
 * copy first buys ±12, then a ±2 refinement at full resolution recovers the
 * precision the downsample cost. Range roughly triples for about a third more
 * work, because the coarse pass runs on a quarter of the pixels.
 *
 * Four blocks rather than one, because the *difference* between the quadrant
 * vectors is the interesting part: vectors that agree mean the camera
 * translated, vectors that point outward from the centre mean the frame
 * expanded — a zoom in, or a push. That radial component is `divergence`, and
 * it is the only honest way to tell a zoom from a pan without optical flow.
 */
export function estimateMotion(
  prev: Uint8Array,
  curr: Uint8Array,
  width: number,
  height: number,
): MotionEstimate {
  const smallPrev = halve(prev, width, height);
  const smallCurr = halve(curr, width, height);

  const vectors: Array<{ dx: number; dy: number; cx: number; cy: number }> = [];
  let saturated = false;

  const smallBlocks = quadrants(smallPrev.width, smallPrev.height);
  const fullBlocks = quadrants(width, height);

  for (let index = 0; index < fullBlocks.length; index += 1) {
    const smallBlock = smallBlocks[index];
    const fullBlock = fullBlocks[index];
    if (!smallBlock || !fullBlock) continue;

    const coarse = search(
      smallPrev.gray, smallCurr.gray, smallPrev.width, smallPrev.height,
      smallBlock, 0, 0, COARSE_RADIUS, 1,
    );
    if (coarse.atLimit) saturated = true;

    const fine = search(
      prev, curr, width, height,
      fullBlock, coarse.dx * 2, coarse.dy * 2, FINE_RADIUS, 2,
    );

    vectors.push({ dx: fine.dx, dy: fine.dy, cx: fullBlock.cx, cy: fullBlock.cy });
  }

  if (vectors.length === 0) return { dx: 0, dy: 0, magnitude: 0, divergence: 0, saturated: false };

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
    divergence: radial / (COARSE_RADIUS * 2),
    saturated,
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
  const zoom = Math.abs(estimate.divergence) * COARSE_RADIUS * 2;

  if (zoom > translation * (1 / DETECTION.zoomDominance) && zoom > 0.6) {
    return estimate.divergence > 0 ? 'outward' : 'inward';
  }
  // Below a fifth of a search step there is no defensible direction.
  if (translation < Math.max(0.6, width * 0.008)) return undefined;

  const angle = (Math.atan2(estimate.dy, estimate.dx) * 180) / Math.PI;
  const octant = Math.round(((angle + 360) % 360) / 45) % 8;
  return (['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'] as const)[octant];
}

// -- Series ------------------------------------------------------------------

export interface FrameSample {
  time: number;
  /** RGBA at analysis resolution. Grayscale and chroma are both derived here. */
  rgba: Uint8Array;
  width: number;
  height: number;
}

/**
 * Reduces a run of frames to per-frame measurements.
 *
 * The first frame has no predecessor, so its difference fields are zero by
 * definition rather than by omission — `candidates.ts` skips index 0 for
 * exactly that reason.
 *
 * Differences are also reported per second (`motionVelocity`) as well as per
 * sample, because the sampler no longer uses one interval for the whole video
 * and a raw per-sample displacement stopped being comparable the moment that
 * changed.
 */
/**
 * Colour counted while the frames are already in hand.
 *
 * Folded into the metrics pass rather than run separately because the pixels
 * are decoded exactly once, here — sampling again purely to count colours would
 * mean a second scrub of the user's video for information already on screen.
 */
export function accumulatePalette(samples: FrameSample[], into: PaletteAccumulator = createAccumulator()): PaletteAccumulator {
  for (const sample of samples) accumulate(into, sample.rgba, sample.width * sample.height);
  return into;
}

export function computeMetrics(samples: FrameSample[]): FrameMetrics[] {
  const metrics: FrameMetrics[] = [];

  let previousGray: Uint8Array | null = null;
  let previousHistogram: Float64Array | null = null;
  let previousChroma: Float64Array | null = null;
  let previousLuma = 0;
  let previousEdges = 0;
  let previousTime = 0;

  for (const sample of samples) {
    const pixels = sample.width * sample.height;
    const gray = toGrayscale(sample.rgba, sample.width, sample.height);
    const bins = histogram(gray);
    const chroma = chromaHistogram(sample.rgba, pixels);
    const luma = meanLuma(gray);
    const edges = edgeDensity(gray, sample.width, sample.height);
    const interval = previousGray ? Math.max(1e-3, sample.time - previousTime) : 0;

    if (!previousGray || !previousHistogram || !previousChroma) {
      metrics.push({
        time: sample.time,
        interval: 0,
        meanLuma: luma,
        edgeDensity: edges,
        edgeDelta: 0,
        diff: 0,
        histDiff: 0,
        chromaDist: 0,
        lumaDelta: 0,
        motionX: 0,
        motionY: 0,
        motionMagnitude: 0,
        motionVelocity: 0,
        motionSaturated: false,
        divergence: 0,
      });
    } else {
      const motion = estimateMotion(previousGray, gray, sample.width, sample.height);
      metrics.push({
        time: sample.time,
        interval,
        meanLuma: luma,
        edgeDensity: edges,
        edgeDelta: edges - previousEdges,
        diff: meanAbsoluteDifference(previousGray, gray),
        histDiff: histogramDistance(previousHistogram, bins),
        chromaDist: histogramDistance(previousChroma, chroma),
        lumaDelta: luma - previousLuma,
        motionX: motion.dx,
        motionY: motion.dy,
        motionMagnitude: motion.magnitude,
        motionVelocity: motion.magnitude / interval,
        motionSaturated: motion.saturated,
        divergence: motion.divergence,
      });
    }

    previousGray = gray;
    previousHistogram = bins;
    previousChroma = chroma;
    previousLuma = luma;
    previousEdges = edges;
    previousTime = sample.time;
  }

  return metrics;
}
