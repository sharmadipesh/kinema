import type { EvidenceFrame } from '../types/analysis.ts';
import type { MotionAnalysis, StoryStage } from '../types/motion.ts';

/**
 * Structural checks over a finished analysis.
 *
 * Worth being honest about what this is for. Most of these invariants hold
 * today by construction: `deriveStoryStages` builds stages from consecutive
 * boundaries so they cannot have gaps, and the edit map and the story board are
 * derived from the same array so they cannot disagree. Asserting that now finds
 * nothing.
 *
 * It is written anyway, and written first, because stage editing is about to
 * make every one of those a property a *user* can break — a split with a bad
 * boundary, a merge across a gap, a frame chosen from another analysis. A
 * validator added after the editing that needs it is a validator written
 * against the bugs you already shipped.
 *
 * Findings never delete anything. They downgrade a readiness row and say what
 * is wrong, because a half-correct board with a named fault is more use to an
 * editor than a blank panel.
 */

export type ConsistencySeverity = 'error' | 'warning';

export interface ConsistencyFinding {
  id: string;
  severity: ConsistencySeverity;
  title: string;
  detail: string;
  /** Stage ids involved, when the fault is localised. */
  stageIds?: string[];
}

export interface ConsistencyInput {
  analysis: MotionAnalysis;
  frames: EvidenceFrame[];
}

/** Times closer than this are the same instant; boundaries are stored to 2dp. */
const EPSILON = 0.05;

export function checkConsistency(input: ConsistencyInput): ConsistencyFinding[] {
  const { analysis, frames } = input;
  const stages = analysis.blueprint?.storyStages ?? [];
  const findings: ConsistencyFinding[] = [];

  if (stages.length === 0) return findings;

  findings.push(...checkStageIdentity(stages));
  findings.push(...checkStageRanges(stages, analysis.video.duration));
  findings.push(...checkFrameOwnership(stages, frames, analysis.id));
  findings.push(...checkCanonicalStages(analysis));
  findings.push(...checkCutMap(analysis));

  return findings;
}

/** Ids must be unique, and the ordinals must actually order. */
function checkStageIdentity(stages: StoryStage[]): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const stage of stages) {
    if (seen.has(stage.id)) duplicates.add(stage.id);
    seen.add(stage.id);
  }

  if (duplicates.size > 0) {
    findings.push({
      id: 'stage-ids-duplicated',
      severity: 'error',
      title: 'Duplicate stage identifiers',
      detail: `${[...duplicates].join(', ')} appear more than once, so edits and frames cannot be attributed reliably.`,
      stageIds: [...duplicates],
    });
  }

  const outOfOrder = stages.some((stage, index) => index > 0 && stage.startTime < (stages[index - 1]?.startTime ?? 0));
  if (outOfOrder) {
    findings.push({
      id: 'stages-out-of-order',
      severity: 'error',
      title: 'Stages are out of order',
      detail: 'The story board is not in chronological order, so its sequence does not describe the edit.',
    });
  }

  return findings;
}

/** Ranges must be positive, non-overlapping, and cover the running time. */
function checkStageRanges(stages: StoryStage[], duration: number): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];
  const ordered = [...stages].sort((a, b) => a.startTime - b.startTime);

  const invalid = ordered.filter((stage) => !(stage.endTime > stage.startTime));
  if (invalid.length > 0) {
    findings.push({
      id: 'stage-range-invalid',
      severity: 'error',
      title: 'Stage with no duration',
      detail: `${invalid.map((stage) => stage.name).join(', ')} ${invalid.length === 1 ? 'has' : 'have'} an end at or before the start.`,
      stageIds: invalid.map((stage) => stage.id),
    });
  }

  const overlaps: string[] = [];
  const gaps: string[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current) continue;
    const delta = current.startTime - previous.endTime;
    if (delta < -EPSILON) overlaps.push(`${previous.name} → ${current.name}`);
    else if (delta > EPSILON) gaps.push(`${fixed(previous.endTime)}–${fixed(current.startTime)}s`);
  }

  if (overlaps.length > 0) {
    findings.push({
      id: 'stage-overlap',
      severity: 'error',
      title: 'Stages overlap',
      detail: `${overlaps.join(', ')} share time, so a moment belongs to two beats at once.`,
    });
  }

  if (gaps.length > 0) {
    findings.push({
      id: 'stage-gap',
      severity: 'error',
      title: 'Story board has uncovered time',
      detail: `Nothing describes ${gaps.join(', ')}. A board with holes cannot be used to rebuild the edit.`,
    });
  }

  // Head and tail. A board that starts at four seconds is missing an opening.
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (first && first.startTime > EPSILON) {
    findings.push({
      id: 'stage-head-gap',
      severity: 'warning',
      title: 'Board starts late',
      detail: `The first stage begins at ${fixed(first.startTime)}s, so the opening is not described.`,
    });
  }
  if (last && duration - last.endTime > Math.max(EPSILON, duration * 0.02)) {
    findings.push({
      id: 'stage-tail-gap',
      severity: 'warning',
      title: 'Board ends early',
      detail: `The last stage ends at ${fixed(last.endTime)}s of ${fixed(duration)}s.`,
    });
  }

  return findings;
}

