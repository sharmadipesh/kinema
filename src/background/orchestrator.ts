import {
  ANALYSIS_FRAME,
  EVIDENCE,
  coarseTimestamps,
  fineTimestamps,
  globalTimestamps,
  mediumTimestamps,
  modeFor,
  profileFor,
} from '../analysis/config.ts';
import { activeRegions, clusterCandidates, detectCandidates, refineCandidate, sampleInterval } from '../analysis/candidates.ts';
import { normalizeAnalysis } from '../analysis/normalizer.ts';
import { deriveEditRhythm, deriveMotionProfile, describeRhythm } from '../analysis/rhythm.ts';
import { measureContinuity, scenesAround } from '../analysis/continuity.ts';
import { segmentScenes } from '../analysis/scenes.ts';
import type { Candidate, CandidateCluster, EvidenceFrame, FrameMetrics, FrameRole } from '../types/analysis.ts';
import {
  ANALYSIS_VERSION,
  type EditRhythm,
  type MotionAnalysis,
  type MotionProfile,
  type PaletteSwatch,
  type ProductionBlueprint,
  type Scene,
  type StoryStage,
  type VideoMetadata,
} from '../types/motion.ts';
import type { AnalysisSource } from '../types/video.ts';
import { attachCoverage } from '../analysis/coverage.ts';
import { deriveEnergy } from '../analysis/energy.ts';
import { extractPalette } from '../analysis/palette.ts';
import { deriveStoryStages } from '../analysis/story.ts';
import {
  deriveCutMap,
  deriveEditMap,
  deriveFootageChecklist,
  derivePacing,
  deriveSoundOpportunities,
} from '../analysis/editor-toolkit.ts';
import { readSettings } from '../storage/settings.ts';
import { addHistoryItem } from '../storage/history.ts';
import { putFrames } from '../storage/frame-store.ts';
import {
  analyzeEvents,
  analyzeGlobalContext,
  generateBlueprint,
  checkConnection,
  reconcileAnalysis,
} from '../services/transport/openai-transport.ts';
import type { GlobalContext, ModelEvent, Reconciliation } from '../services/validate-motion.ts';
import type { PromptEvent } from '../services/prompts.ts';
import { isFriendlyError, localError, unknownError } from '../utils/errors.ts';
import { createId } from '../utils/id.ts';
import { log } from '../utils/logger.ts';
import { throwIfAborted } from '../utils/schedule.ts';
import { clearArtifacts, readArtifacts, saveArtifacts, type AnalysisArtifacts } from './artifacts.ts';
import { advance, completeSession, failSession, getUpload, markResumable } from './session-registry.ts';
import { createSampler, type FrameSampler } from './samplers.ts';

/**
 * The analysis pipeline.
 *
 * The shape of it is the whole argument for this product being possible at a
 * sane cost: local frame differencing decides *where* to look, and the model is
 * only ever asked *what happened* at the moments that survived. A thirty-second
 * video is a thousand frames; this looks closely at a few dozen.
 *
 * Three things changed the quality of the output more than anything else:
 *
 *  - **A medium pass.** One fixed coarse rate meant a 400ms whip pan produced
 *    one or two elevated samples and a 60ms flash produced none. Nothing
 *    downstream can recover an event that was never sampled, so the coarse pass
 *    now only decides *where to look harder*, and detection runs on the
 *    densified series.
 *  - **Clustering.** A whip pan measures as a camera run, an edge collapse and
 *    a boundary within a few hundred milliseconds. Three markers is one fact
 *    repeated, crowding out real events elsewhere.
 *  - **Batched interpretation with real filmstrips.** One call carrying every
 *    event and every frame had to attribute dozens of images to dozens of
 *    moments before it could say anything about any of them.
 *
 * Every stage is a real stage. The progress list in the panel is this
 * function's actual position, not a timer pretending to be one.
 */

export interface RunContext {
  sessionId: string;
  source: AnalysisSource;
  label: string;
  signal: AbortSignal;
  /**
   * Skip straight to interpretation using stored artifacts.
   *
   * The point of the whole artifact mechanism: a rate-limited or timed-out
   * model call should cost one retry of that call, not a second full scrub of
   * somebody's video.
   */
  resumeFromArtifacts?: boolean;
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
    sampler = createSampler(context.source, getUpload(), sessionId);

