import { describe, expect, it } from 'vitest';
import { deriveEditRhythm, deriveMotionProfile, describeRhythm } from './rhythm.ts';
import type { Candidate } from '../types/analysis.ts';
import type { MotionDirection, Scene } from '../types/motion.ts';

const scene = (index: number, start: number, end: number, motionLevel = 0): Scene => ({
  id: `s${index}`,
  index,
  startTime: start,
  endTime: end,
  duration: Number((end - start).toFixed(3)),
  motionLevel,
  meanLuma: 0.5,
  sampleCount: 5,
});

const candidate = (direction?: MotionDirection, overrides: Partial<Candidate['metrics']> = {}): Candidate => ({
  id: `c${Math.random()}`,
  kind: 'boundary',
  time: 1,
  strength: 0.8,
  quality: 0.8,
  metrics: {
    diff: 0.4, histDiff: 0.4, chromaDist: 0.1, lumaDelta: 0, edgeDelta: 0,
    motionMagnitude: 0, motionVelocity: 0, motionSaturated: false, sampleIntervalSec: 0.33,
    ...(direction ? { direction } : {}),
    ...overrides,
  },
});

describe('deriveEditRhythm', () => {
  it('returns nothing for a video with too few shots to have a rhythm', () => {
    // One cut is not a rhythm, and an "average shot length" from it would be
    // arithmetically true and editorially meaningless.
    expect(deriveEditRhythm([scene(1, 0, 5), scene(2, 5, 10)], 10)).toBeUndefined();
  });

  it('computes shot statistics from the scene list', () => {
    const scenes = [scene(1, 0, 1), scene(2, 1, 3), scene(3, 3, 3.5), scene(4, 3.5, 8)];
    const rhythm = deriveEditRhythm(scenes, 8)!;
    expect(rhythm.shotCount).toBe(4);
    expect(rhythm.shortestShot).toBe(0.5);
    expect(rhythm.longestShot).toBe(4.5);
    expect(rhythm.averageShot).toBe(2);
    expect(rhythm.cutsPerMinute).toBeCloseTo(22.5, 1);
  });

  it('bands cut density', () => {
    const dense = Array.from({ length: 20 }, (_, index) => scene(index + 1, index * 0.5, (index + 1) * 0.5));
    expect(deriveEditRhythm(dense, 10)!.density).toBe('very high');

    const sparse = [scene(1, 0, 40), scene(2, 40, 80), scene(3, 80, 120)];
    expect(deriveEditRhythm(sparse, 120)!.density).toBe('low');
  });

  it('locates the densest stretch of cutting', () => {
    // Pacing is interesting where it changes, which a single mean never shows.
    const scenes = [
      scene(1, 0, 3), scene(2, 3, 6),
      scene(3, 6, 6.4), scene(4, 6.4, 6.8), scene(5, 6.8, 7.2), scene(6, 7.2, 7.6),
      scene(7, 7.6, 11),
    ];
    const rhythm = deriveEditRhythm(scenes, 11)!;
    expect(rhythm.fastestSectionStart).toBeGreaterThanOrEqual(6);
    expect(rhythm.fastestSectionEnd).toBeLessThanOrEqual(7.6);
  });
});

describe('deriveMotionProfile', () => {
  it('finds the dominant direction across measured events', () => {
    const profile = deriveMotionProfile(
      [candidate('right'), candidate('right'), candidate('left'), candidate('outward')],
      [scene(1, 0, 2)],
    );
    expect(profile.dominantDirection).toBe('right');
    expect(profile.dominantDirectionCount).toBe(2);
    expect(profile.translationEvents).toBe(3);
    expect(profile.zoomEvents).toBe(1);
  });

  it('reports no dominant direction when nothing was measured', () => {
    const profile = deriveMotionProfile([candidate(), candidate()], [scene(1, 0, 2)]);
    expect(profile.dominantDirection).toBeUndefined();
    expect(profile.cameraMotionShare).toBe(0);
  });

  it('counts blur from edge collapse and fast motion from saturation', () => {
    const profile = deriveMotionProfile(
      [candidate('right', { edgeDelta: -0.08 }), candidate('right', { motionSaturated: true })],
      [scene(1, 0, 2, 0.05)],
    );
    expect(profile.blurEvents).toBe(1);
    expect(profile.rapidMotionEvents).toBe(1);
    expect(profile.cameraMotionShare).toBe(1);
  });
});

describe('describeRhythm', () => {
  it('says nothing when there is no rhythm to describe', () => {
    expect(describeRhythm(undefined, deriveMotionProfile([], []))).toBeNull();
  });

  it('reports only what was measured', () => {
    const scenes = [scene(1, 0, 1), scene(2, 1, 3), scene(3, 3, 3.5), scene(4, 3.5, 8)];
    const note = describeRhythm(
      deriveEditRhythm(scenes, 8),
      deriveMotionProfile([candidate('right'), candidate('right')], scenes),
    )!;
    expect(note).toContain('4 shots');
    expect(note).toContain('Left → Right'.toLowerCase());
  });

  it('omits the direction claim when only one moment supports it', () => {
    const scenes = [scene(1, 0, 1), scene(2, 1, 3), scene(3, 3, 8)];
    const note = describeRhythm(deriveEditRhythm(scenes, 8), deriveMotionProfile([candidate('right')], scenes))!;
    expect(note).not.toContain('Movement runs');
  });
});
