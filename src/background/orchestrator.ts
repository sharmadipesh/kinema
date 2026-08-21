import { ANALYSIS_FRAME, EVIDENCE, coarseTimestamps, fineTimestamps, profileFor } from '../analysis/config.ts';
import { detectCandidates, refineCandidate } from '../analysis/candidates.ts';
import { normalizeAnalysis } from '../analysis/normalizer.ts';
import type { Candidate, EvidenceFrame } from '../types/analysis.ts';
import type { VideoMetadata } from '../types/motion.ts';
import type { AnalysisSource } from '../types/video.ts';
import { readSettings } from '../storage/settings.ts';
import { addHistoryItem } from '../storage/history.ts';
import { putFrames } from '../storage/frame-store.ts';
import { analyzeMotion, checkConnection } from '../services/transport/openai-transport.ts';
import { isFriendlyError, localError, unknownError } from '../utils/errors.ts';
import { createId } from '../utils/id.ts';
import { log } from '../utils/logger.ts';
import { throwIfAborted } from '../utils/schedule.ts';
import { advance, completeSession, failSession, getUpload } from './session-registry.ts';
import { createSampler, type FrameSampler } from './samplers.ts';

/**
 * The analysis pipeline.
 *
 * The shape of it is the whole argument for this product being possible at a
 * sane cost: local frame differencing decides *where* to look, and the model is
 * only ever asked *what happened* at the two dozen moments that survived. A
 * thirty-second video is a thousand frames; this sends about thirty of them,
 * and none of them chosen at random.
 *
 * Every stage is a real stage. The progress list in the panel is this function's
 * actual position, not a timer pretending to be one.
 */

export interface RunContext {
  sessionId: string;
  source: AnalysisSource;
  label: string;
  signal: AbortSignal;
}

export async function runAnalysis(context: RunContext): Promise<void> {
  const { sessionId, signal } = context;
  let sampler: FrameSampler | null = null;

  try {
    advance(sessionId, 'preparing');

    // Checked first, deliberately. Discovering there is no API key *after*
    // scrubbing someone's video for two minutes would be indefensible.
    const connection = await checkConnection();
    if (!connection.ready) throw connection.problem ?? localError('KEY_MISSING');

    const settings = await readSettings();
    const profile = profileFor(settings.samplingRate);
    sampler = createSampler(context.source, getUpload(), sessionId);

    // Minted before any frame is captured, because every frame id carries it as
    // a prefix — that is how the panel later finds an event's frames in
    // IndexedDB without needing to be told which analysis it is looking at.
    const analysisId = createId('analysis');

    // -- Metadata ------------------------------------------------------------
    advance(sessionId, 'reading_video');
    const video: VideoMetadata = await sampler.metadata();
    throwIfAborted(signal);
    if (!video.duration || video.duration < 0.8) throw localError('VIDEO_INACCESSIBLE');

    // -- Coarse pass ---------------------------------------------------------
    const coarseTimes = coarseTimestamps(video.duration, profile);
    advance(sessionId, 'coarse_sampling', `${coarseTimes.length} frames`);
    const coarse = await sampler.sampleCoarse(coarseTimes, ANALYSIS_FRAME);
    throwIfAborted(signal);
    if (coarse.length < 3) throw localError('SEEK_FAILED');

    // -- Candidates ----------------------------------------------------------
    advance(sessionId, 'detecting_scenes');
    const detection = detectCandidates(coarse, profile.maxCandidates);
    throwIfAborted(signal);
    if (detection.candidates.length === 0) throw localError('NO_CANDIDATES');
    log.debug('candidates detected', { count: detection.candidates.length, threshold: detection.threshold });

    // -- Fine pass -----------------------------------------------------------
    // The coarse pass can only say "somewhere in this third of a second". This
    // is what earns the right to print 00:04.32.
    const refined: Candidate[] = [];
    let fineFrameCount = 0;
    for (const [index, candidate] of detection.candidates.entries()) {
      throwIfAborted(signal);
      advance(sessionId, 'fine_sampling', `${index + 1} / ${detection.candidates.length}`);
      const times = fineTimestamps(candidate.time, video.duration, profile);
      if (times.length < 3) {
        refined.push(candidate);
        continue;
      }
      try {
        const fine = await sampler.sampleFine(times, ANALYSIS_FRAME);
        fineFrameCount += fine.length;
        refined.push(refineCandidate(candidate, fine));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        // One unrefined candidate keeps its coarse timestamp rather than
        // sinking the run. Its precision is worse; it is not wrong.
        log.warn('fine pass failed for candidate', { id: candidate.id });
        refined.push(candidate);
      }
    }

    // -- Evidence ------------------------------------------------------------
    const plan = planEvidence(refined, video.duration, analysisId);
    advance(sessionId, 'capturing_evidence', `${plan.requests.length} frames`);
    if (plan.dropped > 0) {
      // Never silently. A bounded run that reads as complete coverage is a lie
      // of omission.
      log.warn('evidence budget reached, candidates dropped', { dropped: plan.dropped });
    }

    const captured = await sampler.captureEvidence(plan.requests.map(({ id, time }) => ({ id, time })));
    throwIfAborted(signal);

    const frames: EvidenceFrame[] = captured.flatMap((frame) => {
      const request = plan.requests.find((entry) => entry.id === frame.id);
      if (!request) return [];
      return [{ id: frame.id, candidateId: request.candidateId, role: request.role, time: frame.time, dataUrl: frame.dataUrl }];
    });

    const interpreted = refined.filter((candidate) => frames.some((frame) => frame.candidateId === candidate.id));
    if (interpreted.length === 0) throw localError('FRAMES_RESTRICTED');

    // -- Interpretation ------------------------------------------------------
    advance(sessionId, 'ai_analysis', `${interpreted.length} moments`);
    const model = await analyzeMotion({
      video,
      candidates: interpreted,
      frames,
      sourceLabel: context.label,
      signal,
    });
    throwIfAborted(signal);
    if (!model.ok) throw model.error;

    // -- Normalisation -------------------------------------------------------
    advance(sessionId, 'normalizing');
    const analysis = normalizeAnalysis({
      model: model.data,
      candidates: interpreted,
      frames,
      video,
      stats: {
        coarseFrames: coarse.length,
        // Counted, not extrapolated from the profile: seeks fail and windows
        // clip at the ends of a video, so the two genuinely differ.
        fineFrames: fineFrameCount,
        candidates: refined.length,
        framesSentToModel: frames.length,
      },
    });
    if (analysis.events.length === 0) throw localError('NO_CANDIDATES');

    advance(sessionId, 'building_timeline');
    await putFrames(analysisId, frames);

    if (settings.saveHistory) {
      const thumbnail = await sampler.thumbnail(video.duration * 0.1).catch(() => null);
      await addHistoryItem({
        id: analysisId,
        sourceType: context.source.kind,
        title: context.label,
        ...(context.source.kind === 'page' ? { url: context.source.pageUrl } : {}),
        analyzedAt: Date.now(),
        duration: video.duration,
        eventCount: analysis.events.length,
        ...(thumbnail ? { thumbnail } : {}),
        analysis,
      });
    }

    completeSession(sessionId, analysis);
    log.info('analysis complete', { events: analysis.events.length, frames: frames.length });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    failSession(sessionId, aborted ? localError('ABORTED') : isFriendlyError(error) ? error : unknownError());
    if (!aborted) log.warn('analysis failed', { error: String(error) });
  } finally {
    // Restores the user's playhead whether the run succeeded, failed, or was
    // cancelled halfway through a seek.
    await sampler?.release().catch(() => undefined);
  }
}

