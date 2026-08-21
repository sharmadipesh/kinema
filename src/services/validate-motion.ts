import { MOTION_EVENT_TYPES, RECREATE_PLATFORMS, type MotionEventType, type RecreateGuide, type RecreatePlatform } from '../types/motion.ts';

/**
 * Runtime validation of everything that arrives from the model.
 *
 * OpenAI's strict `json_schema` mode already guarantees the *shape*, so this is
 * not a second schema engine — it is the layer that refuses to trust that
 * guarantee. An old client can meet a new model, a proxy can rewrite a body,
 * and strict mode cannot promise that a confidence is inside 0–1 or that a type
 * string is one we know how to render.
 *
 * Hand-rolled rather than a schema library, matching the reference project: the
 * job here is normalisation and clamping as much as it is checking, and there
 * is nothing a dependency would do better.
 */

export interface ModelEvent {
  /** Must match a candidate the local pass produced. Enforced in the normalizer. */
  candidateId: string;
  type: MotionEventType;
  title: string;
  description: string;
  confidence: number;
  effects: string[];
}

export interface ModelAnalysis {
  summary: string;
  events: ModelEvent[];
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issue: string };

const isString = (value: unknown): value is string => typeof value === 'string';
const isNonEmptyString = (value: unknown): value is string => isString(value) && value.trim().length > 0;

function cleanStrings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isString)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, max);
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  // A model that answers 86 instead of 0.86 is a common failure and a
  // recoverable one; anything else clamps into range.
  const normalised = value > 1 && value <= 100 ? value / 100 : value;
  return Math.min(1, Math.max(0, Number(normalised.toFixed(2))));
}

export function validateModelAnalysis(input: unknown): ValidationResult<ModelAnalysis> {
  if (!input || typeof input !== 'object') return { ok: false, issue: 'response was not an object' };
  const root = input as Record<string, unknown>;

  if (!isNonEmptyString(root.summary)) return { ok: false, issue: 'summary missing' };
  if (!Array.isArray(root.events)) return { ok: false, issue: 'events missing' };

  const events: ModelEvent[] = [];
  for (const raw of root.events) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;

    if (!isNonEmptyString(entry.candidateId)) continue;
    if (!isNonEmptyString(entry.title)) continue;
    if (!isNonEmptyString(entry.description)) continue;

    // An unknown type is downgraded rather than dropped: the model saw
    // something real, we simply have no bucket for it yet.
    const type = MOTION_EVENT_TYPES.includes(entry.type as MotionEventType)
      ? (entry.type as MotionEventType)
      : 'other';

    events.push({
      candidateId: entry.candidateId.trim(),
      type,
      title: entry.title.trim().slice(0, 80),
      description: entry.description.trim().slice(0, 400),
      confidence: clampConfidence(entry.confidence),
      effects: cleanStrings(entry.effects, 6),
    });
  }

  if (events.length === 0) return { ok: false, issue: 'no usable events' };

  return { ok: true, value: { summary: root.summary.trim().slice(0, 600), events } };
}

export function validateRecreateGuide(input: unknown, expected: RecreatePlatform): ValidationResult<RecreateGuide> {
  if (!input || typeof input !== 'object') return { ok: false, issue: 'response was not an object' };
  const root = input as Record<string, unknown>;

  const steps = cleanStrings(root.steps, 12).map((step) => step.slice(0, 300));
  if (steps.length === 0) return { ok: false, issue: 'no steps' };

  const platform = RECREATE_PLATFORMS.includes(root.platform as RecreatePlatform)
    ? (root.platform as RecreatePlatform)
    : expected;

  const caveat = isNonEmptyString(root.caveat) ? root.caveat.trim().slice(0, 300) : null;

  return { ok: true, value: { platform, steps, caveat } };
}
