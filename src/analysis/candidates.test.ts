import { describe, expect, it } from 'vitest';
import { changeScore, detectCandidates, median, medianAbsoluteDeviation, refineCandidate } from './candidates.ts';
import { DETECTION } from './config.ts';
import type { FrameMetrics } from '../types/analysis.ts';

function frame(time: number, overrides: Partial<FrameMetrics> = {}): FrameMetrics {
  return {
    time,
    meanLuma: 0.5,
    edgeDensity: 0.2,
    diff: 0.01,
    histDiff: 0.01,
    lumaDelta: 0,
    motionX: 0,
    motionY: 0,
    motionMagnitude: 0,
    divergence: 0,
    ...overrides,
  };
}

/** A quiet series with low, even noise — an interview, a locked-off shot. */
function quiet(count: number, interval = 0.33): FrameMetrics[] {
  return Array.from({ length: count }, (_, index) =>
    frame(Number((index * interval).toFixed(3)), {
      diff: 0.012 + (index % 3) * 0.002,
      histDiff: 0.01 + (index % 2) * 0.002,
    }),
  );
}

describe('median / medianAbsoluteDeviation', () => {
  it('handles odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('is not dragged around by a single outlier, unlike a mean', () => {
    expect(medianAbsoluteDeviation([1, 1, 1, 1, 100])).toBe(0);
  });
});

describe('detectCandidates', () => {
  it('finds nothing in a series with no peaks', () => {
    expect(detectCandidates(quiet(30), 16).candidates).toHaveLength(0);
  });

  it('finds a single hard cut', () => {
    const metrics = quiet(30);
    metrics[12] = frame(metrics[12]!.time, { diff: 0.55, histDiff: 0.6 });

    const { candidates } = detectCandidates(metrics, 16);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.time).toBe(metrics[12]!.time);
    expect(candidates[0]?.kind).toBe('boundary');
  });

  it('reports one event for a dissolve that stays elevated across frames', () => {
    // Local-maximum suppression exists for exactly this: a slow transition
    // crosses the threshold for several frames and is one event, not five.
    const metrics = quiet(30);
    for (const [offset, value] of [[0, 0.3], [1, 0.45], [2, 0.6], [3, 0.42], [4, 0.28]] as const) {
      metrics[12 + offset] = frame(metrics[12 + offset]!.time, { diff: value, histDiff: value });
    }

    const { candidates } = detectCandidates(metrics, 16);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.time).toBe(metrics[14]!.time);
  });

  it('scales its threshold to the video rather than using a constant', () => {
    // The same absolute peak that is obvious in a locked-off shot is ordinary
    // in a hand-held one, and a fixed threshold would invent events there.
    const busy = Array.from({ length: 30 }, (_, index) =>
      frame(index * 0.33, { diff: 0.3 + (index % 4) * 0.02, histDiff: 0.28 + (index % 3) * 0.02 }),
    );
    busy[12] = frame(busy[12]!.time, { diff: 0.34, histDiff: 0.32 });

    expect(detectCandidates(busy, 16).threshold).toBeGreaterThan(0.3);
    expect(detectCandidates(quiet(30), 16).threshold).toBeLessThan(0.1);
  });

  it('classifies a bright flash by luminance rather than as a new shot', () => {
    const metrics = quiet(30);
    metrics[12] = frame(metrics[12]!.time, { diff: 0.5, histDiff: 0.3, lumaDelta: 0.45 });

    expect(detectCandidates(metrics, 16).candidates[0]?.kind).toBe('luma');
  });

  it('reports sustained camera motion as a spanning candidate', () => {
    const metrics = quiet(30);
    for (let index = 10; index <= 14; index += 1) {
      metrics[index] = frame(metrics[index]!.time, {
        motionMagnitude: DETECTION.motionThreshold * 2,
        motionX: 5,
      });
    }

    const camera = detectCandidates(metrics, 16).candidates.find((entry) => entry.kind === 'camera');
    expect(camera).toBeDefined();
    expect(camera?.endTime).toBeGreaterThan(camera!.time);
    expect(camera?.metrics.direction).toBe('right');
  });

  it('honours the candidate cap and returns the survivors in time order', () => {
    const metrics = quiet(60);
    for (let index = 5; index < 55; index += 3) {
      metrics[index] = frame(metrics[index]!.time, { diff: 0.3 + index * 0.005, histDiff: 0.3 });
    }

    const { candidates } = detectCandidates(metrics, 5);
    expect(candidates).toHaveLength(5);
    expect(candidates.map((entry) => entry.time)).toEqual([...candidates.map((entry) => entry.time)].sort((a, b) => a - b));
  });
});

describe('refineCandidate', () => {
  const coarse = {
    id: 'c4000',
    kind: 'boundary' as const,
    time: 4,
    strength: 0.8,
    metrics: { diff: 0.4, histDiff: 0.4, lumaDelta: 0, motionMagnitude: 0, sampleIntervalSec: 0.33 },
  };

  it('moves the timestamp onto the frame where the change actually peaked', () => {
    const fine = [
      frame(3.9),
      frame(4.0, { diff: 0.1, histDiff: 0.1 }),
      frame(4.08, { diff: 0.2, histDiff: 0.2 }),
      frame(4.16, { diff: 0.7, histDiff: 0.7 }),
      frame(4.24, { diff: 0.15, histDiff: 0.15 }),
    ];

    const refined = refineCandidate(coarse, fine);
    expect(refined.time).toBe(4.16);
    // A hard cut is a single frame: it must not acquire a fabricated duration.
    expect(refined.endTime).toBeUndefined();
  });

  it('gives a genuinely extended change an end time', () => {
    const fine = [
      frame(3.9),
      frame(4.0, { diff: 0.5, histDiff: 0.5 }),
      frame(4.08, { diff: 0.6, histDiff: 0.6 }),
      frame(4.16, { diff: 0.62, histDiff: 0.62 }),
      frame(4.24, { diff: 0.55, histDiff: 0.55 }),
      frame(4.32, { diff: 0.5, histDiff: 0.5 }),
    ];

    const refined = refineCandidate(coarse, fine);
    expect(refined.endTime).toBeGreaterThan(refined.time - 0.001);
    expect(refined.endTime).toBeCloseTo(4.32, 2);
  });

  it('leaves the candidate alone when there is nothing to refine with', () => {
    expect(refineCandidate(coarse, []).time).toBe(4);
  });
});

describe('changeScore', () => {
  it('weights pixel difference and tonal shift together', () => {
    expect(changeScore(frame(0, { diff: 1, histDiff: 0 }))).toBeCloseTo(DETECTION.diffWeight, 5);
    expect(changeScore(frame(0, { diff: 0, histDiff: 1 }))).toBeCloseTo(DETECTION.histWeight, 5);
  });
});
