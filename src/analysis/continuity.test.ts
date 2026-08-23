import { describe, expect, it } from 'vitest';
import { measureContinuity, scenesAround } from './continuity.ts';
import type { Candidate } from '../types/analysis.ts';
import type { MotionDirection, Scene } from '../types/motion.ts';

const scene = (
  index: number,
  start: number,
  end: number,
  motionLevel = 0.05,
  dominantDirection?: MotionDirection,
): Scene => ({
  id: `s${index}`,
  index,
  startTime: start,
  endTime: end,
  duration: end - start,
  motionLevel,
  meanLuma: 0.5,
  sampleCount: 6,
  ...(dominantDirection ? { dominantDirection } : {}),
});

const candidate: Candidate = {
  id: 'c1',
  kind: 'boundary',
  time: 4,
  strength: 0.8,
  quality: 0.8,
  metrics: {
    diff: 0.5, histDiff: 0.5, chromaDist: 0.1, lumaDelta: 0, edgeDelta: 0,
    motionMagnitude: 0.05, motionVelocity: 0.6, motionSaturated: false, sampleIntervalSec: 0.04,
  },
};

describe('measureContinuity', () => {
  it('recognises movement carried across the cut', () => {
    // The property that makes a cut on motion work, and that "hard cut" misses.
    const result = measureContinuity({
      previous: scene(1, 0, 4, 0.05, 'right'),
      next: scene(2, 4, 8, 0.05, 'right'),
      candidate,
    });
    expect(result).toBe('direction-matched');
  });

  it('recognises reversed movement', () => {
    expect(
      measureContinuity({
        previous: scene(1, 0, 4, 0.05, 'right'),
        next: scene(2, 4, 8, 0.05, 'left'),
        candidate,
      }),
    ).toBe('direction-reversed');
  });

  it('treats adjacent compass points as the same movement', () => {
    expect(
      measureContinuity({
        previous: scene(1, 0, 4, 0.05, 'right'),
        next: scene(2, 4, 8, 0.05, 'down-right'),
        candidate,
      }),
    ).toBe('direction-matched');
  });

  it('recognises a scale move carried through the cut', () => {
    expect(
      measureContinuity({
        previous: scene(1, 0, 4, 0.05, 'outward'),
        next: scene(2, 4, 8, 0.05, 'outward'),
        candidate,
      }),
    ).toBe('scale-matched');
  });

  it('does not call a pan into a zoom a match', () => {
    expect(
      measureContinuity({
        previous: scene(1, 0, 4, 0.05, 'right'),
        next: scene(2, 4, 8, 0.05, 'outward'),
        candidate,
      }),
    ).toBe('none');
  });

  it('reports movement stopping and starting at the cut', () => {
    expect(
      measureContinuity({ previous: scene(1, 0, 4, 0.05, 'right'), next: scene(2, 4, 8, 0.001), candidate }),
    ).toBe('motion-interrupted');
    expect(
      measureContinuity({ previous: scene(1, 0, 4, 0.001), next: scene(2, 4, 8, 0.05, 'right'), candidate }),
    ).toBe('motion-introduced');
  });

  it('says nothing when both shots are static', () => {
    // Silence, not "no relationship" — there is no movement to relate.
    expect(
      measureContinuity({ previous: scene(1, 0, 4, 0.001), next: scene(2, 4, 8, 0.001), candidate }),
    ).toBeUndefined();
  });

  it('says nothing when a neighbouring shot is missing', () => {
    expect(measureContinuity({ previous: scene(1, 0, 4), candidate })).toBeUndefined();
    expect(measureContinuity({ candidate })).toBeUndefined();
  });

  it('says nothing when a shot was barely sampled', () => {
    // Too few samples to support a direction claim about it.
    const thin = { ...scene(2, 4, 8, 0.05, 'right'), sampleCount: 1 };
    expect(measureContinuity({ previous: scene(1, 0, 4, 0.05, 'right'), next: thin, candidate })).toBeUndefined();
  });
});

describe('scenesAround', () => {
  const scenes = [scene(1, 0, 2.16), scene(2, 2.16, 3.84), scene(3, 3.84, 6)];

  it('finds the shots either side of a boundary', () => {
    const { previous, next } = scenesAround(scenes, 2.16);
    expect(previous?.id).toBe('s1');
    expect(next?.id).toBe('s2');
  });

  it('has no previous shot at the start of the video', () => {
    expect(scenesAround(scenes, 0).previous).toBeUndefined();
  });

  it('has no next shot at the end', () => {
    expect(scenesAround(scenes, 6).next).toBeUndefined();
  });
});