interface EvidenceRequest {
  id: string;
  candidateId: string;
  role: EvidenceFrame['role'];
  time: number;
}

/**
 * Chooses which frames to spend the budget on.
 *
 * Tiered rather than uniform: the strongest candidates get before / during /
 * after, because that triplet is what makes a whip pan legible as a whip pan.
 * Weaker ones get a single frame at the moment itself — enough to classify, not
 * enough to explain — and anything that will not fit is dropped and logged.
 *
 * Requests are returned in time order so a page video is scrubbed forwards once
 * rather than jumped around, which is both faster and far less unpleasant to
 * watch.
 */
export function planEvidence(
  candidates: Candidate[],
  duration: number,
  analysisId: string,
): { requests: EvidenceRequest[]; dropped: number } {
  const byStrength = [...candidates].sort((a, b) => b.strength - a.strength);
  const requests: EvidenceRequest[] = [];
  let dropped = 0;

  byStrength.forEach((candidate, rank) => {
    const rich = rank < EVIDENCE.richEvidenceCandidates;
    const span = candidate.endTime !== undefined ? candidate.endTime - candidate.time : 0;
    // Far enough either side to be clearly the previous and next shot, close
    // enough to still be the same moment.
    const offset = Math.max(0.22, Math.min(0.5, span * 1.4 || 0.28));

    const wanted: EvidenceRequest[] = rich
      ? ([
          { role: 'before' as const, time: clamp(candidate.time - offset, duration) },
          { role: 'during' as const, time: clamp(candidate.time, duration) },
          { role: 'after' as const, time: clamp((candidate.endTime ?? candidate.time) + offset, duration) },
        ].map((entry) => ({
          ...entry,
          id: `${analysisId}:${candidate.id}-${entry.role}`,
          candidateId: candidate.id,
        })) satisfies EvidenceRequest[])
      : [
          {
            id: `${analysisId}:${candidate.id}-during`,
            candidateId: candidate.id,
            role: 'during' as const,
            time: clamp(candidate.time, duration),
          },
        ];

    if (requests.length + wanted.length > EVIDENCE.maxFramesPerRequest) {
      dropped += 1;
      return;
    }
    requests.push(...wanted);
  });

  requests.sort((a, b) => a.time - b.time);
  return { requests, dropped };
}

const clamp = (time: number, duration: number): number =>
  Number(Math.max(0.02, Math.min(time, duration - 0.05)).toFixed(3));
