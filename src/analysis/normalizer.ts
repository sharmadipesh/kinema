import type { Candidate, CandidateCluster, EvidenceFrame } from '../types/analysis.ts';
import {
  ANALYSIS_VERSION,
  CATEGORY_OF_TYPE,
  CERTAINTY_PREFIX,
  EVENT_TYPE_LABELS,
  type Certainty,
  type ContinuityKind,
  type EditRhythm,
  type MotionAnalysis,
  type MotionEvent,
  type MotionEvidence,
  type MotionProfile,
  type Scene,
  type VideoMetadata,
} from '../types/motion.ts';
import { DEBUG } from '../config.ts';
import { checkClaims, composeConfidence, decideCertainty } from './claims.ts';
import { measureContinuity, scenesAround } from './continuity.ts';
import { deriveEditingDNA, deriveOverview } from './editing-dna.ts';
import type { GlobalContext, ModelEvent, Reconciliation } from '../services/validate-motion.ts';

/**
 * Where model output becomes product data.
 *
 * The rules enforced here are what stop the timeline from lying:
 *
 *  1. **Timestamps come from measurement, never from the model.** An event is
 *     anchored to the cluster it refers to. A model event citing an id that
 *     does not exist is dropped outright rather than placed at a guessed time.
 *  2. **Category is canonical.** A `whip_pan` filed under `text` is a slip; the
 *     type→category table wins so the filters stay trustworthy.
 *  3. **Confidence cannot exceed the evidence.** A model is free to be sure;
 *     it is not free to be surer than the measurement it was shown.
 *  4. **Direction and duration are measured or absent.** Block matching and the
 *     fine pass produced them or nothing did.
 *  5. **An unanswered event still exists.** A cluster the model skipped keeps
 *     its measured timestamp and a locally derived title, because "something
 *     changed here and we could not name it" is true and useful, and dropping
 *     it would quietly shorten the timeline.
 */

export interface NormalizeInput {
  /** The analysis id, which is also the frame-store key for its frames. */
  id: string;
  clusters: CandidateCluster[];
  modelEvents: ModelEvent[];
  frames: EvidenceFrame[];
  scenes: Scene[];
  video: VideoMetadata;
  rhythm?: EditRhythm;
  profile: MotionProfile;
  global?: GlobalContext;
  reconciliation?: Reconciliation;
  rhythmNote?: string;
  localOnly?: boolean;
  /**
   * NOTE: coverage is deliberately not an input. It is derived from the
   * finished analysis by `attachCoverage` in `analysis/coverage.ts`, because it
   * reads the normalised events and cannot be computed before they exist.
   */
  stats: MotionAnalysis['stats'];
}

export function normalizeAnalysis(input: NormalizeInput): MotionAnalysis {
  const byId = new Map(input.modelEvents.map((event) => [event.eventId, event]));
  const framesByCluster = groupFrames(input.frames);
  const corrections = new Map(
    (input.reconciliation?.corrections ?? []).map((correction) => [correction.eventId, correction]),
  );

  const related = groupRelated(input.reconciliation?.relationships ?? []);
  const events: MotionEvent[] = [];

  for (const cluster of input.clusters) {
    const model = byId.get(cluster.id);
    const frames = framesByCluster.get(cluster.id) ?? [];
    const correction = corrections.get(cluster.id);

    const primary = model
      ? fromModel(cluster, model, frames, {
          scenes: input.scenes,
          ...(correction ? { correctedType: correction.newType } : {}),
          ...(related.get(cluster.id)?.length ? { relatedIds: related.get(cluster.id)! } : {}),
        })
      : fromMeasurementOnly(cluster, frames);

    // Secondaries never reach the timeline; they explain the primary inside it.
    const secondaries = cluster.secondaries.map((candidate) => fromSecondary(candidate, cluster.id));
    if (secondaries.length > 0) primary.containsIds = secondaries.map((event) => event.id);

    events.push(primary, ...secondaries);
  }

  events.sort((a, b) => a.startTime - b.startTime || (a.role === 'primary' ? -1 : 1));

  const primaries = events.filter((event) => event.role === 'primary');
  const summary = input.reconciliation?.summary ?? input.global?.summary ?? fallbackSummary(input);

  return {
    id: input.id,
    video: input.video,
    overview: deriveOverview(summary, primaries, input.video.duration, input.rhythm),
    editingDNA: deriveEditingDNA(primaries, input.video.duration, input.scenes, input.reconciliation?.dnaNotes),
    events,
    scenes: input.scenes,
    ...(input.rhythm ? { rhythm: input.rhythm } : {}),
    motionProfile: input.profile,
    ...(input.rhythmNote ? { rhythmNote: input.rhythmNote } : {}),
    ...(input.localOnly ? { localOnly: true } : {}),
    version: ANALYSIS_VERSION,
    stats: input.stats,
  };
}

