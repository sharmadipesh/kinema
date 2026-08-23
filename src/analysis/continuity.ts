import type { Candidate } from '../types/analysis.ts';
import type { ContinuityKind, MotionDirection, Scene } from '../types/motion.ts';

/**
 * How the incoming shot relates to the outgoing one.
 *
 * Many professional transitions are not a named effect at all. A straight cut
 * that works because movement carries across it is a *cut on motion*, and
 * reporting it as "hard cut" describes the mechanism while missing the entire
 * technique. The relationship between the two shots is the technique.
 *
 * This module measures only what the two shots' motion vectors can support.
 * Matched subjects and matched compositions are real and common and are
 * deliberately out of scope here — no pixel measurement at 64x36 can identify a
 * person across a cut, so those stay the model's claim, marked as inferred.
 */

const OPPOSITE: Partial<Record<MotionDirection, MotionDirection>> = {
  left: 'right',
  right: 'left',
  up: 'down',
  down: 'up',
  'up-left': 'down-right',
  'down-right': 'up-left',
  'up-right': 'down-left',
  'down-left': 'up-right',
  inward: 'outward',
  outward: 'inward',
};

/** Below this a shot is static, and "direction" would be reading noise. */
const MOVING = 0.012;

export interface ContinuityInput {
  previous?: Scene;
  next?: Scene;
  candidate: Candidate;
}

/**
 * Returns undefined rather than guessing.
 *
 * A missing neighbour, two static shots, or a shot too short to have produced a
 * reliable direction all mean there is nothing to say — and "no clear
 * relationship" is a finding, not a default. It is only returned when both
 * shots genuinely moved and their directions genuinely disagree.
 */
export function measureContinuity(input: ContinuityInput): ContinuityKind | undefined {
  const { previous, next } = input;
  if (!previous || !next) return undefined;

  // A shot the sampler barely visited cannot support a direction claim.
  if (previous.sampleCount < 2 || next.sampleCount < 2) return undefined;

  const previousMoving = previous.motionLevel >= MOVING;
  const nextMoving = next.motionLevel >= MOVING;

  if (!previousMoving && !nextMoving) return undefined;
  if (previousMoving && !nextMoving) return 'motion-interrupted';
  if (!previousMoving && nextMoving) return 'motion-introduced';

  const before = previous.dominantDirection;
  const after = next.dominantDirection;
  if (!before || !after) return undefined;

  const zoomBefore = before === 'inward' || before === 'outward';
  const zoomAfter = after === 'inward' || after === 'outward';

  if (before === after) return zoomBefore ? 'scale-matched' : 'direction-matched';
  if (OPPOSITE[before] === after) return 'direction-reversed';
  // A pan into a zoom is a real change of movement, not a match.
  if (zoomBefore !== zoomAfter) return 'none';

  // Adjacent compass points read as the same movement to a viewer.
  return adjacent(before, after) ? 'direction-matched' : 'none';
}

const COMPASS: MotionDirection[] = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];

function adjacent(a: MotionDirection, b: MotionDirection): boolean {
  const first = COMPASS.indexOf(a);
  const second = COMPASS.indexOf(b);
  if (first < 0 || second < 0) return false;
  const gap = Math.abs(first - second);
  return Math.min(gap, COMPASS.length - gap) === 1;
}

/** The scenes either side of a moment, for prompts and continuity. */
export function scenesAround(scenes: Scene[], time: number): { previous?: Scene; next?: Scene } {
  const previous = [...scenes].reverse().find((scene) => scene.endTime <= time + 0.12);
  const next = scenes.find((scene) => scene.startTime >= time - 0.12);
  return {
    ...(previous ? { previous } : {}),
    ...(next && next !== previous ? { next } : {}),
  };
}
