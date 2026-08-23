import { describe, expect, it } from 'vitest';
import {
  activeRegions,
  changeScore,
  clusterCandidates,
  detectCandidates,
  median,
  medianAbsoluteDeviation,
  refineCandidate,
  thresholdFor,
} from './candidates.ts';
import { DETECTION } from './config.ts';
import type { Candidate, FrameMetrics } from '../types/analysis.ts';

function frame(time: number, overrides: Partial<FrameMetrics> = {}): FrameMetrics {
  return {
    time,
    interval: 0.33,
    meanLuma: 0.5,
    edgeDensity: 0.2,
    edgeDelta: 0,
    diff: 0.01,
    histDiff: 0.01,
    chromaDist: 0.01,
    lumaDelta: 0,
    motionX: 0,
    motionY: 0,
    motionMagnitude: 0,
    motionVelocity: 0,
    motionSaturated: false,
    divergence: 0,
    ...overrides,
  };
}

/** A quiet series with low, even noise — an interview, a locked-off shot. */
function quiet(count: number, interval = 0.33): FrameMetrics[] {
  return Array.from({ length: count }, (_, index) =>
    frame(Number((index * interval).toFixed(3)), {
      interval: index === 0 ? 0 : interval,
      diff: 0.012 + (index % 3) * 0.002,
      histDiff: 0.01 + (index % 2) * 0.002,
    }),
  );
}

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: 'c4000',
  kind: 'boundary',
  time: 4,
  strength: 0.8,
  quality: 0.8,
  metrics: {
    diff: 0.4,
    histDiff: 0.4,
    chromaDist: 0.1,
    lumaDelta: 0,
    edgeDelta: 0,
    motionMagnitude: 0,
    motionVelocity: 0,
    motionSaturated: false,
    sampleIntervalSec: 0.33,
  },
  ...overrides,
});

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

describe('thresholdFor', () => {
  it('adapts upward for a noisy series', () => {
    const quietSeries = Array.from({ length: 30 }, () => 0.01);
    const noisySeries = Array.from({ length: 30 }, (_, index) => 0.1 + (index % 5) * 0.02);
    expect(thresholdFor(noisySeries)).toBeGreaterThan(thresholdFor(quietSeries));
  });

  it('never rises above the absolute cut ceiling', () => {
    // THE regression that cost real recall: in a dense edit the deviation
    // inflates and an unbounded adaptive threshold climbs above the very cuts
    // it is meant to find, so a fast edit hides its own cutting.
    const dense = Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? 0.05 : 0.75));
    expect(thresholdFor(dense)).toBeLessThanOrEqual(DETECTION.absoluteCut);
  });

  it('never falls below the noise floor', () => {
    expect(thresholdFor(Array.from({ length: 30 }, () => 0))).toBe(DETECTION.minScore);
  });
});

