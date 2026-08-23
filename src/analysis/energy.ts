import type { Candidate } from '../types/analysis.ts';
import type { EnergyPoint, MotionEvent, Scene } from '../types/motion.ts';

/**
 * Visual energy across the running time.
 *
 * Combines the four things that actually make a stretch of edit feel energetic:
 * how often it cuts, how much the frame moves, how many joins are doing
 * something other than a straight cut, and how hard the individual changes hit.
 * All four are already measured, so nothing here is asked of a model — an
 * energy curve a model invented would look exactly as convincing and mean
 * nothing.
 *
 * Buckets rather than a per-frame curve: at 320px a sparkline of two hundred
 * points is a smear, and the useful claim is "the middle third is the peak",
 * which needs about a dozen buckets to support.
 */

const TARGET_BUCKETS = 12;
const MIN_BUCKET_SEC = 0.6;

/** Weights: how much each signal contributes to perceived energy. */
const WEIGHTS = { cuts: 0.35, motion: 0.3, transitions: 0.2, intensity: 0.15 } as const;

export function deriveEnergy(input: {
  duration: number;
  scenes: Scene[];
  candidates: Candidate[];
  events: MotionEvent[];
}): EnergyPoint[] {
  if (input.duration <= 0) return [];

  const bucketCount = Math.max(3, Math.min(TARGET_BUCKETS, Math.floor(input.duration / MIN_BUCKET_SEC)));
  const bucketSec = input.duration / bucketCount;

  const cutTimes = input.scenes.slice(1).map((scene) => scene.startTime);
  const transitionTimes = input.events
    .filter((event) => event.role === 'primary' && event.category === 'transition')
    .map((event) => event.startTime);

  const raw = Array.from({ length: bucketCount }, (_, index) => {
    const start = index * bucketSec;
    const end = start + bucketSec;
    const within = (time: number): boolean => time >= start && time < end;

    const cuts = cutTimes.filter(within).length;
    const transitions = transitionTimes.filter(within).length;

    const inside = input.candidates.filter((candidate) => within(candidate.time));
    const motion =
      inside.length === 0
        ? sceneMotionAt(input.scenes, start + bucketSec / 2)
        : inside.reduce((sum, candidate) => sum + candidate.metrics.motionMagnitude, 0) / inside.length;
    const intensity =
      inside.length === 0 ? 0 : inside.reduce((sum, candidate) => sum + candidate.strength, 0) / inside.length;

    return { start, end, cuts, transitions, motion, intensity };
  });

  // Normalised against this video's own maxima: energy is a relative claim
  // about one edit, not a cross-video scale.
  const maxCuts = Math.max(1, ...raw.map((bucket) => bucket.cuts));
  const maxTransitions = Math.max(1, ...raw.map((bucket) => bucket.transitions));
  const maxMotion = Math.max(0.02, ...raw.map((bucket) => bucket.motion));

  return raw.map((bucket) => ({
    startTime: Number(bucket.start.toFixed(2)),
    endTime: Number(bucket.end.toFixed(2)),
    value: Number(
      Math.min(
        1,
        WEIGHTS.cuts * (bucket.cuts / maxCuts) +
          WEIGHTS.motion * (bucket.motion / maxMotion) +
          WEIGHTS.transitions * (bucket.transitions / maxTransitions) +
          WEIGHTS.intensity * bucket.intensity,
      ).toFixed(3),
    ),
    cuts: bucket.cuts,
  }));
}

function sceneMotionAt(scenes: Scene[], time: number): number {
  return scenes.find((scene) => time >= scene.startTime && time < scene.endTime)?.motionLevel ?? 0;
}

/** The most and least energetic stretches, for the pacing narrative. */
export function energyExtremes(curve: EnergyPoint[]): { peak?: EnergyPoint; quietest?: EnergyPoint } {
  if (curve.length === 0) return {};
  const sorted = [...curve].sort((a, b) => b.value - a.value);
  return { ...(sorted[0] ? { peak: sorted[0] } : {}), ...(sorted[sorted.length - 1] ? { quietest: sorted[sorted.length - 1] } : {}) };
}