// -- Construction -------------------------------------------------------------

function evidenceOf(candidate: Candidate, frames: EvidenceFrame[]): MotionEvidence {
  const metrics = candidate.metrics;
  return {
    visualChangeScore: metrics.diff,
    histogramDistance: metrics.histDiff,
    ...(metrics.chromaDist > 0.01 ? { colorChange: metrics.chromaDist } : {}),
    ...(metrics.motionMagnitude > 0 ? { motionMagnitude: metrics.motionMagnitude } : {}),
    ...(metrics.peakVelocity !== undefined ? { peakVelocity: metrics.peakVelocity } : {}),
    ...(metrics.motionContinues !== undefined ? { motionContinues: metrics.motionContinues } : {}),
    ...(candidate.profile?.length
      ? { motionCurve: candidate.profile.map((point) => ({ time: point.time, velocity: point.velocity })) }
      : {}),
    ...(metrics.direction ? { dominantDirection: metrics.direction } : {}),
    ...(Math.abs(metrics.lumaDelta) > 0.001 ? { luminanceChange: metrics.lumaDelta } : {}),
    ...(metrics.edgeDelta < -0.01 ? { detailLoss: Math.abs(metrics.edgeDelta) } : {}),
    sampleIntervalSec: metrics.sampleIntervalSec,
    ...(frames.length > 0
      ? { frameIds: [...frames].sort((a, b) => a.order - b.order).map((frame) => frame.id) }
      : {}),
  };
}

function timingOf(cluster: CandidateCluster) {
  const candidate = cluster.primary;
  return {
    startTime: cluster.startTime,
    ...(candidate.peakTime !== undefined ? { peakTime: candidate.peakTime } : {}),
    ...(cluster.endTime > cluster.startTime + 0.001 ? { endTime: cluster.endTime } : {}),
  };
}

function titleOf(raw: string, certainty: Certainty): string {
  const prefix = CERTAINTY_PREFIX[certainty];
  if (!prefix) return raw;
  if (new RegExp(`^${prefix}\\b`, 'i').test(raw)) return raw;
  return `${prefix} ${lowerFirst(raw)}`;
}

function fromModel(
  cluster: CandidateCluster,
  model: ModelEvent,
  frames: EvidenceFrame[],
  context: { scenes: Scene[]; correctedType?: MotionEvent['type']; relatedIds?: string[] },
): MotionEvent {
  const candidate = cluster.primary;
  const type = context.correctedType ?? model.type;
  const category = CATEGORY_OF_TYPE[type];

  /**
   * Rule 3, now with teeth.
   *
   * Every observation the model made that overlaps a measurement is checked
   * against it, and disagreement costs confidence and caps certainty. A fluent
   * account of a movement that did not happen is the single most damaging
   * output this product can produce, because a creator will go and try to
   * reproduce it.
   */
  const checks = checkClaims(model.observations, candidate);
  const confidence = composeConfidence({
    modelConfidence: model.confidence,
    candidate,
    checks,
    hypotheses: model.alternatives,
  });
  const certainty = decideCertainty({ candidate, confidence, checks });

  const { previous, next } = scenesAround(context.scenes, cluster.startTime);
  const measured = measureContinuity({
    ...(previous ? { previous } : {}),
    ...(next ? { next } : {}),
    candidate,
  });
  const continuity = buildContinuity(measured, model.continuity);

  return {
    id: cluster.id,
    ...timingOf(cluster),
    timing: timingModel(cluster),
    category,
    type,
    title: titleOf(model.title, certainty),
    description: model.explanations.short,
    explanations: model.explanations,
    confidence: confidence.final,
    certainty,
    role: 'primary',
    ...(context.relatedIds?.length ? { relatedEventIds: context.relatedIds } : {}),
    ...(candidate.metrics.direction ? { direction: candidate.metrics.direction } : {}),
    ...(model.effects.length ? { effects: model.effects.slice(0, 6) } : {}),
    evidence: evidenceOf(candidate, frames),
    observations: model.observations,
    ...(checks.length ? { claimChecks: checks } : {}),
    ...(continuity ? { continuity } : {}),
    ...(model.phases ? { observation: model.phases } : {}),
    ...(mergeMotion(model, candidate) ? { motion: mergeMotion(model, candidate)! } : {}),
    ...(model.camera ? { camera: model.camera } : {}),
    ...(model.transition ? { transition: model.transition } : {}),
    ...(model.typography ? { typography: model.typography } : {}),
    ...(model.whyDetected ? { whyDetected: model.whyDetected } : {}),
    ...(model.whyItWorks ? { whyItWorks: model.whyItWorks } : {}),
    ...(model.explanations.technical ? { recreationHint: model.explanations.technical } : {}),
    ...(DEBUG
      ? {
          diagnostics: {
            candidateKind: candidate.kind,
            candidateStrength: candidate.strength,
            candidateQuality: candidate.quality,
            hypotheses: model.alternatives,
            confidence,
            sampleTimes: candidate.profile?.map((entry) => entry.time) ?? [],
            mergedFrom: cluster.secondaries.map((entry) => entry.id),
          },
        }
      : {}),
  };
}

