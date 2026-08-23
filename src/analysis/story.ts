import type { EnergyPoint, MotionEvent, Scene, StoryStage } from '../types/motion.ts';
import { energyExtremes } from './energy.ts';

/**
 * The visual story arc: how the edit's energy evolves from open to close.
 *
 * Distinct from a moodboard, which answers "what should this look like". This
 * answers "how should it change over time" — and it is derived from the energy
 * curve rather than assumed, because forcing every video into hook / build /
 * peak / resolve would put a five-act structure on a fifteen-second loop that
 * has one.
 *
 * Stages are cut where the energy curve genuinely changes direction. A video
 * with a flat curve gets one stage, and says so, which is a truer description
 * than an invented arc.
 */

const MIN_STAGE_SEC = 1.2;
/** Energy must move by this much for a boundary to be a real change. */
const CHANGE_THRESHOLD = 0.18;

export function deriveStoryStages(input: {
  duration: number;
  energy: EnergyPoint[];
  scenes: Scene[];
  events: MotionEvent[];
}): StoryStage[] {
  if (input.energy.length === 0 || input.duration <= 0) return [];

  const boundaries = findTurningPoints(input.energy);
  const cuts = [0, ...boundaries, input.duration];

  const stages: StoryStage[] = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const start = cuts[index] ?? 0;
    const end = cuts[index + 1] ?? input.duration;
    if (end - start < MIN_STAGE_SEC && stages.length > 0) {
      // Too short to be its own beat: fold it into the previous stage rather
      // than reporting a stage nobody would perceive.
      const previous = stages[stages.length - 1];
      if (previous) previous.endTime = Number(end.toFixed(2));
      continue;
    }

    const inside = input.energy.filter((point) => point.startTime >= start - 0.01 && point.endTime <= end + 0.01);
    const energy = inside.length > 0 ? inside.reduce((sum, point) => sum + point.value, 0) / inside.length : 0;
    const shots = input.scenes.filter((scene) => scene.startTime >= start - 0.01 && scene.startTime < end);
    const events = input.events.filter(
      (event) => event.role === 'primary' && event.startTime >= start - 0.01 && event.startTime < end,
    );

    stages.push({
      id: `stage-${stages.length + 1}`,
      index: stages.length + 1,
      // Named after position and energy, not from a fixed template.
      name: '',
      startTime: Number(start.toFixed(2)),
      endTime: Number(end.toFixed(2)),
      energy: Number(energy.toFixed(3)),
      shotCount: shots.length,
      averageShot: shots.length > 0 ? Number((shots.reduce((sum, s) => sum + s.duration, 0) / shots.length).toFixed(2)) : 0,
      dominantEventTypes: topTypes(events),
      ...(pickFrameTime(events, start, end) !== undefined
        ? { referenceTime: pickFrameTime(events, start, end)! }
        : {}),
    });
  }

  return nameStages(stages, input.energy);
}

/** Indices where the curve reverses direction by more than the threshold. */
function findTurningPoints(curve: EnergyPoint[]): number[] {
  const points: number[] = [];
  let anchor = curve[0]?.value ?? 0;
  let rising: boolean | null = null;

  for (let index = 1; index < curve.length; index += 1) {
    const point = curve[index];
    if (!point) continue;
    const delta = point.value - anchor;
    if (Math.abs(delta) < CHANGE_THRESHOLD) continue;

    const nowRising = delta > 0;
    if (rising !== null && nowRising !== rising) points.push(point.startTime);
    rising = nowRising;
    anchor = point.value;
  }

  return points;
}

/**
 * Names each stage from where it sits and what its energy does.
 *
 * A template ("Hook / Setup / Build / Peak / Resolve") applied blindly would
 * label the quietest part of a two-stage video "Peak". The peak is whichever
 * stage actually carries the most energy.
 */
function nameStages(stages: StoryStage[], curve: EnergyPoint[]): StoryStage[] {
  if (stages.length === 0) return stages;
  if (stages.length === 1) {
    const only = stages[0];
    if (only) only.name = 'Single continuous beat';
    return stages;
  }

  const { peak } = energyExtremes(curve);
  const peakIndex = peak
    ? stages.findIndex((stage) => peak.startTime >= stage.startTime && peak.startTime < stage.endTime)
    : -1;

  return stages.map((stage, index) => {
    const isFirst = index === 0;
    const isLast = index === stages.length - 1;
    const name = isFirst
      ? 'Hook'
      : isLast
        ? 'Resolve'
        : index === peakIndex
          ? 'Peak'
          : index < peakIndex || peakIndex === -1
            ? 'Build'
            : 'Release';
    return { ...stage, name };
  });
}

function topTypes(events: MotionEvent[]): string[] {
  const tally = new Map<string, number>();
  for (const event of events) tally.set(event.type, (tally.get(event.type) ?? 0) + 1);
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type]) => type);
}

/** A frame worth showing for this stage: the strongest event in it. */
function pickFrameTime(events: MotionEvent[], start: number, end: number): number | undefined {
  const best = [...events].sort((a, b) => b.confidence - a.confidence)[0];
  if (best) return best.peakTime ?? best.startTime;
  const middle = start + (end - start) / 2;
  return Number.isFinite(middle) ? Number(middle.toFixed(2)) : undefined;
}
