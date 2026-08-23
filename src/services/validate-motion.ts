import {
  CONTINUITY_KINDS,
  MOTION_EVENT_TYPES,
  RECREATE_PLATFORMS,
  type ContinuityKind,
  type EventCamera,
  type EventExplanations,
  type EventHypothesis,
  type EventObservation,
  type EventObservations,
  type EventTransition,
  type EventTypography,
  type MotionEventType,
  type RecreateGuide,
  type RecreatePlatform,
} from '../types/motion.ts';

/**
 * Runtime validation of everything that arrives from the model.
 *
 * OpenAI's strict `json_schema` mode already guarantees the *shape*, so this is
 * not a second schema engine — it is the layer that refuses to trust that
 * guarantee. An old client can meet a new model, a proxy can rewrite a body,
 * and strict mode cannot promise that a confidence is inside 0–1 or that a type
 * string is one this build knows how to render.
 *
 * It is also where "the model said nothing useful" becomes "the field is
 * absent", which is what lets the UI render silence instead of an empty box.
 */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issue: string };

const isString = (value: unknown): value is string => typeof value === 'string';
const isNonEmptyString = (value: unknown): value is string => isString(value) && value.trim().length > 0;

/** Trims, caps, and turns anything blank or absent into undefined. */
function text(value: unknown, max = 400): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  const trimmed = value.trim();
  // Models reach for these when a nullable field has nothing to say. Rendering
  // them verbatim would put the word "unknown" in the product's voice.
  if (/^(n\/?a|none|unknown|null|not applicable|not visible)\.?$/i.test(trimmed)) return undefined;
  return trimmed.slice(0, max);
}

function cleanStrings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isString).map((entry) => entry.trim()).filter(Boolean).slice(0, max);
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  // A model answering 86 instead of 0.86 is a common failure and a recoverable
  // one; anything else clamps into range.
  const normalised = value > 1 && value <= 100 ? value / 100 : value;
  return Math.min(1, Math.max(0, Number(normalised.toFixed(2))));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return isString(value) && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** Drops an object whose every field came back empty, rather than keeping a husk. */
function compact<T extends object>(value: T): T | undefined {
  return Object.values(value).some((entry) => entry !== undefined) ? value : undefined;
}

// -- Pass 1 -------------------------------------------------------------------

export interface GlobalContext {
  summary: string;
  format: string;
  motionCharacter?: string;
  typographyUse?: string;
  transitionStyle?: string;
  colorTreatment?: string;
}

export function validateGlobalContext(input: unknown): ValidationResult<GlobalContext> {
  if (!input || typeof input !== 'object') return { ok: false, issue: 'response was not an object' };
  const root = input as Record<string, unknown>;

  const summary = text(root.summary, 900);
  if (!summary) return { ok: false, issue: 'summary missing' };

  return {
    ok: true,
    value: {
      summary,
      format: text(root.format, 40) ?? 'other',
      ...(text(root.motionCharacter, 300) ? { motionCharacter: text(root.motionCharacter, 300)! } : {}),
      ...(text(root.typographyUse, 300) ? { typographyUse: text(root.typographyUse, 300)! } : {}),
      ...(text(root.transitionStyle, 300) ? { transitionStyle: text(root.transitionStyle, 300)! } : {}),
      ...(text(root.colorTreatment, 300) ? { colorTreatment: text(root.colorTreatment, 300)! } : {}),
    },
  };
}

// -- Pass 2 -------------------------------------------------------------------

export interface ModelEvent {
  /** Must match an event id the pipeline supplied. Enforced in the normalizer. */
  eventId: string;
  observations: EventObservations;
  phases?: EventObservation;
  type: MotionEventType;
  confidence: number;
  reasoning?: string;
  alternatives: EventHypothesis[];
  continuity?: { kind?: ContinuityKind; note?: string };
  title: string;
  explanations: EventExplanations;
  effects: string[];
  camera?: EventCamera;
  transition?: EventTransition;
  typography?: EventTypography;
  whyDetected?: string;
  whyItWorks?: string;
}

