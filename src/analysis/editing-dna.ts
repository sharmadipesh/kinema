import type { DnaTrait, EditingDNA, MotionEvent, VideoOverview } from '../types/motion.ts';

/**
 * Editing DNA — six traits derived from the event list.
 *
 * Every value here is computed from events that survived normalization. None of
 * it is asked of the model, because a model asked to rate "pacing" out of ten
 * will happily produce a number with no relationship to the video, and a bar
 * chart is exactly the kind of UI that makes an invented number look measured.
 *
 * The normalisers below are the rates at which a trait reads as "maxed out" to
 * a person watching. They are editorial judgements, stated openly, not
 * discoveries — a 30-cuts-per-minute edit is a fast edit by any reasonable
 * standard, so that is where the Cuts bar fills.
 */

interface TraitSpec {
  /** Rate (per minute) that fills the bar. */
  full: number;
  bands: Array<{ upTo: number; label: string }>;
}

const SPECS: Record<DnaTrait, TraitSpec> = {
  pacing: {
    full: 36,
    bands: [
      { upTo: 0.16, label: 'Slow' },
      { upTo: 0.42, label: 'Moderate' },
      { upTo: 0.75, label: 'Fast' },
      { upTo: 1, label: 'Very fast' },
    ],
  },
  cuts: {
    full: 30,
    bands: [
      { upTo: 0.12, label: 'Sparse' },
      { upTo: 0.4, label: 'Occasional' },
      { upTo: 0.72, label: 'Frequent' },
      { upTo: 1, label: 'Relentless' },
    ],
  },
  motion: { full: 1, bands: LOW_TO_HIGH() },
  text: { full: 12, bands: LOW_TO_HIGH() },
  transitions: { full: 18, bands: LOW_TO_HIGH() },
  effects: { full: 18, bands: LOW_TO_HIGH() },
};

function LOW_TO_HIGH(): Array<{ upTo: number; label: string }> {
  return [
    { upTo: 0.1, label: 'None' },
    { upTo: 0.3, label: 'Low' },
    { upTo: 0.6, label: 'Moderate' },
    { upTo: 0.85, label: 'High' },
    { upTo: 1, label: 'Very high' },
  ];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function trait(dnaTrait: DnaTrait, rawValue: number): { value: number; label: string } {
  const spec = SPECS[dnaTrait];
  const value = clamp01(rawValue / spec.full);
  const label = spec.bands.find((band) => value <= band.upTo)?.label ?? spec.bands[spec.bands.length - 1]?.label ?? '—';
  return { value: Number(value.toFixed(3)), label };
}

function perMinute(count: number, duration: number): number {
  const minutes = Math.max(duration, 1) / 60;
  return count / minutes;
}

export function countByCategory(events: MotionEvent[]) {
  return {
    cuts: events.filter((event) => event.category === 'cut').length,
    transitions: events.filter((event) => event.category === 'transition').length,
    camera: events.filter((event) => event.category === 'camera').length,
    text: events.filter((event) => event.category === 'text').length,
    effects: events.filter((event) => event.category === 'effect').length,
    motion: events.filter((event) => event.category === 'motion' || event.category === 'subject').length,
    speed: events.filter((event) => event.category === 'speed').length,
  };
}

export function deriveEditingDNA(events: MotionEvent[], duration: number): EditingDNA {
  const counts = countByCategory(events);
  // Pacing counts every shot change, however it was achieved — a hard cut and a
  // whip-pan transition both move the viewer to a new shot.
  const shotChanges = counts.cuts + counts.transitions;

  const motionSamples = events
    .map((event) => event.evidence?.motionMagnitude)
    .filter((value): value is number => typeof value === 'number');
  // 0.08 normalised magnitude is a firmly hand-held or whip-level movement.
  const meanMotion = motionSamples.length
    ? motionSamples.reduce((sum, value) => sum + value, 0) / motionSamples.length / 0.08
    : 0;

  return {
    pacing: trait('pacing', perMinute(shotChanges, duration)),
    cuts: trait('cuts', perMinute(counts.cuts, duration)),
    motion: trait('motion', meanMotion),
    text: trait('text', perMinute(counts.text, duration)),
    transitions: trait('transitions', perMinute(counts.transitions, duration)),
    effects: trait('effects', perMinute(counts.effects, duration)),
  };
}

export function deriveOverview(summary: string, events: MotionEvent[], duration: number): VideoOverview {
  const counts = countByCategory(events);
  const dna = deriveEditingDNA(events, duration);
  const pacing =
    dna.pacing.label === 'Very fast'
      ? 'very fast'
      : dna.pacing.label === 'Fast'
        ? 'fast'
        : dna.pacing.label === 'Moderate'
          ? 'moderate'
          : 'slow';

  return {
    summary,
    pacing,
    sceneChanges: counts.cuts,
    transitions: counts.transitions,
    textAnimations: counts.text,
    cameraMovements: counts.camera,
    effects: counts.effects,
  };
}
