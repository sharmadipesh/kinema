import { STORAGE } from '../config.ts';
import type { FriendlyError } from '../types/domain.ts';
import { ANALYSIS_VERSION, type AnalysisSession, type AnalysisStatus, type MotionAnalysis } from '../types/motion.ts';
import type { AnalysisSource, UploadedVideo } from '../types/video.ts';
import { log } from '../utils/logger.ts';

/**
 * The one true record of what is happening.
 *
 * A session id exists so that a reply arriving from a stage that was cancelled
 * two minutes ago can be recognised and thrown away, rather than overwriting
 * the state of whatever is running now. Every stage transition and every result
 * is checked against the active id before it is allowed to land.
 *
 * The state is mirrored into `chrome.storage.session` because an MV3 service
 * worker can be terminated at any moment. Losing the in-memory copy of a
 * *completed* analysis — one the user has already paid for — would be
 * unforgivable; losing an in-flight one is merely unfortunate, and is reported
 * as a failure rather than left spinning.
 */

interface RegistryState {
  session: AnalysisSession | null;
  analysis: MotionAnalysis | null;
  source: AnalysisSource | null;
  error: FriendlyError | null;
}

let state: RegistryState = { session: null, analysis: null, source: null, error: null };
let controller: AbortController | null = null;
let upload: UploadedVideo | null = null;
let hydrated = false;

const listeners = new Set<(next: RegistryState) => void>();

export function onStateChanged(listener: (next: RegistryState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(): void {
  for (const listener of listeners) listener(state);
  void persist();
}

async function persist(): Promise<void> {
  try {
    await chrome.storage.session.set({ [STORAGE.sessionKey]: state });
  } catch (error) {
    log.warn('session persist failed', { error: String(error) });
  }
}

export async function hydrate(): Promise<RegistryState> {
  if (hydrated) return state;
  hydrated = true;
  try {
    const stored = await chrome.storage.session.get(STORAGE.sessionKey);
    const raw = stored[STORAGE.sessionKey] as RegistryState | undefined;
    if (raw && typeof raw === 'object') {
      state = raw;
      // Nothing can still be running: this worker just started. A session left
      // mid-flight is reported as failed rather than shown as in progress
      // forever.
      if (state.session && !isTerminal(state.session.status)) {
        state = {
          ...state,
          session: { ...state.session, status: 'failed' },
          error: {
            code: 'INTERRUPTED',
            message: 'That analysis was interrupted. Start it again.',
            retryable: true,
          },
        };
      }
    }
  } catch (error) {
    log.warn('session hydrate failed', { error: String(error) });
  }
  return state;
}

export function isTerminal(status: AnalysisStatus): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'failed';
}

export function getState(): RegistryState {
  return state;
}

export function setUpload(next: UploadedVideo | null): void {
  upload = next;
}

export function getUpload(): UploadedVideo | null {
  return upload;
}

/** Stamps the health fields every state change has to keep current. */
function touch(session: AnalysisSession, patch: Partial<AnalysisSession> = {}): AnalysisSession {
  const now = Date.now();
  return {
    ...session,
    ...patch,
    lastProgressAt: now,
    ...(patch.status && patch.status !== session.status ? { stageStartedAt: now } : {}),
  };
}

export function newSession(input: {
  id: string;
  videoId: string;
  sourceKind: 'page' | 'upload';
  label: string;
}): AnalysisSession {
  const now = Date.now();
  return {
    ...input,
    startedAt: now,
    status: 'preparing',
    completedStages: [],
    lastProgressAt: now,
    stageStartedAt: now,
    retries: 0,
    resumable: false,
    version: ANALYSIS_VERSION,
  };
}

export function startSession(session: AnalysisSession, source: AnalysisSource): AbortSignal {
  controller?.abort(new DOMException('Superseded by a new analysis', 'AbortError'));
  controller = new AbortController();
  state = { session, analysis: null, source, error: null };
  publish();
  return controller.signal;
}

/** Stage transitions are ignored when they belong to a superseded session. */
export function advance(sessionId: string, status: AnalysisStatus, detail?: string): void {
  const current = state.session;
  if (!current || current.id !== sessionId) return;

  const completedStages = isTerminal(status)
    ? current.completedStages
    : [...current.completedStages.filter((stage) => stage !== current.status), current.status].filter(
        (stage) => stage !== 'preparing' && stage !== 'idle',
      );

  state = {
    ...state,
    session: touch(current, {
      status,
      ...(detail !== undefined ? { detail } : { detail: undefined }),
      completedStages: [...new Set(completedStages)],
    }),
  };
  publish();
}

export function completeSession(sessionId: string, analysis: MotionAnalysis): boolean {
  const current = state.session;
  if (!current || current.id !== sessionId) return false;
  state = {
    ...state,
    session: touch(current, {
      status: 'completed',
      detail: undefined,
      resumable: false,
      completedStages: [...current.completedStages, current.status],
    }),
    analysis,
    error: null,
  };
  publish();
  return true;
}

/** Records that local artifacts survive, so the panel may offer a stage retry. */
export function markResumable(sessionId: string, resumable: boolean): void {
  const current = state.session;
  if (!current || current.id !== sessionId) return;
  state = { ...state, session: touch(current, { resumable }) };
  publish();
}

/** A stage retry keeps the session id so artifacts stay addressable. */
export function restartSession(sessionId: string): AbortSignal | null {
  const current = state.session;
  if (!current || current.id !== sessionId) return null;
  controller?.abort(new DOMException('Superseded by a retry', 'AbortError'));
  controller = new AbortController();
  state = {
    ...state,
    session: touch(current, { status: 'preparing', detail: undefined, retries: current.retries + 1 }),
    error: null,
  };
  publish();
  return controller.signal;
}

export function failSession(sessionId: string, error: FriendlyError): boolean {
  const current = state.session;
  if (!current || current.id !== sessionId) return false;

  /**
   * The first terminal reason wins.
   *
   * When the analysed video disappears, the handler aborts the run and records
   * VIDEO_REPLACED — and the orchestrator's own catch then arrives with the
   * resulting AbortError. Without this guard that second call rewrites the
   * state to "cancelled", and the user is told they cancelled something they did
   * not, while the actual reason is discarded.
   */
  if (isTerminal(current.status)) return false;

  const cancelled = error.code === 'ABORTED';
  state = {
    ...state,
    session: touch(current, { status: cancelled ? 'cancelled' : 'failed', detail: undefined }),
    error: cancelled ? null : error,
  };
  publish();
  return true;
}

export function cancelActive(sessionId: string): boolean {
  const current = state.session;
  if (!current || current.id !== sessionId || isTerminal(current.status)) return false;
  controller?.abort(new DOMException('Cancelled by user', 'AbortError'));
  controller = null;
  return true;
}

export function clearAnalysis(): void {
  controller?.abort(new DOMException('Cleared', 'AbortError'));
  controller = null;
  state = { session: null, analysis: null, source: null, error: null };
  publish();
}

/** Used when the user opens a stored analysis from History. */
export function adoptAnalysis(analysis: MotionAnalysis, label: string): void {
  state = {
    session: {
      ...newSession({ id: `history-${Date.now()}`, videoId: 'history', sourceKind: 'upload', label }),
      status: 'completed',
    },
    analysis,
    source: null,
    error: null,
  };
  publish();
}