describe('detectCandidates', () => {
  it('finds nothing in a series with no peaks', () => {
    expect(detectCandidates(quiet(30), 26).candidates).toHaveLength(0);
  });

  it('finds a single hard cut', () => {
    const metrics = quiet(30);
    metrics[12] = frame(metrics[12]!.time, { diff: 0.55, histDiff: 0.6 });

    const { candidates } = detectCandidates(metrics, 26);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.time).toBe(metrics[12]!.time);
    expect(candidates[0]?.kind).toBe('boundary');
  });

  it('finds cuts in a densely cut edit rather than hiding them in its own median', () => {
    // Every third interval is a cut. The old unbounded threshold sat above them
    // all and returned nothing; this is the fast-fashion-edit failure mode.
    const metrics = quiet(45, 0.2);
    for (let index = 3; index < 42; index += 3) {
      metrics[index] = frame(metrics[index]!.time, { interval: 0.2, diff: 0.5, histDiff: 0.55 });
    }
    const { candidates } = detectCandidates(metrics, 26);
    expect(candidates.length).toBeGreaterThanOrEqual(8);
  });

  it('separates two cuts closer together than the old fixed gap', () => {
    // 0.2s apart. The previous 0.35s suppression window merged these by rule,
    // which is how sub-half-second cutting became structurally invisible.
    const metrics = quiet(30, 0.1);
    metrics[10] = frame(metrics[10]!.time, { interval: 0.1, diff: 0.6, histDiff: 0.6 });
    metrics[12] = frame(metrics[12]!.time, { interval: 0.1, diff: 0.6, histDiff: 0.6 });

    const { candidates } = detectCandidates(metrics, 26);
    expect(candidates).toHaveLength(2);
  });

  it('reports one event for a dissolve that stays elevated across frames', () => {
    const metrics = quiet(30);
    for (const [offset, value] of [[0, 0.3], [1, 0.45], [2, 0.6], [3, 0.42], [4, 0.28]] as const) {
      metrics[12 + offset] = frame(metrics[12 + offset]!.time, { diff: value, histDiff: value });
    }
    const { candidates } = detectCandidates(metrics, 26);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.time).toBe(metrics[14]!.time);
  });

  it('finds a slow crossfade that never produces a peak', () => {
    // Gradual changes plateau rather than spike, so peak detection ignores them
    // entirely — which is why slow cinematic material came back nearly empty.
    const metrics = quiet(40);
    for (let index = 15; index <= 22; index += 1) {
      metrics[index] = frame(metrics[index]!.time, { diff: 0.05, histDiff: 0.05 });
    }
    const gradual = detectCandidates(metrics, 26).candidates.filter((entry) => entry.kind === 'gradual');
    expect(gradual.length).toBeGreaterThanOrEqual(1);
    expect(gradual[0]?.endTime).toBeGreaterThan(gradual[0]!.time);
  });

  it('classifies a bright flash by luminance rather than as a new shot', () => {
    const metrics = quiet(30);
    metrics[12] = frame(metrics[12]!.time, { diff: 0.5, histDiff: 0.3, lumaDelta: 0.45 });
    expect(detectCandidates(metrics, 26).candidates[0]?.kind).toBe('luma');
  });

  it('classifies a grade shift by colour when structure barely moves', () => {
    // Invisible to a luma-only pipeline: same brightness, same edges, new palette.
    const metrics = quiet(30);
    metrics[12] = frame(metrics[12]!.time, { diff: 0.05, histDiff: 0.04, chromaDist: 0.7 });
    expect(detectCandidates(metrics, 26).candidates[0]?.kind).toBe('color');
  });

  it('reports sustained camera motion as a spanning candidate', () => {
    const metrics = quiet(30);
    for (let index = 10; index <= 14; index += 1) {
      metrics[index] = frame(metrics[index]!.time, {
        motionMagnitude: DETECTION.motionThreshold * 2,
        motionX: 5,
      });
    }
    const camera = detectCandidates(metrics, 26).candidates.find((entry) => entry.kind === 'camera');
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
    expect(candidates.map((entry) => entry.time)).toEqual(
      [...candidates.map((entry) => entry.time)].sort((a, b) => a - b),
    );
  });
});

describe('activeRegions', () => {
  it('brackets a busy stretch and ignores a quiet one', () => {
    const metrics = quiet(40);
    metrics[20] = frame(metrics[20]!.time, { diff: 0.4, histDiff: 0.4 });

    const regions = activeRegions(metrics, 0.33);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.start).toBeLessThan(metrics[20]!.time);
    expect(regions[0]!.end).toBeGreaterThan(metrics[20]!.time);
  });

  it('treats saturated motion as active even when the change score is low', () => {
    // A whip pan changes little tonally while moving enormously. Without this
    // the densification pass never visits it.
    const metrics = quiet(20);
    metrics[8] = frame(metrics[8]!.time, { motionSaturated: true });
    expect(activeRegions(metrics, 0.33).length).toBeGreaterThanOrEqual(1);
  });

  it('merges overlapping regions rather than emitting neighbours twice', () => {
    const metrics = quiet(30);
    metrics[10] = frame(metrics[10]!.time, { diff: 0.4, histDiff: 0.4 });
    metrics[11] = frame(metrics[11]!.time, { diff: 0.4, histDiff: 0.4 });
    expect(activeRegions(metrics, 0.33)).toHaveLength(1);
  });
});