export function validateModelEvents(input: unknown): ValidationResult<ModelEvent[]> {
  if (!input || typeof input !== 'object') return { ok: false, issue: 'response was not an object' };
  const root = input as Record<string, unknown>;
  if (!Array.isArray(root.events)) return { ok: false, issue: 'events missing' };

  const events: ModelEvent[] = [];
  const seen = new Set<string>();

  for (const raw of root.events) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;

    const eventId = text(entry.eventId, 60);
    const title = text(entry.title, 80);
    if (!eventId || !title) continue;

    // A second answer for one event is not extra information; it is two
    // classifications competing for the same timestamp. First wins.
    if (seen.has(eventId)) continue;

    const interpretation = (entry.interpretation ?? {}) as Record<string, unknown>;
    // An unknown type is downgraded rather than dropped: the model saw
    // something real, this build simply has no bucket for it yet.
    const type = oneOf(interpretation.type, MOTION_EVENT_TYPES) ?? 'other';

    const shortExplanation = text(entry.shortExplanation, 200);
    if (!shortExplanation) continue;

    seen.add(eventId);
    const observations = readObservations(entry.observations);

    events.push({
      eventId,
      observations,
      ...maybe('phases', readPhases((entry.observations as Record<string, unknown> | undefined)?.phases)),
      type,
      confidence: clampConfidence(interpretation.confidence),
      ...maybe('reasoning', text(interpretation.reasoning, 400)),
      alternatives: readAlternatives(entry.alternatives, type),
      ...maybe('continuity', readContinuity(entry.continuity)),
      title,
      explanations: {
        short: shortExplanation,
        ...maybe('detailed', text(entry.detailedExplanation, 900)),
        ...maybe('technical', text(entry.technicalExplanation, 600)),
      },
      effects: cleanStrings(entry.effects, 6),
      ...maybe('camera', readCamera(entry.camera)),
      ...maybe('transition', readTransition(entry.transition)),
      ...maybe('typography', readTypography(entry.typography)),
      ...maybe('whyDetected', text(entry.whyDetected, 500)),
      ...maybe('whyItWorks', text(entry.whyItWorks, 500)),
    });
  }

  if (events.length === 0) return { ok: false, issue: 'no usable events' };
  return { ok: true, value: events };
}

function readObservations(value: unknown): EventObservations {
  if (!value || typeof value !== 'object') return {};
  const entry = value as Record<string, unknown>;
  const band = <T extends string>(field: unknown, allowed: readonly T[]): T | undefined => oneOf(field, allowed);

  return {
    ...maybe('horizontalMotion', band(entry.horizontalMotion, ['none', 'slight', 'moderate', 'strong'] as const)),
    ...maybe('verticalMotion', band(entry.verticalMotion, ['none', 'slight', 'moderate', 'strong'] as const)),
    ...maybe('direction', text(entry.direction, 80)),
    ...maybe('scaleProgression', band(entry.scaleProgression, ['none', 'growing', 'shrinking'] as const)),
    ...maybe('blurProgression', band(entry.blurProgression, ['none', 'increasing', 'decreasing', 'sustained'] as const)),
    ...maybe('luminanceProgression', band(entry.luminanceProgression, ['none', 'brightening', 'darkening', 'spike'] as const)),
    ...maybe('sceneIdentityChanges', typeof entry.sceneIdentityChanges === 'boolean' ? entry.sceneIdentityChanges : undefined),
    ...maybe('incomingMotion', band(entry.incomingMotion, ['none', 'continues', 'reverses', 'different'] as const)),
    ...maybe('compositionChange', text(entry.compositionChange, 300)),
    ...maybe('textPresent', typeof entry.textPresent === 'boolean' ? entry.textPresent : undefined),
  };
}

function readPhases(value: unknown): EventObservation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  return compact({
    before: text(entry.before),
    build: text(entry.build),
    peak: text(entry.peak),
    after: text(entry.after),
  });
}

/**
 * Rival readings.
 *
 * An "alternative" identical to the chosen type is not an alternative, and one
 * more confident than the primary is a contradiction rather than a hedge —
 * both are dropped so the margin term in `composeConfidence` stays meaningful.
 */
function readAlternatives(value: unknown, primary: MotionEventType): EventHypothesis[] {
  if (!Array.isArray(value)) return [];
  const out: EventHypothesis[] = [];
  for (const raw of value.slice(0, 3)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const type = oneOf(entry.type, MOTION_EVENT_TYPES);
    const reasoning = text(entry.reasoning, 240);
    if (!type || type === primary || !reasoning) continue;
    out.push({ type, confidence: clampConfidence(entry.confidence), reasoning });
  }
  return out;
}

function readContinuity(value: unknown): { kind?: ContinuityKind; note?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  return compact({
    kind: oneOf(entry.kind, CONTINUITY_KINDS),
    note: text(entry.note, 300),
  });
}

const maybe = <K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

function readCamera(value: unknown): EventCamera | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  return compact({
    movement: text(entry.movement, 200),
    intensity: oneOf(entry.intensity, ['subtle', 'moderate', 'strong'] as const),
    ambiguity: text(entry.ambiguity, 300),
  });
}

