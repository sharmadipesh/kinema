import { STORAGE } from '../config.ts';
import {
  emptyProject,
  FOOTAGE_STATES,
  RECREATION_MODES,
  type FootageState,
  type ProjectRecord,
  type RecreationMode,
  type StageEdit,
} from '../types/project.ts';
import { log } from '../utils/logger.ts';

/**
 * The user's own layer over one analysis.
 *
 * Stored under its own key per analysis rather than inside the history entry,
 * for a reason that only shows up on failure: an analysis is rewritten wholesale
 * by a retry, and anything folded into it is rewritten too. Hand-chosen frames
 * and approvals surviving a retry is the entire point of letting people make
 * them.
 *
 * Validated on read like everything else in `storage/`, because this is
 * user-writable data that survives upgrades. An unknown mode or footage state
 * is dropped rather than trusted into the readiness engine, where it would
 * silently fall through a switch.
 */

const key = (analysisId: string): string => `${STORAGE.projectKey}:${analysisId}`;

export async function readProject(analysisId: string): Promise<ProjectRecord> {
  try {
    const stored = await chrome.storage.local.get(key(analysisId));
    return normalizeProject(analysisId, stored[key(analysisId)]);
  } catch (error) {
    log.warn('project read failed, using an empty one', { error: String(error) });
    return emptyProject(analysisId);
  }
}

/**
 * Applies a patch and returns the result.
 *
 * Read-modify-write rather than a blind set: the panel updates one field at a
 * time from several places, and a whole-record write from a stale copy would
 * discard whichever edit the user made last.
 */
export async function writeProject(
  analysisId: string,
  patch: Partial<Omit<ProjectRecord, 'analysisId'>>,
): Promise<ProjectRecord> {
  const current = await readProject(analysisId);
  const next = normalizeProject(analysisId, { ...current, ...patch, updatedAt: Date.now() });
  try {
    await chrome.storage.local.set({ [key(analysisId)]: next });
  } catch (error) {
    // Never fatal. Losing one confirmation is worse than nothing and much
    // better than losing the analysis the user is looking at.
    log.warn('project write failed', { error: String(error) });
  }
  return next;
}

/** Merges one stage's edit, so callers do not have to rebuild the whole map. */
export async function writeStageEdit(
  analysisId: string,
  stageId: string,
  edit: Partial<StageEdit>,
): Promise<ProjectRecord> {
  const current = await readProject(analysisId);
  const merged: StageEdit = { ...current.stageEdits[stageId], ...edit };
  // An edit with nothing left in it is removed, so "reset" leaves no trace and
  // `editedFields` stops reporting the stage as touched.
  const stageEdits = { ...current.stageEdits };
  if (Object.values(merged).every((value) => value === undefined)) delete stageEdits[stageId];
  else stageEdits[stageId] = merged;

  return writeProject(analysisId, { stageEdits });
}

/** Clears one field back to the generated value. */
export async function resetStageField(
  analysisId: string,
  stageId: string,
  field: keyof StageEdit,
): Promise<ProjectRecord> {
  const current = await readProject(analysisId);
  const existing = current.stageEdits[stageId];
  if (!existing) return current;

  const next = { ...existing };
  delete next[field];
  const stageEdits = { ...current.stageEdits };
  if (Object.keys(next).length === 0) delete stageEdits[stageId];
  else stageEdits[stageId] = next;

  return writeProject(analysisId, { stageEdits });
}

export async function deleteProject(analysisId: string): Promise<void> {
  await chrome.storage.local.remove(key(analysisId)).catch(() => undefined);
}

/**
 * Drops project records whose analysis no longer exists.
 *
 * Deleting a history entry removes its own record, but a record can also be
 * orphaned by history eviction, which happens silently once the library passes
 * its cap. Without this they accumulate against a 10MB quota forever.
 */
export async function sweepOrphanedProjects(liveAnalysisIds: string[]): Promise<number> {
  try {
    const all = await chrome.storage.local.get(null);
    const live = new Set(liveAnalysisIds.map((id) => key(id)));
    const stale = Object.keys(all).filter(
      (entry) => entry.startsWith(`${STORAGE.projectKey}:`) && !live.has(entry),
    );
    if (stale.length > 0) await chrome.storage.local.remove(stale);
    return stale.length;
  } catch (error) {
    log.warn('project sweep failed', { error: String(error) });
    return 0;
  }
}