    const stored = context.resumeFromArtifacts ? await readArtifacts(sessionId) : null;
    if (stored) {
      log.info('resuming from stored artifacts', { candidates: stored.candidates.length });
      await resumeFromArtifacts(context, stored, sampler);
      return;
    }

    const analysisId = createId('analysis');

    // -- Metadata ------------------------------------------------------------
    advance(sessionId, 'reading_video');
    const video: VideoMetadata = await sampler.metadata();
    throwIfAborted(signal);
    if (!video.duration || video.duration < 0.8) throw localError('VIDEO_INACCESSIBLE');

    // Opened before any sampling and closed in the `finally`, so the playhead
    // moves once and comes home once instead of thirty times.
    await sampler.beginSession();

    const profile = profileFor(settings.samplingRate, video.duration);
    log.debug('analysis mode', { mode: modeFor(video.duration), duration: video.duration });

    // -- Pass A: coarse sweep ------------------------------------------------
    const coarseTimes = coarseTimestamps(video.duration, profile);
    advance(sessionId, 'coarse_sampling', `${coarseTimes.length} frames`);
    const coarse = await sampler.sampleCoarse(coarseTimes, ANALYSIS_FRAME);
    throwIfAborted(signal);
    if (coarse.length < 3) throw localError('SEEK_FAILED');

    // -- Pass B: densify the busy regions ------------------------------------
    const regions = activeRegions(coarse, sampleInterval(coarse));
    const mediumTimes = mediumTimestamps(regions, video.duration, profile);
    let series: FrameMetrics[] = coarse;
    let mediumCount = 0;

    if (mediumTimes.length > 0) {
      advance(sessionId, 'medium_sampling', `${mediumTimes.length} frames in ${regions.length} regions`);
      const medium = await sampler.sampleMedium(mediumTimes, ANALYSIS_FRAME);
      throwIfAborted(signal);
      mediumCount = medium.length;
      // Detection runs on the combined, re-ordered series: a boundary found at
      // medium resolution has to be comparable against the coarse baseline for
      // the adaptive threshold to mean anything.
      series = mergeSeries(coarse, medium);
    }

    // -- Detection -----------------------------------------------------------
    advance(sessionId, 'detecting_scenes');
    const detection = detectCandidates(series, profile.maxCandidates);
    throwIfAborted(signal);
    if (detection.candidates.length === 0) throw localError('NO_CANDIDATES');
    log.debug('candidates detected', {
      count: detection.candidates.length,
      threshold: detection.threshold,
      regions: regions.length,
    });

    // -- Pass C: refine each candidate ---------------------------------------
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

    // Counted from the pixels already decoded during sampling, so the palette
    // costs no extra seeking. The bins travel into the artifacts so a retry
    // keeps the colour it already paid for.
    const paletteBins = sampler.paletteBins();
    const paletteSwatches = extractPalette(Uint32Array.from(paletteBins));

    // -- Structure -----------------------------------------------------------
    advance(sessionId, 'building_scenes');
    const clusters = clusterCandidates(refined);
    const scenes = segmentScenes(refined, series, video.duration);
    const rhythm = deriveEditRhythm(scenes, video.duration);
    const motionProfile = deriveMotionProfile(refined, scenes);
    const rhythmNote = describeRhythm(rhythm, motionProfile);
    throwIfAborted(signal);

    // -- Evidence ------------------------------------------------------------
    const plan = planEvidence(clusters, video.duration, analysisId);
    advance(sessionId, 'capturing_evidence', `${plan.requests.length} frames`);
    if (plan.dropped > 0) {
      // Never silently. A bounded run that reads as complete coverage is a lie
      // of omission.
      log.warn('evidence budget reached, events left without frames', { dropped: plan.dropped });
    }

    const captured = await sampler.captureEvidence(plan.requests.map(({ id, time }) => ({ id, time })));
    throwIfAborted(signal);

