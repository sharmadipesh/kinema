import type { EvidenceFrame } from '../../types/analysis.ts';
import type { StoryStage } from '../../types/motion.ts';

/**
 * Which image, if any, honestly represents a story stage.
 *
 * A pure module because this is the decision the Story board most needs to get
 * right and most easily gets wrong. The previous rule was "nearest captured
 * frame", unbounded: a stage at 00:21 whose own frame was never stored happily
 * displayed an event frame from 00:04 — a different shot, a different location,
 * presented as this stage's reference with no caveat at all. Everything that
 * follows exists to make the difference between *the* frame and *a nearby*
 * frame visible rather than silent.
 */

/**
 * How far a substitute may sit from the intended moment before it stops being
 * a reasonable stand-in.
 *
 * 1.5s is roughly a shot at this product's typical cadence, so a frame outside
 * it is very likely from a different shot — which is precisely the substitution
 * worth refusing.
 */
export const NEARBY_TOLERANCE_SEC = 1.5;

export type StageFrame =
  /** The frame captured for this stage, restored from the frame store. */
  | { kind: 'exact'; frame: EvidenceFrame }
  /** Not the intended frame, but close enough in time to be the same shot. */
  | { kind: 'nearby'; frame: EvidenceFrame; offsetSec: number }
  /** A frame was captured for this stage, and the store no longer has it. */
  | { kind: 'evicted' }
  /** No frame was ever captured for this stage. */
  | { kind: 'none' };

export function resolveStageFrame(
  stage: StoryStage,
  frames: EvidenceFrame[],
  tolerance = NEARBY_TOLERANCE_SEC,
): StageFrame {
  if (stage.referenceFrameId) {
    const exact = frames.find((frame) => frame.id === stage.referenceFrameId);
    if (exact) return { kind: 'exact', frame: exact };
  }

  const target = stage.referenceTime ?? stage.startTime;
  const nearest = nearestFrame(frames, target);
  if (nearest) {
    const offsetSec = Math.abs(nearest.time - target);
    if (offsetSec <= tolerance) {
      return { kind: 'nearby', frame: nearest, offsetSec: Number(offsetSec.toFixed(2)) };
    }
  }

  // A stage that recorded a frame id and cannot produce the frame has lost it;
  // one that never recorded an id never had it. Different facts, different
  // sentences on screen.
  return stage.referenceFrameId ? { kind: 'evicted' } : { kind: 'none' };
}

/** Why there is no picture, in words a user can act on. */
export function stageFrameNotice(resolved: StageFrame): string | null {
  switch (resolved.kind) {
    case 'exact':
      return null;
    case 'nearby':
      return `Nearest frame, ${resolved.offsetSec.toFixed(1)}s from this stage`;
    case 'evicted':
      return 'Frame no longer stored';
    case 'none':
      return 'No frame captured';
  }
}

function nearestFrame(frames: EvidenceFrame[], time: number): EvidenceFrame | undefined {
  if (frames.length === 0) return undefined;
  return frames.reduce((best, frame) =>
    Math.abs(frame.time - time) < Math.abs(best.time - time) ? frame : best,
  );
}
