import { describe, expect, it } from 'vitest';
import { segmentScenes } from './scenes.ts';
import type { Candidate, FrameMetrics } from '../types/analysis.ts';

const candidate = (time: number, kind: Candidate['kind'] = 'boundary'): Candidate => ({
  id: `c${Math.round(time * 1000)}`,
  kind,
  time,
  peakTime: time,
  strength: 0.8,
  quality: 0.8,
  metrics: {
    diff: 0.4, histDiff: 0.4, chromaDist: 0.1, lumaDelta: 0, edgeDelta: 0,
    motionMagnitude: 0, motionVelocity: 0, motionSaturated: false, sampleIntervalSec: 0.33,
  },
});

const metric = (time: number, overrides: Partial<FrameMetrics> = {}): FrameMetrics => ({
  time, interval: 0.33, meanLuma: 0.5, edgeDensity: 0.2, edgeDelta: 0,
  diff: 0, histDiff: 0, chromaDist: 0, lumaDelta: 0,
  motionX: 0, motionY: 0, motionMagnitude: 0, motionVelocity: 0, motionSaturated: false, divergence: 0,
  ...overrides,
});

const series = (count: number, step = 0.33) =>
  Array.from({ length: count }, (_, index) => metric(Number((index * step).toFixed(3))));

describe('segmentScenes', () => {
  it('produces one scene for a video with no boundaries', () => {
    const scenes = segmentScenes([], series(20), 6.6);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.startTime).toBe(0);
    expect(scenes[0]?.endTime).toBe(6.6);
  });

  it('splits on boundaries and covers the whole duration without gaps', () => {
    const scenes = segmentScenes([candidate(2.16), candidate(3.84)], series(20), 6.6);
    expect(scenes).toHaveLength(3);
    expect(scenes[0]?.endTime).toBe(scenes[1]?.startTime);
    expect(scenes[1]?.endTime).toBe(scenes[2]?.startTime);
    expect(scenes[scenes.length - 1]?.endTime).toBe(6.6);
  });

  it('does not treat a camera move as a shot boundary', () => {
    // A push-in does not end the shot it is pushing in on. Treating it as a cut
    // would corrupt every shot-length statistic derived from this list.
    const scenes = segmentScenes([candidate(3, 'camera'), candidate(4, 'color')], series(20), 6.6);
    expect(scenes).toHaveLength(1);
  });

  it('carries measured motion into each scene', () => {
    const metrics = [
      ...series(6).map((entry) => ({ ...entry, motionMagnitude: 0.05, motionX: 4 })),
      ...Array.from({ length: 6 }, (_, index) => metric(Number((2.0 + index * 0.33).toFixed(3)))),
    ];
    const scenes = segmentScenes([candidate(2.0)], metrics, 4);
    expect(scenes[0]?.motionLevel).toBeGreaterThan(0.04);
    expect(scenes[0]?.dominantDirection).toBe('right');
    expect(scenes[1]?.motionLevel).toBe(0);
  });

  it('drops boundaries too close together to be real shots', () => {
    const scenes = segmentScenes([candidate(2.0), candidate(2.02)], series(20), 6.6);
    expect(scenes).toHaveLength(2);
  });

  it('links each scene to the candidate that ended it', () => {
    const scenes = segmentScenes([candidate(2.16)], series(20), 6.6);
    expect(scenes[0]?.exitCandidateId).toBe('c2160');
    expect(scenes[1]?.entryCandidateId).toBe('c2160');
  });
});
