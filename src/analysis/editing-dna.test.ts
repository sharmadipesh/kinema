import { describe, expect, it } from 'vitest';
import { deriveEditingDNA, deriveOverview } from './editing-dna.ts';
import type { Scene } from '../types/motion.ts';
import { CATEGORY_OF_TYPE, type MotionEvent, type MotionEventType } from '../types/motion.ts';

function event(type: MotionEventType, startTime: number, motionMagnitude?: number): MotionEvent {
  return {
    id: `${type}-${startTime}`,
    startTime,
    category: CATEGORY_OF_TYPE[type],
    type,
    title: type,
    description: '',
    confidence: 0.8,
    certainty: 'detected',
    role: 'primary',
    ...(motionMagnitude !== undefined ? { evidence: { motionMagnitude } } : {}),
  };
}

const shots = (count: number, each = 1): Scene[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `s${index}`,
    index,
    startTime: index * each,
    endTime: (index + 1) * each,
    duration: each,
    motionLevel: 0,
    meanLuma: 0.5,
    sampleCount: 4,
  }));

describe('deriveEditingDNA', () => {
  it('reports nothing for an empty analysis rather than a middling default', () => {
    const dna = deriveEditingDNA([], 30);
    expect(dna.cuts.value).toBe(0);
    expect(dna.motion.value).toBe(0);
    expect(dna.motion.label).toBe('None');
  });

  it('scales cut density with duration, not raw count', () => {
    const cuts = Array.from({ length: 10 }, (_, index) => event('hard_cut', index * 2));
    const short = deriveEditingDNA(cuts, 20);
    const long = deriveEditingDNA(cuts, 600);
    expect(short.cuts.value).toBeGreaterThan(long.cuts.value);
  });

  it('derives pacing from shot boundaries rather than event count', () => {
    // Counting events conflated "a lot happened" with "the edit cuts fast": one
    // long take full of camera moves used to score as fast pacing.
    const moves = Array.from({ length: 12 }, (_, index) => event('camera_pan', index * 2, 0.05));
    const oneLongTake = deriveEditingDNA(moves, 30, shots(1, 30));
    const manyShots = deriveEditingDNA(moves, 30, shots(20, 1.5));
    expect(oneLongTake.pacing.value).toBeLessThan(manyShots.pacing.value);
  });

  it('explains every trait with something a reader can check', () => {
    const dna = deriveEditingDNA([event('hard_cut', 1)], 18, shots(11, 1.6));
    expect(dna.pacing.why).toContain('11 shots');
    for (const trait of Object.values(dna)) expect(trait.why.length).toBeGreaterThan(10);
  });

  it('prefers a supplied explanation over the generated one, but never the number', () => {
    const generated = deriveEditingDNA([event('hard_cut', 1)], 18, shots(11, 1.6));
    const noted = deriveEditingDNA([event('hard_cut', 1)], 18, shots(11, 1.6), { pacing: 'Written by the model.' });
    expect(noted.pacing.why).toBe('Written by the model.');
    expect(noted.pacing.value).toBe(generated.pacing.value);
  });

  it('stays inside 0-1 however dense the edit', () => {
    const frantic = Array.from({ length: 400 }, (_, index) => event('hard_cut', index * 0.05));
    const dna = deriveEditingDNA(frantic, 20);
    for (const trait of Object.values(dna)) {
      expect(trait.value).toBeGreaterThanOrEqual(0);
      expect(trait.value).toBeLessThanOrEqual(1);
    }
    expect(dna.cuts.label).toBe('Relentless');
  });

  it('derives motion from measured magnitudes, not from event count', () => {
    const gentle = deriveEditingDNA([event('camera_pan', 1, 0.01)], 30);
    const violent = deriveEditingDNA([event('camera_pan', 1, 0.09)], 30);
    expect(violent.motion.value).toBeGreaterThan(gentle.motion.value);
    expect(violent.motion.label).toBe('Very high');
  });
});

describe('deriveOverview', () => {
  it('counts categories and carries the model summary through unchanged', () => {
    const overview = deriveOverview(
      'Fast fashion edit.',
      [event('hard_cut', 1), event('hard_cut', 3), event('whip_pan', 5), event('text_appears', 7), event('camera_pan', 9)],
      30,
    );
    expect(overview.summary).toBe('Fast fashion edit.');
    expect(overview.sceneChanges).toBe(2);
    expect(overview.transitions).toBe(1);
    expect(overview.textAnimations).toBe(1);
    expect(overview.cameraMovements).toBe(1);
  });

  it('describes pacing with a word the bars agree with', () => {
    const many = Array.from({ length: 20 }, (_, index) => event('hard_cut', index));
    expect(deriveOverview('x', many, 30).pacing).toBe('very fast');
    expect(deriveOverview('x', [event('hard_cut', 1)], 300).pacing).toBe('slow');
  });
});