/**
 * Measured direction and scale always win over the model's impression.
 *
 * The descriptive band comes from the model's observations, but only after
 * those observations survived `checkClaims` — a "strong" that contradicted a
 * still frame has already cost the event its confidence by the time it reaches
 * here.
 */
function mergeMotion(model: ModelEvent, candidate: Candidate): MotionEvent['motion'] | undefined {
  const strength = model.observations.horizontalMotion ?? model.observations.verticalMotion;
  const merged = {
    ...(strength && strength !== 'none' ? { magnitude: strength } : {}),
    ...(candidate.metrics.direction ? { direction: candidate.metrics.direction } : {}),
    ...(candidate.metrics.scaleChange ? { scaleChange: candidate.metrics.scaleChange } : {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Measured continuity wins; the model may only add what measurement cannot see.
 *
 * A subject or a composition carrying across a cut is real, common, and beyond
 * anything a 64x36 luma buffer can identify — so those readings are kept and
 * marked inferred. A claim about *movement* that disagrees with the measured
 * vectors is dropped, because that one was checkable and did not check out.
 */
function buildContinuity(
  measured: ContinuityKind | undefined,
  claimed: { kind?: ContinuityKind; note?: string } | undefined,
): MotionEvent['continuity'] | undefined {
  const beyondMeasurement: ContinuityKind[] = ['subject-matched', 'shape-matched', 'composition-matched'];
  const interpreted =
    claimed?.kind && (beyondMeasurement.includes(claimed.kind) || !measured) ? claimed.kind : undefined;

  const result = {
    ...(measured ? { measured } : {}),
    ...(interpreted ? { interpreted } : {}),
    ...(claimed?.note ? { note: claimed.note } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Phase boundaries, from measurement only.
 *
 * `boundary` is where the change actually lands and `peak` is where movement is
 * strongest; the gap between them is what separates a whip pan from a fast pan
 * beside a cut. Phases the fine pass could not resolve stay absent.
 */
function timingModel(cluster: CandidateCluster): MotionEvent['timing'] {
  const candidate = cluster.primary;
  const profile = candidate.profile ?? [];
  const build = profile.length > 2 ? profile[Math.floor(profile.length * 0.25)]?.time : undefined;
  const settle = profile.length > 2 ? profile[Math.floor(profile.length * 0.75)]?.time : undefined;

  return {
    start: cluster.startTime,
    ...(build !== undefined && build > cluster.startTime ? { build } : {}),
    ...(candidate.metrics.peakVelocityTime !== undefined ? { peak: candidate.metrics.peakVelocityTime } : {}),
    ...(candidate.peakTime !== undefined ? { boundary: candidate.peakTime } : {}),
    ...(settle !== undefined && settle < cluster.endTime ? { settle } : {}),
    ...(cluster.endTime > cluster.startTime + 0.001 ? { end: cluster.endTime } : {}),
  };
}

/** Reconciliation may link separate events; index them by source. */
function groupRelated(relationships: Array<{ eventId: string; relatedIds: string[] }>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const entry of relationships) map.set(entry.eventId, entry.relatedIds);
  return map;
}

/**
 * Rule 5. An event the model never described, kept anyway.
 *
 * When a batch fails — or the model simply declines a moment it cannot read —
 * the alternative is a shorter timeline that silently omits a change the
 * measurements are certain about. A plain, honest marker is worth more than a
 * gap, and its `possible` certainty says exactly how much to trust it.
 */
function fromMeasurementOnly(cluster: CandidateCluster, frames: EvidenceFrame[]): MotionEvent {
  const candidate = cluster.primary;
  const type = localType(candidate);
  return {
    id: cluster.id,
    ...timingOf(cluster),
    category: CATEGORY_OF_TYPE[type],
    type,
    title: EVENT_TYPE_LABELS[type],
    description: localDescription(candidate),
    confidence: Number((candidate.quality * 0.6).toFixed(2)),
    certainty: candidate.quality >= 0.5 ? 'detected' : 'possible',
    role: 'primary',
    ...(candidate.metrics.direction ? { direction: candidate.metrics.direction } : {}),
    evidence: evidenceOf(candidate, frames),
    whyDetected: localWhy(candidate),
  };
}

function fromSecondary(candidate: Candidate, parentId: string): MotionEvent {
  const type = localType(candidate);
  return {
    id: `${parentId}::${candidate.id}`,
    startTime: candidate.time,
    ...(candidate.peakTime !== undefined ? { peakTime: candidate.peakTime } : {}),
    ...(candidate.endTime !== undefined ? { endTime: candidate.endTime } : {}),
    category: CATEGORY_OF_TYPE[type],
    type,
    title: EVENT_TYPE_LABELS[type],
    description: localDescription(candidate),
    confidence: Number((candidate.quality * 0.6).toFixed(2)),
    certainty: 'detected',
    role: 'secondary',
    ...(candidate.metrics.direction ? { direction: candidate.metrics.direction } : {}),
    evidence: evidenceOf(candidate, []),
  };
}

/** The coarsest honest classification available without a model. */
function localType(candidate: Candidate): MotionEvent['type'] {
  switch (candidate.kind) {
    case 'boundary':
      return 'scene_change';
    case 'gradual':
      return 'crossfade';
    case 'luma':
      return candidate.metrics.lumaDelta > 0 ? 'flash' : 'fade';
    case 'color':
      return 'color_change';
    case 'camera':
      if (candidate.metrics.scaleChange === 'closer') return 'push_in';
      if (candidate.metrics.scaleChange === 'farther') return 'pull_out';
      return 'camera_pan';
    default:
      return 'other';
  }
}

function localDescription(candidate: Candidate): string {
  const parts: string[] = [];
  switch (candidate.kind) {
    case 'boundary':
      parts.push('A sharp visual discontinuity — the frame changes substantially between samples.');
      break;
    case 'gradual':
      parts.push('A change spread across several frames rather than landing on one.');
      break;
    case 'luma':
      parts.push(candidate.metrics.lumaDelta > 0 ? 'The frame brightens sharply.' : 'The frame darkens sharply.');
      break;
    case 'color':
      parts.push('The palette shifts while the composition stays largely intact.');
      break;
    case 'camera':
      parts.push('Sustained movement across the frame.');
      break;
    default:
      parts.push('A measurable visual change.');
  }
  if (candidate.metrics.direction) parts.push(`Measured direction: ${candidate.metrics.direction}.`);
  return parts.join(' ');
}

function localWhy(candidate: Candidate): string {
  const metrics = candidate.metrics;
  const signals: string[] = [];
  if (metrics.diff > 0.05) signals.push(`pixel change ${metrics.diff.toFixed(2)}`);
  if (metrics.histDiff > 0.05) signals.push(`tonal shift ${metrics.histDiff.toFixed(2)}`);
  if (metrics.chromaDist > 0.05) signals.push(`colour shift ${metrics.chromaDist.toFixed(2)}`);
  if (metrics.motionMagnitude > 0.01) signals.push(`movement ${(metrics.motionMagnitude * 100).toFixed(1)}% of frame width`);
  return signals.length > 0
    ? `Local measurement flagged this moment: ${signals.join(', ')}. It was not interpreted further.`
    : 'Local measurement flagged this moment, but it was not interpreted further.';
}

function fallbackSummary(input: NormalizeInput): string {
  const shots = input.rhythm ? `${input.rhythm.shotCount} shots averaging ${input.rhythm.averageShot.toFixed(2)}s` : 'a single continuous shot';
  return `Local analysis only: ${shots} across ${input.video.duration.toFixed(1)} seconds. Interpretation was unavailable, so events carry measured timings without a technique reading.`;
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
  // "Whip Pan Transition" -> "whip Pan Transition", but "CSS Zoom" keeps its
  // acronym: only a lone leading capital is lowered.
  if (value.length < 2) return value.toLowerCase();
  const [first = '', second = ''] = [value[0], value[1]];
  return second === second.toUpperCase() && second !== second.toLowerCase()
    ? value
    : `${first.toLowerCase()}${value.slice(1)}`;
}
