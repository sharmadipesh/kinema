import { describe, expect, it } from 'vitest';
import {
  chromaHistogram,
  describeDirection,
  edgeDensity,
  estimateMotion,
  histogram,
  histogramDistance,
  meanAbsoluteDifference,
  meanLuma,
  toGrayscale,
  computeMetrics,
} from './metrics.ts';
import { ANALYSIS_FRAME } from './config.ts';

const W = ANALYSIS_FRAME.width;
const H = ANALYSIS_FRAME.height;

function blank(value: number): Uint8Array {
  return new Uint8Array(W * H).fill(value);
}

/**
 * A non-repeating column texture, shifted horizontally by `offset` pixels.
 *
 * Deliberately aperiodic: a regular bar pattern makes a shift of +4 genuinely
 * indistinguishable from -4, so a block matcher answering either is correct and
 * the test proves nothing.
 */
function texture(offset: number): Uint8Array {
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const source = x - offset;
      gray[y * W + x] = source < 0 || source >= W ? 0 : (source * 37 + y * 13 + 11) % 251;
    }
  }
  return gray;
}

/** A vertical-bar pattern, shifted horizontally by `offset` pixels. */
function bars(offset: number): Uint8Array {
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      gray[y * W + x] = Math.floor((x - offset + W * 4) / 4) % 2 === 0 ? 30 : 220;
    }
  }
  return gray;
}

/** Lifts a grayscale buffer into the RGBA form `computeMetrics` now consumes. */
function rgbaOf(gray: Uint8Array, tint: [number, number, number] = [1, 1, 1]): Uint8Array {
  const rgba = new Uint8Array(gray.length * 4);
  for (let pixel = 0; pixel < gray.length; pixel += 1) {
    const value = gray[pixel] ?? 0;
    rgba[pixel * 4] = Math.min(255, value * tint[0]);
    rgba[pixel * 4 + 1] = Math.min(255, value * tint[1]);
    rgba[pixel * 4 + 2] = Math.min(255, value * tint[2]);
    rgba[pixel * 4 + 3] = 255;
  }
  return rgba;
}

describe('toGrayscale', () => {
  it('applies Rec. 709 weights', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    const gray = toGrayscale(rgba, 4, 1);
    expect(gray[0]).toBe(54); // 0.2126 * 255
    expect(gray[1]).toBe(182); // 0.7152 * 255
    expect(gray[2]).toBe(18); // 0.0722 * 255
    expect(gray[3]).toBe(254);
  });
});

describe('meanLuma', () => {
  it('normalises to 0-1', () => {
    expect(meanLuma(blank(0))).toBe(0);
    expect(meanLuma(blank(255))).toBe(1);
    expect(meanLuma(blank(128))).toBeCloseTo(0.502, 2);
  });

  it('returns 0 for an empty buffer rather than NaN', () => {
    expect(meanLuma(new Uint8Array(0))).toBe(0);
  });
});

describe('histogramDistance', () => {
  it('is zero for identical frames', () => {
    expect(histogramDistance(histogram(bars(0)), histogram(bars(0)))).toBe(0);
  });

  it('is near maximal for disjoint distributions', () => {
    expect(histogramDistance(histogram(blank(0)), histogram(blank(255)))).toBeCloseTo(1, 5);
  });

  it('stays low across a pure translation, which is what separates a pan from a cut', () => {
    // The whole point of tracking tone as well as pixels: shifting the frame
    // changes every pixel but barely moves the histogram.
    const distance = histogramDistance(histogram(bars(0)), histogram(bars(6)));
    const pixels = meanAbsoluteDifference(bars(0), bars(6));
    expect(distance).toBeLessThan(0.05);
    expect(pixels).toBeGreaterThan(0.3);
    // The gap is the signal: the same frames look wildly different by pixel and
    // nearly identical by tone, which is why `changeScore` weighs both.
    expect(pixels).toBeGreaterThan(distance * 5);
  });
});

describe('meanAbsoluteDifference', () => {
  it('is zero for identical buffers and one for black against white', () => {
    expect(meanAbsoluteDifference(blank(120), blank(120))).toBe(0);
    expect(meanAbsoluteDifference(blank(0), blank(255))).toBe(1);
  });
});

describe('edgeDensity', () => {
  it('is zero on a flat frame and high on a striped one', () => {
    expect(edgeDensity(blank(90), W, H)).toBe(0);
    expect(edgeDensity(bars(0), W, H)).toBeGreaterThan(0.2);
  });
});

