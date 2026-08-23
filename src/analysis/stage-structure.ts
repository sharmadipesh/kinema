import type { EnergyPoint, MotionEvent, Scene, StoryStage } from '../types/motion.ts';
import type { StageStructureEdit } from '../types/project.ts';
import { deriveEditMap } from './editor-toolkit.ts';

/**
 * Splitting and merging story beats, and rebuilding what depends on them.
 *
 * The one place in the product where a user changes a *measured* range, so it
 * is the one place the measured/interpreted rule needs an explicit carve-out
 * with rules of its own:
 *
 *  - A split boundary must be a real time strictly inside the stage. It cannot
 *    create a zero-length beat, and it cannot land outside the range it claims
 *    to divide.
 *  - Shot counts are recounted from the scene list, never apportioned. Halving
 *    "3 shots" into "1.5 and 1.5" would invent a measurement.
 *  - Energy is re-averaged from the curve over each new range, for the same
 *    reason.
 *  - The edit map is rebuilt from the new stage set rather than patched, so
 *    Story and Edit cannot drift apart — which is exactly the inconsistency the
 *    validator exists to catch, and the operation most likely to cause it.
 *
 * Edits are stored as an ordered list and replayed over the generated stages,
 * not baked in. That keeps "reset" free and means a re-analysis does not
 * inherit a boundary drawn against a different segmentation.
 */

export interface StructureInput {
  stages: StoryStage[];
  scenes: Scene[];
  energy: EnergyPoint[];
  events: MotionEvent[];
}

/** Replays every structure edit in order. Invalid ones are skipped, not thrown. */
export function applyStructure(input: StructureInput, edits: StageStructureEdit[]): StoryStage[] {
  let stages = input.stages;
  for (const edit of edits) {
    stages = edit.kind === 'split' ? splitStage(stages, edit, input) : mergeStage(stages, edit);
  }
  return renumber(stages);
}

export function splitStage(
  stages: StoryStage[],
  edit: Extract<StageStructureEdit, { kind: 'split' }>,
  input: Omit<StructureInput, 'stages'>,
): StoryStage[] {
  const index = stages.findIndex((stage) => stage.id === edit.stageId);
  const target = stages[index];
  if (!target) return stages;

  // A boundary on or outside the edge would produce a beat with no duration.
  const at = Number(edit.atTime.toFixed(2));
  if (!(at > target.startTime && at < target.endTime)) return stages;

  const left = rebuild({ ...target, id: `${target.id}a`, endTime: at }, input);
  const right = rebuild({ ...target, id: `${target.id}b`, startTime: at }, input);

  return [...stages.slice(0, index), left, right, ...stages.slice(index + 1)];
}

export function mergeStage(
  stages: StoryStage[],
  edit: Extract<StageStructureEdit, { kind: 'merge' }>,
): StoryStage[] {
  const first = stages.findIndex((stage) => stage.id === edit.stageId);
  const second = stages.findIndex((stage) => stage.id === edit.withStageId);
  if (first < 0 || second < 0 || Math.abs(first - second) !== 1) return stages;

  const [low, high] = first < second ? [first, second] : [second, first];
  const a = stages[low];
  const b = stages[high];
  if (!a || !b) return stages;

  const merged: StoryStage = {
    ...a,
    endTime: b.endTime,
    // Counts add because they are counts of disjoint sets; the average is
    // recomputed from the total rather than averaged from two averages.
    shotCount: a.shotCount + b.shotCount,
    averageShot:
      a.shotCount + b.shotCount > 0
        ? Number(((a.averageShot * a.shotCount + b.averageShot * b.shotCount) / (a.shotCount + b.shotCount)).toFixed(2))
        : 0,
    energy: Number(((a.energy + b.energy) / 2).toFixed(3)),
    dominantEventTypes: [...new Set([...a.dominantEventTypes, ...b.dominantEventTypes])].slice(0, 3),
  };

  return [...stages.slice(0, low), merged, ...stages.slice(high + 1)];
}

/** Recounts the measured fields for a changed range. */
function rebuild(stage: StoryStage, input: Omit<StructureInput, 'stages'>): StoryStage {
  const shots = input.scenes.filter(
    (scene) => scene.startTime >= stage.startTime - 0.01 && scene.startTime < stage.endTime,
  );
  const inside = input.energy.filter(
    (point) => point.startTime >= stage.startTime - 0.01 && point.endTime <= stage.endTime + 0.01,
  );
  const energy =
    inside.length > 0 ? Number((inside.reduce((sum, point) => sum + point.value, 0) / inside.length).toFixed(3)) : stage.energy;

  // The old reference frame may now sit in the other half.
  const keepsFrame =
    stage.referenceTime !== undefined &&
    stage.referenceTime >= stage.startTime &&
    stage.referenceTime < stage.endTime;

  return {
    ...stage,
    shotCount: shots.length,
    averageShot:
      shots.length > 0
        ? Number((shots.reduce((sum, scene) => sum + scene.duration, 0) / shots.length).toFixed(2))
        : 0,
    energy,
    ...(keepsFrame ? {} : { referenceTime: undefined, referenceFrameId: undefined }),
  };
}

/** Ordinals must match position after any structural change. */
function renumber(stages: StoryStage[]): StoryStage[] {
  return [...stages]
    .sort((a, b) => a.startTime - b.startTime)
    .map((stage, index) => ({ ...stage, index: index + 1 }));
}

/**
 * The edit map, rebuilt from the stage set the user is actually looking at.
 *
 * Called after any structure change so the Edit tab cannot describe a set of
 * beats the Story tab no longer has.
 */
export function rebuildEditMap(stages: StoryStage[], energy: EnergyPoint[]): ReturnType<typeof deriveEditMap> {
  return deriveEditMap(stages, energy);
}