/**
 * A stage may only point at a frame from its own analysis.
 *
 * The failure this catches is subtle and would be invisible on screen: a frame
 * id carried over from a previous analysis still renders a perfectly plausible
 * picture, of a completely different video.
 */
function checkFrameOwnership(stages: StoryStage[], frames: EvidenceFrame[], analysisId: string): ConsistencyFinding[] {
  const available = new Set(frames.map((frame) => frame.id));
  const foreign: string[] = [];
  const dangling: string[] = [];

  for (const stage of stages) {
    const id = stage.referenceFrameId;
    if (!id) continue;
    if (!id.startsWith(`${analysisId}:`)) foreign.push(stage.name);
    else if (!available.has(id)) dangling.push(stage.name);
  }

  const findings: ConsistencyFinding[] = [];
  if (foreign.length > 0) {
    findings.push({
      id: 'frame-foreign',
      severity: 'error',
      title: 'Stage frame belongs to another analysis',
      detail: `${foreign.join(', ')} reference a frame from a different analysis, which would show the wrong video.`,
    });
  }
  if (dangling.length > 0) {
    findings.push({
      id: 'frame-missing',
      severity: 'warning',
      title: 'Stage frame is no longer stored',
      detail: `${dangling.join(', ')} recorded a frame that the store has since evicted.`,
    });
  }
  return findings;
}

/**
 * The story board and the edit map must describe the same set of beats.
 *
 * They are derived from one array today, so this cannot currently fire. It
 * exists because a merge or a split changes one of them first.
 */
function checkCanonicalStages(analysis: MotionAnalysis): ConsistencyFinding[] {
  const stages = analysis.blueprint?.storyStages ?? [];
  const editMap = analysis.blueprint?.editorToolkit?.editMap ?? [];
  if (editMap.length === 0) return [];

  if (editMap.length !== stages.length) {
    return [
      {
        id: 'canonical-stage-count',
        severity: 'error',
        title: 'Story and Edit describe different beats',
        detail: `The story board has ${stages.length} stage${stages.length === 1 ? '' : 's'} and the edit map has ${editMap.length}. One of them is out of date.`,
      },
    ];
  }

  const ordered = [...stages].sort((a, b) => a.startTime - b.startTime);
  const mismatched = ordered.filter((stage, index) => {
    const row = editMap[index];
    return row ? Math.abs(row.startTime - stage.startTime) > EPSILON : true;
  });

  if (mismatched.length > 0) {
    return [
      {
        id: 'canonical-stage-times',
        severity: 'error',
        title: 'Story and Edit disagree on timing',
        detail: `${mismatched.map((stage) => stage.name).join(', ')} start at a different time in the edit map.`,
        stageIds: mismatched.map((stage) => stage.id),
      },
    ];
  }

  return [];
}

/** Every marked cut has to be inside the video it claims to describe. */
function checkCutMap(analysis: MotionAnalysis): ConsistencyFinding[] {
  const cuts = analysis.blueprint?.editorToolkit?.cutMap ?? [];
  const duration = analysis.video.duration;
  const outside = cuts.filter((cut) => cut.time < 0 || cut.time > duration + EPSILON);

  if (outside.length === 0) return [];
  return [
    {
      id: 'cut-outside-duration',
      severity: 'error',
      title: 'Cut marked outside the video',
      detail: `${outside.length} cut${outside.length === 1 ? '' : 's'} fall outside 0–${fixed(duration)}s and cannot be real.`,
    },
  ];
}

const fixed = (value: number): string => value.toFixed(2).replace(/\.00$/, '');
