import type { StoryStage } from './motion.ts';

/**
 * What the user brings to an analysis.
 *
 * Kept in its own record, keyed by analysis id, and deliberately **not** part of
 * `MotionAnalysis`. Two reasons, and both matter:
 *
 *  - An analysis is a measurement record. It has to stay reproducible from the
 *    stored artifacts, and folding hand edits into it would make "re-derive this
 *    from the frames" a lie.
 *  - User state has a different lifetime. It survives a failed model pass, a
 *    retry, and a reopened history entry, none of which the analysis object
 *    guarantees.
 *
 * The cost of the split is that edits are keyed to one analysis id, so a fresh
 * run of the same video starts clean. Matching stages across two independent
 * segmentations is a real problem with wrong answers, and silently mapping an
 * edit onto a stage the user never saw would be worse than starting over.
 */

// -- Recreation mode ---------------------------------------------------------

/**
 * What the user is actually trying to do.
 *
 * Readiness cannot be truthful without this. "No audio was analysed" is a
 * footnote when someone is studying an edit and a blocker when they are cutting
 * to music, and a single verdict that ignores the difference is wrong for one
 * of them every time.
 */
export const RECREATION_MODES = ['study', 'shoot', 'edit', 'cutdown'] as const;
export type RecreationMode = (typeof RECREATION_MODES)[number];

export const RECREATION_MODE_LABELS: Record<RecreationMode, string> = {
  study: 'Study reference',
  shoot: 'Plan a shoot',
  edit: 'Edit footage',
  cutdown: 'Create a cutdown',
};

export const RECREATION_MODE_DESCRIPTIONS: Record<RecreationMode, string> = {
  study: 'Understand how it was made. Production assets do not matter.',
  shoot: 'Capture this from scratch. Story, camera, lighting and gear matter.',
  edit: 'Cut footage you have. Pacing, transitions and footage availability matter.',
  cutdown: 'Reshape it for a length or platform. Duration and mandatory beats matter.',
};

// -- Project brief -----------------------------------------------------------

export type Fidelity = 'close' | 'inspired';
export type ProductionTier = 'lean' | 'creator' | 'professional';
export type FootageStatus = 'not-shot' | 'shooting' | 'available';
export type AudioStatus = 'none' | 'reference-only' | 'music-selected';

/**
 * Every field optional, by design.
 *
 * An unanswered field is a decision the readiness engine can surface, never an
 * error. Only the fields a given mode actually needs are allowed to hold back a
 * verdict — a colourist studying a reference should not be asked for a crew
 * size before the product will talk to them.
 */
export interface ProjectBrief {
  platform?: string;
  aspectRatio?: string;
  targetDurationSec?: number;
  fidelity?: Fidelity;
  tier?: ProductionTier;
  crewSize?: number;
  equipment?: string;
  editor?: string;
  footage?: FootageStatus;
  audio?: AudioStatus;
}

// -- Stage edits -------------------------------------------------------------

/**
 * One user correction to a generated stage.
 *
 * Only the fields a person may change. Measured values — `startTime`,
 * `endTime`, `shotCount`, `energy` — are absent on purpose: they came from
 * pixels, and no amount of editing should be able to overwrite them with prose.
 * Splits and merges do change ranges, and go through `structure` below, where
 * the new boundary has to be a measured time.
 */
export interface StageEdit {
  name?: string;
  purpose?: string;
  note?: string;
  /** Chosen from frames already captured for this analysis. */
  referenceFrameId?: string;
  approved?: boolean;
  /** Excluded from an adaptation without being deleted. */
  optional?: boolean;
  keywords?: string[];
}

/** A user-authored change to the stage set itself. */
export type StageStructureEdit =
  | { kind: 'split'; stageId: string; atTime: number }
  | { kind: 'merge'; stageId: string; withStageId: string };

// -- Footage -----------------------------------------------------------------

export const FOOTAGE_STATES = ['unset', 'available', 'needs-capture', 'not-applicable'] as const;
export type FootageState = (typeof FOOTAGE_STATES)[number];

export const FOOTAGE_STATE_LABELS: Record<FootageState, string> = {
  unset: 'Not set',
  available: 'Available',
  'needs-capture': 'Needs capture',
  'not-applicable': 'Not applicable',
};

// -- Manual confirmations ----------------------------------------------------

/**
 * Facts no amount of pixel analysis can establish.
 *
 * Held apart from everything derived, and rendered as user-confirmed rather
 * than detected. Presenting "location secured" with the same tick as "five cuts
 * measured" would put a promise and a measurement in the same visual sentence.
 */
export const CONFIRMABLE = [
  'location',
  'talent',
  'equipment',
  'footage-captured',
  'music-licensed',
  'approval',
  'delivery-spec',
] as const;
export type Confirmable = (typeof CONFIRMABLE)[number];

export const CONFIRMABLE_LABELS: Record<Confirmable, string> = {
  location: 'Location secured',
  talent: 'Talent available',
  equipment: 'Equipment available',
  'footage-captured': 'Footage captured',
  'music-licensed': 'Music licensed',
  approval: 'Client or brand approval',
  'delivery-spec': 'Delivery specification confirmed',
};

// -- The record ---------------------------------------------------------------

export interface ProjectRecord {
  analysisId: string;
  updatedAt: number;
  mode?: RecreationMode;
  brief: ProjectBrief;
  /** Keyed by stage id. */
  stageEdits: Record<string, StageEdit>;
  structure: StageStructureEdit[];
  /** Keyed by footage checklist item text. */
  footage: Record<string, FootageState>;
  confirmations: Partial<Record<Confirmable, boolean>>;
}

export function emptyProject(analysisId: string): ProjectRecord {
  return {
    analysisId,
    updatedAt: 0,
    brief: {},
    stageEdits: {},
    structure: [],
    footage: {},
    confirmations: {},
  };
}

/**
 * The stage as the user should see it: generated values with their corrections
 * laid over the top, and never the other way round for anything measured.
 */
export function applyStageEdit(stage: StoryStage, edit: StageEdit | undefined): StoryStage {
  if (!edit) return stage;
  return {
    ...stage,
    ...(edit.name ? { name: edit.name } : {}),
    ...(edit.purpose ? { purpose: edit.purpose } : {}),
    ...(edit.referenceFrameId ? { referenceFrameId: edit.referenceFrameId } : {}),
    ...(edit.keywords?.length ? { keywords: edit.keywords } : {}),
  };
}

/** Which fields on a stage the user has overridden, for the "edited" marker. */
export function editedFields(edit: StageEdit | undefined): string[] {
  if (!edit) return [];
  const fields: string[] = [];
  if (edit.name) fields.push('name');
  if (edit.purpose) fields.push('purpose');
  if (edit.note) fields.push('note');
  if (edit.referenceFrameId) fields.push('frame');
  if (edit.keywords?.length) fields.push('keywords');
  return fields;
}