    const frames: EvidenceFrame[] = captured.flatMap((frame) => {
      const request = plan.requests.find((entry) => entry.id === frame.id);
      if (!request) return [];
      return [
        {
          id: frame.id,
          candidateId: request.candidateId,
          role: request.role,
          order: request.order,
          time: frame.time,
          dataUrl: frame.dataUrl,
        },
      ];
    });

    /**
     * Everything local is now done and worth keeping.
     *
     * Saved *before* the model is contacted, because that is the boundary
     * where failure stops being ours: a network error past this point should
     * cost one call, not the minutes of scrubbing that got us here.
     */
    await putFrames(analysisId, frames);
    await saveArtifacts({
      version: ANALYSIS_VERSION,
      sessionId,
      analysisId,
      label: context.label,
      storedAt: Date.now(),
      video,
      candidates: refined,
      clusters,
      scenes,
      frames,
      paletteBins,
      stats: { coarseFrames: coarse.length, mediumFrames: mediumCount, fineFrames: fineFrameCount },
    });
    markResumable(sessionId, true);

    // -- Interpretation ------------------------------------------------------
    const interpretation = await interpret({
      sessionId,
      signal,
      sampler,
      video,
      clusters,
      frames,
      scenes,
      ...(rhythm ? { rhythm } : {}),
      profile: motionProfile,
      label: context.label,
    });

    // -- Normalisation -------------------------------------------------------
    advance(sessionId, 'normalizing');
    const analysis = attachCoverage(
      normalizeAnalysis({
      id: analysisId,
      clusters,
      modelEvents: interpretation.events,
      frames,
      scenes,
      video,
      ...(rhythm ? { rhythm } : {}),
      profile: motionProfile,
      ...(interpretation.global ? { global: interpretation.global } : {}),
      ...(interpretation.reconciliation ? { reconciliation: interpretation.reconciliation } : {}),
      ...(rhythmNote ? { rhythmNote } : {}),
      ...(interpretation.localOnly ? { localOnly: true } : {}),
      stats: {
        coarseFrames: coarse.length,
        mediumFrames: mediumCount,
        fineFrames: fineFrameCount,
        candidates: refined.length,
        clusters: clusters.length,
        framesSentToModel: interpretation.localOnly ? 0 : frames.length + interpretation.globalFrames,
        modelCalls: interpretation.calls,
      },
      }),
      {
        candidates: refined,
        frames,
        localOnly: interpretation.localOnly ?? false,
        interpretedClusters: interpretation.events.length,
        totalClusters: clusters.length,
        frameAccessRestricted: frames.length === 0,
      },
    );

    advance(sessionId, 'building_timeline');

    const enriched = await buildBlueprint({
      sessionId,
      signal,
      sampler,
      analysis,
      analysisId,
      scenes,
      candidates: refined,
      ...(rhythm ? { rhythm } : {}),
      profile: motionProfile,
      palette: paletteSwatches,
      globalSummary: interpretation.global?.summary ?? null,
      label: context.label,
      localOnly: interpretation.localOnly ?? false,
    });

    if (settings.saveHistory) {
      const thumbnail = await sampler.thumbnail(video.duration * 0.1).catch(() => null);
      await addHistoryItem({
        id: analysisId,
        sourceType: context.source.kind,
        title: context.label,
        ...(context.source.kind === 'page' ? { url: context.source.pageUrl } : {}),
        analyzedAt: Date.now(),
        duration: video.duration,
        eventCount: analysis.events.filter((event) => event.role === 'primary').length,
        ...(thumbnail ? { thumbnail } : {}),
        analysis: enriched,
      });
    }

