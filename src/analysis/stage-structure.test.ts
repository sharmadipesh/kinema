import { describe, expect, it } from 'vitest';
import { applyStructure, mergeStage, splitStage } from './stage-structure.ts';
import { scene, stage } from '../test/fixtures.ts';
import type { EnergyPoint } from '../types/motion.ts';

const energy: EnergyPoint[] = Array.from({ length: 10 }, (_, index) => ({
  startTime: index * 2,
  endTime: index * 2 + 2,
  value: index < 5 ? 0.4 : 0.8,
  cuts: 1,
}));

const input = {
  scenes: Array.from({ length: 10 }, (_, index) => scene(index)),
  energy,
  events: [],
};

const two = () => [
  stage({ id: 'stage-1', index: 1, name: 'Hook', startTime: 0, endTime: 10, referenceTime: 4 }),
  stage({ id: 'stage-2', index: 2, name: 'Resolve', startTime: 10, endTime: 20, referenceTime: 14 }),
];

describe('splitStage', () => {
  it('produces two contiguous stages covering the original range', () => {
    const out = splitStage(two(), { kind: 'split', stageId: 'stage-1', atTime: 6 }, input);

    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ startTime: 0, endTime: 6 });
    expect(out[1]).toMatchObject({ startTime: 6, endTime: 10 });
    // No gap and no overlap — the invariant the consistency validator checks.
    expect(out[1]!.startTime).toBe(out[0]!.endTime);
  });

  it('recounts shots from the scene list rather than apportioning them', () => {
    // Halving "3 shots" into 1.5 and 1.5 would invent a measurement.
    const out = splitStage(two(), { kind: 'split', stageId: 'stage-1', atTime: 6 }, input);

    expect(Number.isInteger(out[0]!.shotCount)).toBe(true);
    expect(out[0]!.shotCount + out[1]!.shotCount).toBe(5);
  });

  it('re-averages energy over each new range', () => {
    const out = splitStage(two(), { kind: 'split', stageId: 'stage-2', atTime: 14 }, input);

    expect(out[1]!.energy).toBeCloseTo(0.8, 1);
  });

  it('refuses a boundary on the edge, which would make a zero-length beat', () => {
    expect(splitStage(two(), { kind: 'split', stageId: 'stage-1', atTime: 0 }, input)).toHaveLength(2);
    expect(splitStage(two(), { kind: 'split', stageId: 'stage-1', atTime: 10 }, input)).toHaveLength(2);
  });

  it('refuses a boundary outside the stage', () => {
    expect(splitStage(two(), { kind: 'split', stageId: 'stage-1', atTime: 15 }, input)).toHaveLength(2);
  });

  it('ignores a split of a stage that does not exist', () => {
    expect(splitStage(two(), { kind: 'split', stageId: 'ghost', atTime: 5 }, input)).toHaveLength(2);
  });

  it('drops a reference frame that now belongs to the other half', () => {
    // The Hook frame sits at 4s; splitting at 6 leaves the right half without.
    const out = splitStage(two(), { kind: 'split', stageId: 'stage-1', atTime: 6 }, input);

    expect(out[0]!.referenceTime).toBe(4);
    expect(out[1]!.referenceTime).toBeUndefined();
  });
});

describe('mergeStage', () => {
  it('joins two adjacent stages into one covering both ranges', () => {
    const out = mergeStage(two(), { kind: 'merge', stageId: 'stage-1', withStageId: 'stage-2' });

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ startTime: 0, endTime: 20 });
  });

  it('adds shot counts and weights the average by them', () => {
    const stages = [
      stage({ id: 'a', startTime: 0, endTime: 10, shotCount: 2, averageShot: 5 }),
      stage({ id: 'b', index: 2, startTime: 10, endTime: 20, shotCount: 8, averageShot: 1.25 }),
    ];
    const out = mergeStage(stages, { kind: 'merge', stageId: 'a', withStageId: 'b' });

    expect(out[0]!.shotCount).toBe(10);
    expect(out[0]!.averageShot).toBe(2);
  });

  it('refuses to merge stages that are not adjacent', () => {
    const three = [
      stage({ id: 'a', startTime: 0, endTime: 6 }),
      stage({ id: 'b', index: 2, startTime: 6, endTime: 12 }),
      stage({ id: 'c', index: 3, startTime: 12, endTime: 20 }),
    ];
    expect(mergeStage(three, { kind: 'merge', stageId: 'a', withStageId: 'c' })).toHaveLength(3);
  });
});

describe('applyStructure', () => {
  it('replays edits in order and renumbers the result', () => {
    const out = applyStructure({ ...input, stages: two() }, [
      { kind: 'split', stageId: 'stage-1', atTime: 6 },
      { kind: 'split', stageId: 'stage-2', atTime: 16 },
    ]);

    expect(out.map((entry) => entry.index)).toEqual([1, 2, 3, 4]);
    expect(out.map((entry) => entry.startTime)).toEqual([0, 6, 10, 16]);
  });

  it('survives an edit that no longer applies', () => {
    // A stored edit can reference a stage a previous edit already merged away.
    const out = applyStructure({ ...input, stages: two() }, [
      { kind: 'merge', stageId: 'stage-1', withStageId: 'stage-2' },
      { kind: 'split', stageId: 'stage-2', atTime: 15 },
    ]);

    expect(out).toHaveLength(1);
  });

  it('leaves the generated stages untouched when there are no edits', () => {
    expect(applyStructure({ ...input, stages: two() }, [])).toHaveLength(2);
  });
});