function readTransition(value: unknown): EventTransition | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  return compact({
    technique: text(entry.technique, 200),
    outgoingBehavior: text(entry.outgoingBehavior),
    transitionMoment: text(entry.transitionMoment),
    incomingBehavior: text(entry.incomingBehavior),
  });
}

function readTypography(value: unknown): EventTypography | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  if (entry.textDetected !== true) return undefined;
  return {
    textDetected: true,
    ...maybe('content', text(entry.content, 120)),
    ...maybe('animationType', text(entry.animationType, 160)),
    ...maybe('entrance', text(entry.entrance, 200)),
    ...maybe('exit', text(entry.exit, 200)),
  };
}

// -- Pass 3 -------------------------------------------------------------------

export interface Reconciliation {
  summary: string;
  corrections: Array<{ eventId: string; newType: MotionEventType; reason: string }>;
  /** Events that form one repeated device across the video. */
  relationships: Array<{ eventId: string; relatedIds: string[]; reason: string }>;
  motifs: string[];
  dnaNotes: Partial<Record<'pacing' | 'cuts' | 'motion' | 'text' | 'transitions' | 'effects', string>>;
}

export function validateReconciliation(input: unknown): ValidationResult<Reconciliation> {
  if (!input || typeof input !== 'object') return { ok: false, issue: 'response was not an object' };
  const root = input as Record<string, unknown>;

  const summary = text(root.summary, 1400);
  if (!summary) return { ok: false, issue: 'summary missing' };

  const corrections: Reconciliation['corrections'] = [];
  if (Array.isArray(root.corrections)) {
    for (const raw of root.corrections) {
      if (!raw || typeof raw !== 'object') continue;
      const entry = raw as Record<string, unknown>;
      const eventId = text(entry.eventId, 60);
      const newType = oneOf(entry.type ?? entry.newType, MOTION_EVENT_TYPES);
      const reason = text(entry.reason, 240);
      // A correction with no stated reason is an unexplained overwrite of a
      // classification that was at least grounded in frames. Dropped.
      if (!eventId || !newType || !reason) continue;
      corrections.push({ eventId, newType, reason });
    }
  }

  const notes: Reconciliation['dnaNotes'] = {};
  const rawNotes = (root.dnaNotes ?? {}) as Record<string, unknown>;
  for (const trait of ['pacing', 'cuts', 'motion', 'text', 'transitions', 'effects'] as const) {
    const note = text(rawNotes[trait], 240);
    if (note) notes[trait] = note;
  }

  const relationships: Reconciliation['relationships'] = [];
  if (Array.isArray(root.relationships)) {
    for (const raw of root.relationships) {
      if (!raw || typeof raw !== 'object') continue;
      const entry = raw as Record<string, unknown>;
      const eventId = text(entry.eventId, 60);
      const reason = text(entry.reason, 240);
      const relatedIds = cleanStrings(entry.relatedIds, 8).filter((id) => id !== eventId);
      // A relationship to nothing is not a relationship.
      if (!eventId || !reason || relatedIds.length === 0) continue;
      relationships.push({ eventId, relatedIds, reason });
    }
  }

  return {
    ok: true,
    value: { summary, corrections, relationships, motifs: cleanStrings(root.motifs, 5), dnaNotes: notes },
  };
}

// -- Recreate -----------------------------------------------------------------

export function validateRecreateGuide(input: unknown, expected: RecreatePlatform): ValidationResult<RecreateGuide> {
  if (!input || typeof input !== 'object') return { ok: false, issue: 'response was not an object' };
  const root = input as Record<string, unknown>;

  const steps = cleanStrings(root.steps, 12).map((step) => step.slice(0, 300));
  if (steps.length === 0) return { ok: false, issue: 'no steps' };

  const timing: RecreateGuide['timing'] = [];
  if (Array.isArray(root.timing)) {
    for (const raw of root.timing) {
      if (!raw || typeof raw !== 'object') continue;
      const entry = raw as Record<string, unknown>;
      const label = text(entry.label, 60);
      const value = text(entry.value, 60);
      if (label && value) timing.push({ label, value });
    }
  }

  return {
    ok: true,
    value: {
      platform: oneOf(root.platform, RECREATE_PLATFORMS) ?? expected,
      ...maybe('technique', text(root.technique, 120)),
      timing: timing.slice(0, 6),
      steps,
      ...maybe('whyThisMatches', text(root.whyThisMatches, 600)),
      caveat: text(root.caveat, 300) ?? null,
    },
  };
}
