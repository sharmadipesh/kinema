import { describe, expect, it } from 'vitest';
import {
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

  it('resolves a tie toward zero rather than picking an extreme', () => {
    // Vertical bars carry no vertical information: every dy matches equally.
    // Answering -6 there would be an invented vector, so it must answer 0.
    const estimate = estimateMotion(bars(2), bars(2), W, H);
    expect(estimate.dy).toBe(0);
    expect(estimate.magnitude).toBe(0);
  });
});

describe('describeDirection', () => {
  it('names a rightward pan', () => {
    expect(describeDirection({ dx: 5, dy: 0, magnitude: 0.08, divergence: 0 }, W)).toBe('right');
  });

  it('names a leftward pan', () => {
    expect(describeDirection({ dx: -5, dy: 0, magnitude: 0.08, divergence: 0 }, W)).toBe('left');
  });

  it('refuses to name a direction when nothing meaningfully moved', () => {
    // Fabricated precision is the failure mode this guards against.
    expect(describeDirection({ dx: 0.2, dy: 0.1, magnitude: 0.001, divergence: 0 }, W)).toBeUndefined();
  });

  it('calls a strong radial component a zoom rather than a pan', () => {
    expect(describeDirection({ dx: 0.2, dy: 0, magnitude: 0.01, divergence: 0.5 }, W)).toBe('outward');
    expect(describeDirection({ dx: 0.2, dy: 0, magnitude: 0.01, divergence: -0.5 }, W)).toBe('inward');
  });
});

describe('computeMetrics', () => {
  it('zeroes the first frame, which has no predecessor', () => {
    const metrics = computeMetrics([
      { time: 0, gray: bars(0), width: W, height: H },
      { time: 0.5, gray: blank(255), width: W, height: H },
    ]);
    expect(metrics[0]?.diff).toBe(0);
    expect(metrics[0]?.histDiff).toBe(0);
    expect(metrics[1]?.diff).toBeGreaterThan(0.3);
  });

  it('records a signed luminance change', () => {
    const metrics = computeMetrics([
      { time: 0, gray: blank(20), width: W, height: H },
      { time: 1, gray: blank(220), width: W, height: H },
      { time: 2, gray: blank(20), width: W, height: H },
    ]);
    expect(metrics[1]?.lumaDelta).toBeGreaterThan(0.7);
    expect(metrics[2]?.lumaDelta).toBeLessThan(-0.7);
  });
});