/** Rough bytes held by projects, for the storage summary in Settings. */
export async function projectStorageBytes(): Promise<number> {
  try {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([entry]) => entry.startsWith(`${STORAGE.projectKey}:`))
      .reduce((total, [, value]) => total + JSON.stringify(value).length, 0);
  } catch {
    return 0;
  }
}

// -- Validation ---------------------------------------------------------------

export function normalizeProject(analysisId: string, raw: unknown): ProjectRecord {
  const base = emptyProject(analysisId);
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Partial<ProjectRecord>;

  return {
    analysisId,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
    ...(RECREATION_MODES.includes(value.mode as RecreationMode) ? { mode: value.mode as RecreationMode } : {}),
    brief: normalizeBrief(value.brief),
    stageEdits: normalizeStageEdits(value.stageEdits),
    structure: Array.isArray(value.structure) ? value.structure.slice(0, 200) : [],
    footage: normalizeFootage(value.footage),
    confirmations:
      value.confirmations && typeof value.confirmations === 'object'
        ? Object.fromEntries(
            Object.entries(value.confirmations).filter(([, entry]) => typeof entry === 'boolean'),
          )
        : {},
  };
}

function normalizeBrief(raw: unknown): ProjectRecord['brief'] {
  if (!raw || typeof raw !== 'object') return {};
  const value = raw as Record<string, unknown>;
  const str = (key: string, max = 80): string | undefined => {
    const entry = value[key];
    return typeof entry === 'string' && entry.trim() ? entry.trim().slice(0, max) : undefined;
  };
  const oneOf = <T extends string>(key: string, allowed: readonly T[]): T | undefined => {
    const entry = value[key];
    return typeof entry === 'string' && (allowed as readonly string[]).includes(entry) ? (entry as T) : undefined;
  };

  const duration = value.targetDurationSec;
  const crew = value.crewSize;

  return {
    ...maybe('platform', str('platform')),
    ...maybe('aspectRatio', str('aspectRatio', 16)),
    ...maybe(
      'targetDurationSec',
      typeof duration === 'number' && Number.isFinite(duration) && duration > 0
        ? Math.min(36_000, Math.round(duration))
        : undefined,
    ),
    ...maybe('fidelity', oneOf('fidelity', ['close', 'inspired'] as const)),
    ...maybe('tier', oneOf('tier', ['lean', 'creator', 'professional'] as const)),
    ...maybe(
      'crewSize',
      typeof crew === 'number' && Number.isFinite(crew) && crew >= 0 ? Math.min(999, Math.round(crew)) : undefined,
    ),
    ...maybe('equipment', str('equipment', 300)),
    ...maybe('editor', str('editor', 60)),
    ...maybe('footage', oneOf('footage', ['not-shot', 'shooting', 'available'] as const)),
    ...maybe('audio', oneOf('audio', ['none', 'reference-only', 'music-selected'] as const)),
  };
}

function normalizeStageEdits(raw: unknown): Record<string, StageEdit> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, StageEdit> = {};

  for (const [stageId, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const value = entry as Record<string, unknown>;
    const text = (key: string, max: number): string | undefined =>
      typeof value[key] === 'string' && (value[key] as string).trim()
        ? (value[key] as string).trim().slice(0, max)
        : undefined;

    const edit: StageEdit = {
      ...maybe('name', text('name', 60)),
      ...maybe('purpose', text('purpose', 300)),
      ...maybe('note', text('note', 500)),
      ...maybe('referenceFrameId', text('referenceFrameId', 120)),
      ...maybe('approved', typeof value.approved === 'boolean' ? value.approved : undefined),
      ...maybe('optional', typeof value.optional === 'boolean' ? value.optional : undefined),
      ...maybe(
        'keywords',
        Array.isArray(value.keywords)
          ? value.keywords.filter((word): word is string => typeof word === 'string').slice(0, 8)
          : undefined,
      ),
    };

    if (Object.keys(edit).length > 0) out[stageId.slice(0, 60)] = edit;
  }

  return out;
}

function normalizeFootage(raw: unknown): Record<string, FootageState> {
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter((entry): entry is [string, FootageState] =>
        FOOTAGE_STATES.includes(entry[1] as FootageState),
      )
      .slice(0, 100),
  );
}

const maybe = <K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);