describe('refineCandidate', () => {
  it('moves the timestamp onto the frame where the change actually peaked', () => {
    const fine = [
      frame(3.9),
      frame(4.0, { diff: 0.1, histDiff: 0.1, interval: 0.08 }),
      frame(4.08, { diff: 0.2, histDiff: 0.2, interval: 0.08 }),
      frame(4.16, { diff: 0.7, histDiff: 0.7, interval: 0.08 }),
      frame(4.24, { diff: 0.15, histDiff: 0.15, interval: 0.08 }),
    ];
    const refined = refineCandidate(candidate(), fine);
    expect(refined.time).toBe(4.16);
    expect(refined.peakTime).toBe(4.16);
    // A hard cut is a single frame: it must not acquire a fabricated duration.
    expect(refined.endTime).toBeUndefined();
  });

  it('gives a genuinely extended change a start, a peak and an end', () => {
    const fine = [
      frame(3.9),
      frame(4.0, { diff: 0.5, histDiff: 0.5, interval: 0.08 }),
      frame(4.08, { diff: 0.6, histDiff: 0.6, interval: 0.08 }),
      frame(4.16, { diff: 0.62, histDiff: 0.62, interval: 0.08 }),
      frame(4.24, { diff: 0.55, histDiff: 0.55, interval: 0.08 }),
      frame(4.32, { diff: 0.5, histDiff: 0.5, interval: 0.08 }),
    ];
    const refined = refineCandidate(candidate(), fine);
    expect(refined.time).toBeLessThan(refined.peakTime!);
    expect(refined.endTime).toBeGreaterThan(refined.peakTime!);
  });

  it('captures the velocity profile that makes a peak claim possible', () => {
    const fine = [
      frame(4.0),
      frame(4.08, { motionVelocity: 0.1, interval: 0.08 }),
      frame(4.16, { motionVelocity: 0.9, diff: 0.6, histDiff: 0.6, interval: 0.08 }),
      frame(4.24, { motionVelocity: 0.3, interval: 0.08 }),
    ];
    const refined = refineCandidate(candidate(), fine);
    expect(refined.metrics.peakVelocity).toBeCloseTo(0.9, 2);
    expect(refined.metrics.peakVelocityTime).toBe(4.16);
    expect(refined.profile).toHaveLength(3);
  });

  it('measures whether movement carries across the change', () => {
    // The claim the product wants to make about a whip pan, and the one it had
    // no measurement for: does the incoming shot keep moving?
    const carries = refineCandidate(
      candidate(),
      [
        frame(4.0),
        frame(4.08, { motionVelocity: 0.8, interval: 0.08 }),
        frame(4.16, { motionVelocity: 0.9, diff: 0.7, histDiff: 0.7, interval: 0.08 }),
        frame(4.24, { motionVelocity: 0.75, interval: 0.08 }),
      ],
    );
    expect(carries.metrics.motionContinues).toBe(true);

    const stops = refineCandidate(
      candidate(),
      [
        frame(4.0),
        frame(4.08, { motionVelocity: 0.8, interval: 0.08 }),
        frame(4.16, { motionVelocity: 0.9, diff: 0.7, histDiff: 0.7, interval: 0.08 }),
        frame(4.24, { motionVelocity: 0.02, interval: 0.08 }),
      ],
    );
    expect(stops.metrics.motionContinues).toBe(false);
  });

  it('leaves the candidate alone when there is nothing to refine with', () => {
    expect(refineCandidate(candidate(), []).time).toBe(4);
  });
});

describe('clusterCandidates', () => {
  it('folds a pan, a blur and a cut into one primary event', () => {
    // The timeline-flooding case: one whip pan measured three ways.
    const clusters = clusterCandidates([
      candidate({ id: 'a', time: 4.2, kind: 'camera', quality: 0.5 }),
      candidate({ id: 'b', time: 4.31, kind: 'boundary', quality: 0.9 }),
      candidate({ id: 'c', time: 4.38, kind: 'luma', quality: 0.4 }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.primary.id).toBe('b');
    expect(clusters[0]?.secondaries.map((entry) => entry.id).sort()).toEqual(['a', 'c']);
  });

  it('keeps genuinely separate events apart', () => {
    const clusters = clusterCandidates([
      candidate({ id: 'a', time: 1 }),
      candidate({ id: 'b', time: 8 }),
    ]);
    expect(clusters).toHaveLength(2);
  });

  it('prefers a boundary as primary over a stronger camera run', () => {
    // The editorial event is the cut, even when the move measures larger.
    const clusters = clusterCandidates([
      candidate({ id: 'move', time: 4.0, kind: 'camera', quality: 0.8 }),
      candidate({ id: 'cut', time: 4.2, kind: 'boundary', quality: 0.7 }),
    ]);
    expect(clusters[0]?.primary.id).toBe('cut');
  });
});

describe('changeScore', () => {
  it('weights pixel, tonal and colour change together', () => {
    expect(changeScore(frame(0, { diff: 1, histDiff: 0, chromaDist: 0 }))).toBeCloseTo(DETECTION.diffWeight, 5);
    expect(changeScore(frame(0, { diff: 0, histDiff: 1, chromaDist: 0 }))).toBeCloseTo(DETECTION.histWeight, 5);
    expect(changeScore(frame(0, { diff: 0, histDiff: 0, chromaDist: 1 }))).toBeCloseTo(DETECTION.chromaWeight, 5);
  });
});
