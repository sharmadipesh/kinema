import type { Candidate, EvidenceFrame } from '../types/analysis.ts';
import {
  CATEGORY_OF_TYPE,
  type MotionAnalysis,
  type MotionEvent,
  type VideoMetadata,
} from '../types/motion.ts';
import { deriveEditingDNA, deriveOverview } from './editing-dna.ts';
import type { ModelAnalysis, ModelEvent } from '../services/validate-motion.ts';

/**
 * Where model output becomes product data.
 *
 * The rules enforced here are what stop the timeline from lying:
 *
 *  1. **Timestamps come from measurement, never from the model.** An event is
 *     anchored to the candidate it refers to. A model event citing a candidate
 *     that does not exist is dropped outright rather than placed at a guessed
 *     time.
 *  2. **Category is canonical.** A `whip_pan` filed under `text` is a slip; the
 *     type→category table wins so the filters stay trustworthy.
 *  3. **Confidence cannot exceed the evidence.** A model is free to be sure;
 *     it is not free to be surer than the measurement it was shown.
 *  4. **Direction is measured or absent.** Block-motion estimation produced it
 *     or nothing did.
 */

const MAX_EVENTS_PER_CANDIDATE = 2;

export interface NormalizeInput {
  model: ModelAnalysis;
  candidates: Candidate[];
  frames: EvidenceFrame[];
  video: VideoMetadata;
  stats: MotionAnalysis['stats'];
}

export function normalizeAnalysis(input: NormalizeInput): MotionAnalysis {
  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const framesByCandidate = groupFrames(input.frames);
  const perCandidate = new Map<string, number>();
  const events: MotionEvent[] = [];

  for (const modelEvent of input.model.events) {
    const candidate = byId.get(modelEvent.candidateId);
    // Rule 1. No candidate, no timestamp, no event.
    if (!candidate) continue;

    const used = perCandidate.get(candidate.id) ?? 0;
    if (used >= MAX_EVENTS_PER_CANDIDATE) continue;
    perCandidate.set(candidate.id, used + 1);

    events.push(toEvent(modelEvent, candidate, framesByCandidate.get(candidate.id)));
  }

  events.sort((a, b) => a.startTime - b.startTime);

  return {
    video: input.video,
    overview: deriveOverview(input.model.summary, events, input.video.duration),
    editingDNA: deriveEditingDNA(events, input.video.duration),
    events,
    stats: input.stats,
  };
}

function toEvent(modelEvent: ModelEvent, candidate: Candidate, frames?: EvidenceFrame[]): MotionEvent {
  const category = CATEGORY_OF_TYPE[modelEvent.type];

  // Rule 3: a candidate that only just cleared the threshold caps how confident
  // the product is willing to sound about it.
  const evidenceCeiling = 0.5 + 0.5 * candidate.strength;
  const confidence = Number(Math.min(modelEvent.confidence, evidenceCeiling).toFixed(2));

  // 'detected' is reserved for events the local pass would have flagged on its
  // own. Everything else is the model's reading, and says so.
  const certainty: MotionEvent['certainty'] =
    candidate.strength >= 0.45 && modelEvent.confidence >= 0.55 ? 'detected' : 'likely';

  const title = certainty === 'likely' && !/^likely\b/i.test(modelEvent.title)
    ? `Likely ${lowerFirst(modelEvent.title)}`
    : modelEvent.title;

  const evidence = {
    visualChangeScore: candidate.metrics.diff,
    histogramDistance: candidate.metrics.histDiff,
    ...(candidate.metrics.motionMagnitude > 0 ? { motionMagnitude: candidate.metrics.motionMagnitude } : {}),
    ...(candidate.metrics.direction ? { dominantDirection: candidate.metrics.direction } : {}),
    ...(Math.abs(candidate.metrics.lumaDelta) > 0.001 ? { luminanceChange: candidate.metrics.lumaDelta } : {}),
    sampleIntervalSec: candidate.metrics.sampleIntervalSec,
    ...frameIds(frames),
  };

  return {
    id: `${candidate.id}-${category}-${events_counter(modelEvent)}`,
    startTime: candidate.time,
    ...(candidate.endTime !== undefined ? { endTime: candidate.endTime } : {}),
    category,
    type: modelEvent.type,
    title,
    description: modelEvent.description,
    confidence,
    certainty,
    // Rule 4.
    ...(candidate.metrics.direction ? { direction: candidate.metrics.direction } : {}),
    ...(modelEvent.effects.length ? { effects: modelEvent.effects.slice(0, 6) } : {}),
    evidence,
  };
}

/** Distinguishes two events anchored to the same candidate. */
function events_counter(modelEvent: ModelEvent): string {
  return modelEvent.type;
}

function frameIds(frames?: EvidenceFrame[]) {
  if (!frames?.length) return {};
  const find = (role: EvidenceFrame['role']): string | undefined => frames.find((frame) => frame.role === role)?.id;
  return {
    ...(find('before') ? { beforeFrameId: find('before') } : {}),
    ...(find('during') ? { duringFrameId: find('during') } : {}),
    ...(find('after') ? { afterFrameId: find('after') } : {}),
  };
}

function groupFrames(frames: EvidenceFrame[]): Map<string, EvidenceFrame[]> {
  const grouped = new Map<string, EvidenceFrame[]>();
  for (const frame of frames) {
    const existing = grouped.get(frame.candidateId);
    if (existing) existing.push(frame);
    else grouped.set(frame.candidateId, [frame]);
  }
  return grouped;
}

function lowerFirst(value: string): string {
  // "Whip Pan Transition" -> "whip pan transition", but "CSS Zoom" keeps its
  // acronym: only a lone leading capital is lowered.
  if (value.length < 2) return value.toLowerCase();
  const [first = '', second = ''] = [value[0], value[1]];
  return second === second.toUpperCase() && second !== second.toLowerCase()
    ? value
    : `${first.toLowerCase()}${value.slice(1)}`;
}
