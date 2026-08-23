import { STORAGE } from '../config.ts';
import type { Candidate, CandidateCluster, EvidenceFrame, FrameMetrics } from '../types/analysis.ts';
import { ANALYSIS_VERSION, type Scene, type VideoMetadata } from '../types/motion.ts';
import { log } from '../utils/logger.ts';

/**
 * Everything the local pipeline produced, kept so a failed stage need not
 * re-scrub the video.
 *
 * The old behaviour threw all of it away on any error. That is worst exactly
 * where it is least deserved: a rate-limited model call discarded a complete
 * local analysis — every seek, every measurement, every extracted frame — and
 * offered the user a button that would do all of it again. Local work is
 * minutes of somebody's video scrubbing in front of them; a retryable network
 * error should not cost it.
 *
 * Frame *images* are not stored here. They already live in IndexedDB keyed by
 * analysis id, and duplicating a megabyte of base64 into `chrome.storage.session`
 * would push straight through its quota. Only the references travel.
 */

export interface AnalysisArtifacts {
  version: string;
  sessionId: string;
  analysisId: string;
  label: string;
  storedAt: number;
  video: VideoMetadata;
  candidates: Candidate[];
  clusters: CandidateCluster[];
  scenes: Scene[];
  frames: EvidenceFrame[];
  /**
   * The raw RGB bins counted during sampling, not the extracted swatches.
   *
   * Stored because a retry previously rebuilt the blueprint with an empty
   * palette: the colour section then vanished with no stated reason, and the
   * only way to get it back was a second full scrub. Bins rather than swatches
   * so a change to the extraction rules applies on resume too — and they are
   * a few hundred integers, which is nothing against the frame references
   * already here.
   */
  paletteBins: number[];
  stats: {
    coarseFrames: number;
    mediumFrames: number;
    fineFrames: number;
  };
}

const key = (sessionId: string): string => `${STORAGE.artifactsKey}:${sessionId}`;

export async function saveArtifacts(artifacts: AnalysisArtifacts): Promise<void> {
  try {
    await chrome.storage.session.set({ [key(artifacts.sessionId)]: artifacts });
    log.debug('artifacts saved', { candidates: artifacts.candidates.length, frames: artifacts.frames.length });
  } catch (error) {
    // A failed save costs a resume, not the run. Never fatal.
    log.warn('artifact save failed', { error: String(error) });
  }
}

export async function readArtifacts(sessionId: string): Promise<AnalysisArtifacts | null> {
  try {
    const stored = await chrome.storage.session.get(key(sessionId));
    const raw = stored[key(sessionId)] as AnalysisArtifacts | undefined;
    if (!raw || typeof raw !== 'object') return null;

    /**
     * A version mismatch is a hard reject rather than a best-effort read.
     *
     * Detection thresholds and the event model keep changing; splicing
     * artifacts from an older pipeline into a newer run would produce a result
     * that is internally inconsistent in ways nothing downstream could detect.
     */
    if (raw.version !== ANALYSIS_VERSION) {
      log.info('artifacts discarded: analysis version changed', { found: raw.version, expected: ANALYSIS_VERSION });
      await clearArtifacts(sessionId);
      return null;
    }

    if (!Array.isArray(raw.candidates) || !Array.isArray(raw.clusters)) return null;
    // Tolerated rather than required: an artifact set that predates the palette
    // is still worth resuming, and an empty palette is handled downstream.
    return { ...raw, paletteBins: Array.isArray(raw.paletteBins) ? raw.paletteBins : [] };
  } catch (error) {
    log.warn('artifact read failed', { error: String(error) });
    return null;
  }
}

export async function clearArtifacts(sessionId: string): Promise<void> {
  await chrome.storage.session.remove(key(sessionId)).catch(() => undefined);
}

/** Drops every stored set. Called when an analysis completes or is cleared. */
export async function clearAllArtifacts(): Promise<void> {
  try {
    const all = await chrome.storage.session.get(null);
    const stale = Object.keys(all).filter((entry) => entry.startsWith(`${STORAGE.artifactsKey}:`));
    if (stale.length > 0) await chrome.storage.session.remove(stale);
  } catch (error) {
    log.warn('artifact sweep failed', { error: String(error) });
  }
}

/** Metrics are the bulkiest part and are not needed to resume interpretation. */
export function summariseMetrics(metrics: FrameMetrics[]): { count: number; span: number } {
  const first = metrics[0]?.time ?? 0;
  const last = metrics[metrics.length - 1]?.time ?? 0;
  return { count: metrics.length, span: Number((last - first).toFixed(2)) };
}