    await clearArtifacts(sessionId);
    completeSession(sessionId, enriched);
    log.info('analysis complete', {
      events: analysis.events.length,
      scenes: scenes.length,
      calls: interpretation.calls,
      localOnly: interpretation.localOnly ?? false,
    });
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

/**
 * Re-runs interpretation over stored artifacts.
 *
 * Identical to the tail of `runAnalysis` from the model call onward, and
 * deliberately shares `interpret` and `normalizeAnalysis` rather than
 * duplicating them — two code paths that must agree about what an analysis is
 * would drift, and the resumed one would drift silently because it runs rarely.
 */
async function resumeFromArtifacts(
  context: RunContext,
  stored: AnalysisArtifacts,
  sampler: FrameSampler,
): Promise<void> {
  const { sessionId, signal } = context;

  const rhythm = deriveEditRhythm(stored.scenes, stored.video.duration);
  const motionProfile = deriveMotionProfile(stored.candidates, stored.scenes);
  const rhythmNote = describeRhythm(rhythm, motionProfile);
  // Recovered rather than recomputed: re-counting the bins would mean sampling
  // the whole video again, which is the entire thing a resume exists to avoid.
  const paletteSwatches = extractPalette(Uint32Array.from(stored.paletteBins));

  /**
   * A resume still captures frames — global thumbnails and one per story stage
   * — and for a page video that means scrubbing. Without an outer session every
   * one of those calls restored the playhead on its own, so a retry snapped the
   * user's video home and away a dozen times. Held for the whole resume and
   * released in the `finally`, exactly as the full run does.
   */
  await sampler.beginSession();

  const interpretation = await interpret({
    sessionId,
    signal,
    sampler,
    video: stored.video,
    clusters: stored.clusters,
    frames: stored.frames,
    scenes: stored.scenes,
    ...(rhythm ? { rhythm } : {}),
    profile: motionProfile,
    label: stored.label,
  });

  advance(sessionId, 'normalizing');
  const analysis = attachCoverage(
    normalizeAnalysis({
      id: stored.analysisId,
      clusters: stored.clusters,
      modelEvents: interpretation.events,
      frames: stored.frames,
      scenes: stored.scenes,
      video: stored.video,
      ...(rhythm ? { rhythm } : {}),
      profile: motionProfile,
      ...(interpretation.global ? { global: interpretation.global } : {}),
      ...(interpretation.reconciliation ? { reconciliation: interpretation.reconciliation } : {}),
      ...(rhythmNote ? { rhythmNote } : {}),
      ...(interpretation.localOnly ? { localOnly: true } : {}),
      stats: {
        ...stored.stats,
        candidates: stored.candidates.length,
        clusters: stored.clusters.length,
        framesSentToModel: interpretation.localOnly ? 0 : stored.frames.length + interpretation.globalFrames,
        modelCalls: interpretation.calls,
      },
    }),
    {
      candidates: stored.candidates,
      frames: stored.frames,
      localOnly: interpretation.localOnly ?? false,
      interpretedClusters: interpretation.events.length,
      totalClusters: stored.clusters.length,
      frameAccessRestricted: stored.frames.length === 0,
    },
  );

  advance(sessionId, 'building_timeline');

  const enriched = await buildBlueprint({
    sessionId,
    signal,
    sampler,
    analysis,
    analysisId: stored.analysisId,
    scenes: stored.scenes,
    candidates: stored.candidates,
    ...(rhythm ? { rhythm } : {}),
    profile: motionProfile,
    palette: paletteSwatches,
    globalSummary: interpretation.global?.summary ?? null,
    label: stored.label,
    localOnly: interpretation.localOnly ?? false,
  });

  const settings = await readSettings();
  if (settings.saveHistory) {
    const thumbnail = await sampler.thumbnail(stored.video.duration * 0.1).catch(() => null);
    await addHistoryItem({
      id: stored.analysisId,
      sourceType: context.source.kind,
      title: context.label,
      ...(context.source.kind === 'page' ? { url: context.source.pageUrl } : {}),
      analyzedAt: Date.now(),
      duration: stored.video.duration,
      eventCount: analysis.events.filter((event) => event.role === 'primary').length,
      ...(thumbnail ? { thumbnail } : {}),
      analysis: enriched,
    });
  }

  await clearArtifacts(sessionId);
  completeSession(sessionId, enriched);
  log.info('analysis resumed and completed', { calls: interpretation.calls });
}

/**
 * Story arc, energy, editor toolkit and the production blueprint.
 *
 * Everything derivable is derived first and handed to the model rather than
 * asked of it: the energy curve, the story segmentation, the cut map, the
 * pacing, the colour palette counted from real pixels. What comes back is the
 * judgement layer — which gear, which lenses, which lighting, what an editor
 * should watch out for.
 *
 * A failure here costs the blueprint and nothing else. The motion analysis is
 * already complete and already worth showing, so this returns the analysis
 * unchanged rather than propagating an error.
 */
async function buildBlueprint(input: {
  sessionId: string;
  signal: AbortSignal;
  sampler: FrameSampler;
  analysis: MotionAnalysis;
  scenes: Scene[];
  /** Frame-store key. Stage reference frames are written under it. */
  analysisId: string;
  candidates: Candidate[];
  rhythm?: EditRhythm;
  profile: MotionProfile;
  palette: PaletteSwatch[];
  globalSummary: string | null;
  label: string;
  localOnly: boolean;
}): Promise<MotionAnalysis> {
  const { analysis } = input;

  const energy = deriveEnergy({
    duration: analysis.video.duration,
    scenes: input.scenes,
    candidates: input.candidates,
    events: analysis.events,
  });
  const stages = deriveStoryStages({
    duration: analysis.video.duration,
    energy,
    scenes: input.scenes,
    events: analysis.events,
  });

  const withLocals: MotionAnalysis = { ...analysis, energy };

  // Local interpretation failed, so there is nothing to build a blueprint on.
  if (input.localOnly || stages.length === 0) return withLocals;

  const derivedToolkit = {
    editMap: deriveEditMap(stages, energy),
    cutMap: deriveCutMap(analysis.events),
    pacing: derivePacing(stages, input.rhythm),
    footageChecklist: deriveFootageChecklist(analysis.events, input.scenes),
    soundOpportunities: deriveSoundOpportunities(analysis.events),
  };

  advance(input.sessionId, 'blueprint');

  try {
    throwIfAborted(input.signal);
    /**
     * Reference frames for each story stage, which do double duty: the model's
     * view of how the video actually looks across its arc, and the image the
     * Story board shows for that stage.
     *
     * They are captured under the analysis's own id namespace and written to
     * the frame store before anything else happens with them. Previously they
     * were captured, sent to the model, and dropped — so the board fell back to
     * the nearest *event* frame at any distance, routinely presenting a
     * different shot as though it represented this stage.
     */
    const captured = await input.sampler.captureEvidence(
      stages.map((stage, index) => ({
        id: stageFrameId(input.analysisId, index),
        time: stage.referenceTime ?? stage.startTime,
      })),
    );

    const byId = new Map(captured.map((frame) => [frame.id, frame]));
    const stageFrames: EvidenceFrame[] = [];
    const stagesWithFrames = stages.map((stage, index) => {
      const frame = byId.get(stageFrameId(input.analysisId, index));
      if (!frame) return stage;
      stageFrames.push({
        id: frame.id,
        candidateId: stage.id,
        role: 'stage',
        order: index,
        time: frame.time,
        dataUrl: frame.dataUrl,
      });
      return { ...stage, referenceFrameId: frame.id, referenceTime: frame.time };
    });

    // Written before the model call, for the same reason the evidence frames
    // are: past this point a failure is the network's, and it should not cost
    // the scrubbing already done.
    if (stageFrames.length > 0) await putFrames(input.analysisId, stageFrames);

    const result = await generateBlueprint({
      video: analysis.video,
      analysis,
      scenes: input.scenes,
      ...(input.rhythm ? { rhythm: input.rhythm } : {}),
      profile: input.profile,
      stages: stagesWithFrames,
      palette: input.palette,
      derivedToolkit,
      globalSummary: input.globalSummary,
      sourceLabel: input.label,
      frames: captured.map((frame) => ({ time: frame.time, dataUrl: frame.dataUrl })),
      signal: input.signal,
    });

    if (!result.ok) {
      log.warn('blueprint pass failed; keeping the motion analysis', { code: result.error.code });
      return {
        ...withLocals,
        blueprint: localOnlyBlueprint(stagesWithFrames, derivedToolkit, input.palette, result.error.message),
      };
    }

    return { ...withLocals, blueprint: result.data };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    log.warn('blueprint unavailable', { error: String(error) });
    return { ...withLocals, blueprint: localOnlyBlueprint(stages, derivedToolkit, input.palette, 'The blueprint pass could not be completed.') };
  }
}

/**
 * What survives when the blueprint call fails.
 *
 * The measured half is still real and still useful — a cut map and an edit map
 * are worth having without any prose around them — and the reason the rest is
 * missing is stated rather than left as an empty panel.
 */
function localOnlyBlueprint(
  stages: StoryStage[],
  derivedToolkit: Parameters<typeof generateBlueprint>[0]['derivedToolkit'],
  palette: PaletteSwatch[],
  reason: string,
): ProductionBlueprint {
  return {
    creativeDirection: [],
    movementLanguage: [],
    composition: [],
    equipment: [],
    ...(palette.length > 0 ? { color: { direction: [], guidance: [], palette } } : {}),
    shootingDirection: [],
    shotList: [],
    editorToolkit: {
      ...derivedToolkit,
      transitionRecipes: [],
      workflow: [],
      typographyNotes: [],
      coloristNotes: [],
      priorities: [],
      mistakes: [],
    },
    storyStages: stages,
    moodboardKeywords: [],
    referencesToCollect: [],
    topThree: [],
    avoid: [],
    unavailable: [
      { section: 'Creative direction, camera, equipment and lighting', reason },
    ],
  };
}

// -- Interpretation ----------------------------------------------------------

interface InterpretInput {
  sessionId: string;
  signal: AbortSignal;
  sampler: FrameSampler;
  video: VideoMetadata;
  clusters: CandidateCluster[];
  frames: EvidenceFrame[];
  scenes: Scene[];
  rhythm?: EditRhythm;
  profile: MotionProfile;
  label: string;
}

interface InterpretResult {
  events: ModelEvent[];
  global?: GlobalContext;
  reconciliation?: Reconciliation;
  calls: number;
  globalFrames: number;
  localOnly?: boolean;
}

/**
 * The three model passes, each of which may fail without sinking the analysis.
 *
 * This is the degradation guarantee. Previously any model failure threw, and a
 * pipeline that had already measured every scene boundary in the video threw
 * all of it away — the user paid for minutes of scrubbing and received an error.
 * Now a failed global pass costs context, a failed batch costs interpretation
 * for four events, and a total failure still yields a timeline of measured
 * changes marked as local-only.
 */
async function interpret(input: InterpretInput): Promise<InterpretResult> {
  const { sessionId, signal } = input;
  let calls = 0;

  // -- Pass 1 ---------------------------------------------------------------
  advance(sessionId, 'global_pass');
  let global: GlobalContext | undefined;
  let globalFrames = 0;

  try {
    const times = globalTimestamps(input.video.duration);
    const thumbs = await input.sampler.captureEvidence(
      times.map((time, index) => ({ id: `global-${index}`, time })),
    );
    globalFrames = thumbs.length;
    throwIfAborted(signal);

    if (thumbs.length > 0) {
      calls += 1;
      const result = await analyzeGlobalContext({
        video: input.video,
        scenes: input.scenes,
        ...(input.rhythm ? { rhythm: input.rhythm } : {}),
        profile: input.profile,
        sourceLabel: input.label,
        frames: thumbs.map((frame) => ({ time: frame.time, dataUrl: frame.dataUrl })),
        signal,
      });
      if (result.ok) global = result.data;
      else log.warn('global pass failed, continuing without context', { code: result.error.code });
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    log.warn('global pass unavailable', { error: String(error) });
  }

  // -- Pass 2 ---------------------------------------------------------------
  const entries = buildPromptEvents(input.clusters, input.frames, input.scenes);
  const batches = chunk(entries, EVIDENCE.eventsPerBatch);
  const events: ModelEvent[] = [];
  let failedBatches = 0;

  for (const [index, batch] of batches.entries()) {
    throwIfAborted(signal);
    advance(sessionId, 'ai_analysis', `batch ${index + 1} / ${batches.length}`);
    calls += 1;
    const result = await analyzeEvents({
      entries: batch,
      globalSummary: global?.summary ?? null,
      signal,
    });
    if (result.ok) {
      events.push(...result.data);
    } else {
      // One failed batch is four events without a technique reading, not a
      // failed analysis. They keep their measured timestamps.
      failedBatches += 1;
      log.warn('event batch failed', { batch: index + 1, code: result.error.code });
    }
  }

  if (events.length === 0) {
    log.warn('no events interpreted; falling back to local measurement only');
    return { events: [], calls, globalFrames, localOnly: true, ...(global ? { global } : {}) };
  }
  if (failedBatches > 0) log.warn('partial interpretation', { failedBatches, of: batches.length });

  // -- Pass 3 ---------------------------------------------------------------
  // Skipped for trivially small analyses: there is no cross-event context to
  // reconcile, and the call would be spent restating the obvious.
  let reconciliation: Reconciliation | undefined;
  if (events.length >= 3) {
    throwIfAborted(signal);
    advance(sessionId, 'reconciling');
    calls += 1;
    const merged = normalizeAnalysis({
      // Never stored or shown — this exists only to shape the reconcile prompt.
      id: 'reconcile',
      clusters: input.clusters,
      modelEvents: events,
      frames: input.frames,
      scenes: input.scenes,
      video: input.video,
      ...(input.rhythm ? { rhythm: input.rhythm } : {}),
      profile: input.profile,
      stats: emptyStats(),
    });
    const result = await reconcileAnalysis({
      video: input.video,
      events: merged.events.filter((event) => event.role === 'primary'),
      scenes: input.scenes,
      ...(input.rhythm ? { rhythm: input.rhythm } : {}),
      profile: input.profile,
      globalSummary: global?.summary ?? null,
      signal,
    });
    if (result.ok) reconciliation = result.data;
    else log.warn('reconciliation failed, keeping per-event readings', { code: result.error.code });
  }

  return {
    events,
    calls,
    globalFrames,
    ...(global ? { global } : {}),
    ...(reconciliation ? { reconciliation } : {}),
  };
}

/**
 * Attaches the shots either side of each moment.
 *
 * Without them the model judges a transition from the transition alone, which
 * is exactly the information a whip pan does not contain: the technique lives
 * in the relationship between two shots, and half of that relationship is
 * outside the frames supplied. Measured continuity travels along too, so the
 * model's own continuity answer can be checked rather than trusted.
 */
function buildPromptEvents(
  clusters: CandidateCluster[],
  frames: EvidenceFrame[],
  scenes: Scene[],
): PromptEvent[] {
  return clusters
    .map((cluster) => {
      const own = frames.filter((frame) => frame.candidateId === cluster.id).sort((a, b) => a.order - b.order);
      // No frames, nothing to interpret. The event survives via the normalizer's
      // measurement-only path rather than being described from nothing.
      if (own.length === 0) return null;

      const { previous, next } = scenesAround(scenes, cluster.startTime);
      const measuredContinuity = measureContinuity({
        ...(previous ? { previous } : {}),
        ...(next ? { next } : {}),
        candidate: cluster.primary,
      });

      return {
        id: cluster.id,
        candidate: cluster.primary,
        frames: own,
        ...(previous ? { previousScene: previous } : {}),
        ...(next ? { nextScene: next } : {}),
        ...(measuredContinuity ? { measuredContinuity } : {}),
      } satisfies PromptEvent;
    })
    .filter((entry): entry is PromptEvent => entry !== null);
}

// -- Evidence planning -------------------------------------------------------

interface EvidenceRequest {
  id: string;
  candidateId: string;
  role: FrameRole;
  order: number;
  time: number;
}

/**
 * Chooses which frames to spend the budget on.
 *
 * A real temporal sequence per primary event, not a triptych. Three frames can
 * show that something changed; they cannot show velocity, where the peak sits,
 * or whether movement survived the cut — which is why the old design could say
 * "a whip pan happened" and never "the cut lands just after peak movement".
 *
 * The strip is anchored on the measured peak and spread across the measured
 * span, so the frames returned actually bracket the event rather than sitting
 * at fixed offsets that may miss it entirely.
 *
 * Requests come back in time order so a page video is scrubbed forwards once
 * rather than jumped around, which is both faster and far less unpleasant to
 * watch.
 */
export function planEvidence(
  clusters: CandidateCluster[],
  duration: number,
  analysisId: string,
): { requests: EvidenceRequest[]; dropped: number } {
  const byImportance = [...clusters].sort((a, b) => b.primary.quality - a.primary.quality);
  const requests: EvidenceRequest[] = [];
  let dropped = 0;

  for (const cluster of byImportance) {
    const remaining = EVIDENCE.maxFramesPerAnalysis - requests.length;
    const wanted = requests.length < EVIDENCE.maxFramesPerAnalysis * 0.7 ? EVIDENCE.primaryFrames : EVIDENCE.secondaryFrames;
    const count = Math.min(wanted, remaining);

    if (count < 3) {
      dropped += 1;
      continue;
    }

    for (const [order, entry] of stripFor(cluster, count, duration).entries()) {
      requests.push({
        id: `${analysisId}:${cluster.id}-${order}`,
        candidateId: cluster.id,
        role: entry.role,
        order,
        time: entry.time,
      });
    }
  }

  requests.sort((a, b) => a.time - b.time);
  return { requests, dropped };
}

/** Times and roles for one event's filmstrip, centred on the measured peak. */
function stripFor(cluster: CandidateCluster, count: number, duration: number): Array<{ role: FrameRole; time: number }> {
  const peak = cluster.primary.peakTime ?? cluster.primary.time;
  const span = Math.max(cluster.endTime - cluster.startTime, 0);
  // Far enough either side to be clearly the previous and next shot, close
  // enough to still be the same moment.
  const reach = Math.max(0.24, Math.min(0.62, span * 1.3 || 0.3));

  const roles: FrameRole[] =
    count >= 5 ? ['before', 'build', 'peak', 'settle', 'after'] : ['before', 'peak', 'after'];

  return roles.map((role, index) => {
    const position = (index / (roles.length - 1)) * 2 - 1; // -1 .. 1
    return { role, time: clamp(peak + position * reach, duration) };
  });
}

/**
 * Frame ids follow `<analysisId>:<owner>-<order>` everywhere, which is what
 * lets the panel recover the owning analysis from a frame alone.
 */
const stageFrameId = (analysisId: string, index: number): string => `${analysisId}:stage-${index}`;

const clamp = (time: number, duration: number): number =>
  Number(Math.max(0.02, Math.min(time, duration - 0.05)).toFixed(3));

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

/**
 * Merges the medium pass into the coarse baseline.
 *
 * De-duplicated by timestamp and re-sorted, because the intervals recorded
 * during sampling are only correct within their own pass — after interleaving,
 * every gap has to be recomputed against its true neighbour or the velocity
 * figures silently describe the wrong span.
 */
function mergeSeries(coarse: FrameMetrics[], medium: FrameMetrics[]): FrameMetrics[] {
  const byTime = new Map<number, FrameMetrics>();
  for (const metric of coarse) byTime.set(Number(metric.time.toFixed(3)), metric);
  // Medium wins on collision: it was measured against a closer neighbour.
  for (const metric of medium) byTime.set(Number(metric.time.toFixed(3)), metric);

  const ordered = [...byTime.values()].sort((a, b) => a.time - b.time);
  return ordered.map((metric, index) => {
    if (index === 0) return { ...metric, interval: 0 };
    const interval = Math.max(1e-3, metric.time - (ordered[index - 1]?.time ?? metric.time));
    return { ...metric, interval, motionVelocity: metric.motionMagnitude / interval };
  });
}

const emptyStats = (): MotionAnalysis['stats'] => ({
  coarseFrames: 0,
  mediumFrames: 0,
  fineFrames: 0,
  candidates: 0,
  clusters: 0,
  framesSentToModel: 0,
  modelCalls: 0,
});