describe('estimateMotion', () => {
  it('recovers a rightward shift with the right sign', () => {
    // Content moved right by 4px between frames.
    const estimate = estimateMotion(texture(0), texture(4), W, H);
    expect(estimate.dx).toBeCloseTo(4, 0);
    expect(Math.abs(estimate.dy)).toBeLessThan(1);
    expect(estimate.magnitude).toBeGreaterThan(0);
  });

  it('recovers a leftward shift with the right sign', () => {
    const estimate = estimateMotion(texture(4), texture(0), W, H);
    expect(estimate.dx).toBeCloseTo(-4, 0);
  });

  it('reports no motion between identical frames', () => {
    const estimate = estimateMotion(texture(3), texture(3), W, H);
    expect(estimate.dx).toBe(0);
    expect(estimate.dy).toBe(0);
    expect(estimate.magnitude).toBe(0);
  });

  it('recovers fast motion a single-level search could not reach', () => {
    // The old single-level +/-6 search saturated at about 9% of frame width per
    // sample, so every genuinely fast movement reported the same magnitude and
    // a whip pan was indistinguishable from a brisk pan. The pyramid reaches
    // roughly +/-14.
    const fast = estimateMotion(texture(0), texture(10), W, H);
    expect(fast.dx).toBeCloseTo(10, 0);
    expect(fast.magnitude).toBeGreaterThan(6 / W);
  });

  it('flags saturation instead of silently reporting its own ceiling', () => {
    // Beyond the search range the honest answer is "at least this fast", and
    // the flag is what stops the number being read as a measurement.
    const beyond = estimateMotion(texture(0), texture(22), W, H);
    expect(beyond.saturated).toBe(true);
  });

  it('resolves a tie toward zero rather than picking an extreme', () => {
    // Vertical bars carry no vertical information: every dy matches equally.
    // Answering -6 there would be an invented vector, so it must answer 0.
    const estimate = estimateMotion(bars(2), bars(2), W, H);
    expect(estimate.dy).toBe(0);
    expect(estimate.magnitude).toBe(0);
  });
});

describe('describeDirection', () => {
  const estimate = (dx: number, dy: number, divergence = 0) => ({
    dx,
    dy,
    magnitude: Math.hypot(dx, dy) / W,
    divergence,
    saturated: false,
  });

  it('names a rightward pan', () => {
    expect(describeDirection(estimate(5, 0), W)).toBe('right');
  });

  it('names a leftward pan', () => {
    expect(describeDirection(estimate(-5, 0), W)).toBe('left');
  });

  it('refuses to name a direction when nothing meaningfully moved', () => {
    // Fabricated precision is the failure mode this guards against.
    expect(describeDirection(estimate(0.2, 0.1), W)).toBeUndefined();
  });

  it('calls a strong radial component a zoom rather than a pan', () => {
    expect(describeDirection(estimate(0.2, 0, 1), W)).toBe('outward');
    expect(describeDirection(estimate(0.2, 0, -1), W)).toBe('inward');
  });
});

describe('chromaHistogram', () => {
  it('sees a grade shift that luma is blind to', () => {
    // Warm vs cool at matched brightness: the luma histogram barely moves, and
    // a luma-only pipeline reports no event at all.
    const gray = texture(0);
    const warm = rgbaOf(gray, [1.25, 1, 0.7]);
    const cool = rgbaOf(gray, [0.7, 1, 1.25]);

    const chroma = histogramDistance(chromaHistogram(warm, W * H), chromaHistogram(cool, W * H));
    const luma = histogramDistance(
      histogram(toGrayscale(warm, W, H)),
      histogram(toGrayscale(cool, W, H)),
    );

    expect(chroma).toBeGreaterThan(0.2);
    expect(chroma).toBeGreaterThan(luma * 2);
  });
});

describe('computeMetrics', () => {
  const sample = (time: number, gray: Uint8Array) => ({ time, rgba: rgbaOf(gray), width: W, height: H });

  it('zeroes the first frame, which has no predecessor', () => {
    const metrics = computeMetrics([sample(0, bars(0)), sample(0.5, blank(255))]);
    expect(metrics[0]?.diff).toBe(0);
    expect(metrics[0]?.histDiff).toBe(0);
    expect(metrics[0]?.interval).toBe(0);
    expect(metrics[1]?.diff).toBeGreaterThan(0.3);
  });

  it('records a signed luminance change', () => {
    const metrics = computeMetrics([sample(0, blank(20)), sample(1, blank(220)), sample(2, blank(20))]);
    expect(metrics[1]?.lumaDelta).toBeGreaterThan(0.7);
    expect(metrics[2]?.lumaDelta).toBeLessThan(-0.7);
  });

  it('reports velocity per second, so uneven sampling stays comparable', () => {
    // The same displacement over half the interval is twice the velocity. Once
    // the sampler adapts its rate, per-sample displacement stops meaning
    // anything on its own.
    const slow = computeMetrics([sample(0, texture(0)), sample(1.0, texture(4))]);
    const fast = computeMetrics([sample(0, texture(0)), sample(0.5, texture(4))]);

    expect(slow[1]?.motionMagnitude).toBeCloseTo(fast[1]?.motionMagnitude ?? 0, 5);
    expect(fast[1]?.motionVelocity).toBeCloseTo((slow[1]?.motionVelocity ?? 0) * 2, 3);
  });

  it('reports an edge collapse when the frame goes soft', () => {
    // The only direct evidence of motion blur available from pixels alone.
    const metrics = computeMetrics([sample(0, texture(0)), sample(0.1, blank(128))]);
    expect(metrics[1]?.edgeDelta).toBeLessThan(-0.1);
  });
});
