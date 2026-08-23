import type { ActiveRegion } from './config.ts';
import type { Candidate, CandidateCluster, CandidateKind, FrameMetrics } from '../types/analysis.ts';
import type { MotionDirection } from '../types/motion.ts';
import { ANALYSIS_FRAME, DETECTION } from './config.ts';
import { describeDirection } from './metrics.ts';

/**
 * Turns a series of frame measurements into a shortlist of moments worth
 * looking at closely.
 *
 * The threshold is adaptive, and — after this rewrite — bounded. Robust
 * statistics were the right instinct and the wrong result on their own: taking
 * the median of a video's change series treats "normal for this video" as the
 * baseline, which works beautifully until a large minority of the intervals
 * *contain cuts*. Then the deviation inflates, the threshold climbs above the
 * very events being looked for, and a fast edit hides its own cutting. The
 * absolute ceiling fixes that end; the floor fixes the other, where a quiet
 * cinematic video's threshold collapses and every soft dissolve scores under it.
 *
 * This module finds *change*. It does not name it. A bright flash and a cut to
 * a brighter shot look nearly identical here, and deciding between them is the
 * model's job — which is why every candidate carries the numbers that produced
 * it into the prompt.
 */

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0);
}

/** Median absolute deviation — a spread estimate a few outliers cannot inflate. */
export function medianAbsoluteDeviation(values: number[], centre = median(values)): number {
  if (values.length === 0) return 0;
  return median(values.map((value) => Math.abs(value - centre)));
}

export function changeScore(metric: FrameMetrics): number {
  return (
    DETECTION.diffWeight * metric.diff +
    DETECTION.histWeight * metric.histDiff +
    DETECTION.chromaWeight * metric.chromaDist
  );
}

/**
 * The detection threshold for one series.
 *
 * Adaptive between two hard bounds. Never below `minScore`, so compression
 * noise in a locked-off shot cannot promote itself; never above `absoluteCut`,
 * so a video whose median interval *is* a cut cannot raise the bar out of reach
 * of its own cutting.
 */
export function thresholdFor(scores: number[]): number {
  const centre = median(scores);
  const spread = medianAbsoluteDeviation(scores, centre);
  const adaptive = centre + DETECTION.thresholdK * spread;
  return Math.min(DETECTION.absoluteCut, Math.max(DETECTION.minScore, adaptive));
}

/** Median gap between samples, used to derive suppression windows. */
export function sampleInterval(metrics: FrameMetrics[]): number {
  const gaps = metrics.map((metric) => metric.interval).filter((interval) => interval > 0);
  return gaps.length > 0 ? median(gaps) : 0;
}

/**
 * Regions the coarse pass found busy enough to re-sample densely.
 *
 * Deliberately generous: this is triage, not detection. Anything above roughly
 * half the threshold earns a closer look, because the whole purpose of pass B
 * is to find the events that fell between two coarse samples — and those show
 * up here as a merely elevated interval, not an obvious peak.
 */
export function activeRegions(metrics: FrameMetrics[], interval: number): ActiveRegion[] {
  const comparable = metrics.slice(1);
  if (comparable.length === 0) return [];

  const scores = comparable.map(changeScore);
  const threshold = thresholdFor(scores) * DETECTION.activeRatio;
  const pad = Math.max(interval, 0.2);

  const regions: ActiveRegion[] = [];
  for (let index = 0; index < comparable.length; index += 1) {
    const metric = comparable[index];
    const score = scores[index] ?? 0;
    if (!metric) continue;

    const motionActive = metric.motionMagnitude >= DETECTION.motionThreshold || metric.motionSaturated;
    if (score < threshold && !motionActive) continue;

    const start = Number((metric.time - pad).toFixed(3));
    const end = Number((metric.time + pad).toFixed(3));
    const previous = regions[regions.length - 1];

    if (previous && start <= previous.end) {
      previous.end = Math.max(previous.end, end);
      previous.score = Math.max(previous.score, score);
    } else {
      regions.push({ start: Math.max(0, start), end, score });
    }
  }

  return regions;
}

export interface DetectionResult {
  candidates: Candidate[];
  /** Exposed for the development debug view. Never shown in the product UI. */
  threshold: number;
  scores: Array<{ time: number; score: number }>;
}

export function detectCandidates(metrics: FrameMetrics[], maxCandidates: number): DetectionResult {
  // Index 0 has no predecessor, so its differences are zero by definition and
  // would drag the median down if included.
  const comparable = metrics.slice(1);
  if (comparable.length < 2) return { candidates: [], threshold: 0, scores: [] };

  const scores = comparable.map((metric) => ({ time: metric.time, score: changeScore(metric) }));
  const threshold = thresholdFor(scores.map((entry) => entry.score));
  const interval = sampleInterval(metrics);

  /**
   * Suppression follows the sampler rather than a constant.
   *
   * A fixed 350ms window was wider than the 333ms sampling interval, so any two
   * cuts in adjacent samples were merged by rule — which made sub-half-second
   * cutting structurally invisible no matter how well anything else worked.
   */
  const minGap = Math.max(DETECTION.minGapFloorSec, interval * 1.05);

  const peaks = findPeaks(comparable, scores, threshold, interval, minGap);
  const gradual = findGradual(comparable, scores, threshold, interval, peaks);
  const runs = findMotionRuns(comparable, interval);

  // A camera run that starts on a cut is that cut's motion, not a separate
  // event — reporting both would double-count one moment on the timeline.
  const anchored = [...peaks, ...gradual];
  const merged = [
    ...anchored,
    ...runs.filter((run) => !anchored.some((entry) => Math.abs(entry.time - run.time) < minGap)),
  ];

  const ranked = merged
    .sort((a, b) => b.quality - a.quality)
    .slice(0, maxCandidates)
    .sort((a, b) => a.time - b.time);

  return { candidates: ranked, threshold, scores };
}

// -- Construction ------------------------------------------------------------

function directionOf(metric: FrameMetrics): MotionDirection | undefined {
  return describeDirection(
    {
      dx: metric.motionX,
      dy: metric.motionY,
      magnitude: metric.motionMagnitude,
      divergence: metric.divergence,
      saturated: metric.motionSaturated,
    },
    ANALYSIS_FRAME.width,
  );
}

/**
 * How much this candidate should be trusted, before the model sees it.
 *
 * Kept separate from `strength` — which is only "how far above threshold" — so
 * a weak-but-corroborated event can outrank a strong-but-lonely one. Signals
 * agreeing with each other is evidence; one signal shouting is not.
 */
function qualityOf(metric: FrameMetrics, strength: number): number {
  const corroboration =
    (metric.diff > 0.08 ? 1 : 0) +
    (metric.histDiff > 0.08 ? 1 : 0) +
    (metric.chromaDist > 0.08 ? 1 : 0) +
    (metric.motionMagnitude > DETECTION.motionThreshold ? 1 : 0) +
    (Math.abs(metric.lumaDelta) > 0.08 ? 1 : 0);
  return Math.min(1, strength * 0.65 + (corroboration / 5) * 0.35);
}

function toCandidate(
  metric: FrameMetrics,
  kind: CandidateKind,
  strength: number,
  intervalSec: number,
  endTime?: number,
): Candidate {
  const direction = directionOf(metric);
  const scaleChange =
    direction === 'outward' ? ('closer' as const) : direction === 'inward' ? ('farther' as const) : undefined;

  return {
    id: `c${Math.round(metric.time * 1000)}`,
    kind,
    time: metric.time,
    ...(endTime !== undefined ? { endTime } : {}),
    strength: clamp01(strength),
    quality: qualityOf(metric, clamp01(strength)),
    metrics: {
      diff: round(metric.diff),
      histDiff: round(metric.histDiff),
      chromaDist: round(metric.chromaDist),
      lumaDelta: round(metric.lumaDelta),
      edgeDelta: round(metric.edgeDelta),
      motionMagnitude: round(metric.motionMagnitude),
      motionVelocity: round(metric.motionVelocity),
      motionSaturated: metric.motionSaturated,
      ...(direction ? { direction } : {}),
      ...(scaleChange ? { scaleChange } : {}),
      sampleIntervalSec: round(intervalSec),
    },
  };
}

// -- Detectors ---------------------------------------------------------------

function findPeaks(
  metrics: FrameMetrics[],
  scores: Array<{ time: number; score: number }>,
  threshold: number,
  interval: number,
  minGap: number,
): Candidate[] {
  const peak = Math.max(...scores.map((entry) => entry.score), threshold);
  const candidates: Candidate[] = [];
  let lastTime = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < metrics.length; index += 1) {
    const metric = metrics[index];
    const score = scores[index]?.score ?? 0;
    if (!metric || score < threshold) continue;

    // Local maximum only: a slow dissolve crosses the threshold for several
    // consecutive frames and is one event, not five.
    const previous = scores[index - 1]?.score ?? 0;
    const next = scores[index + 1]?.score ?? 0;
    if (score < previous || score < next) continue;
    if (metric.time - lastTime < minGap) continue;

    lastTime = metric.time;
    const strength = peak > threshold ? (score - threshold) / (peak - threshold) : 1;
    candidates.push(toCandidate(metric, classifyPeak(metric), strength, interval));
  }

  return candidates;
}

/**
 * What kind of discontinuity this is, from measurement alone.
 *
 * Only ever a coarse bucket. It exists so the model receives a hint and so a
 * failed model call still leaves something honest on the timeline — not to
 * pre-empt the classification.
 */
function classifyPeak(metric: FrameMetrics): CandidateKind {
  const structural = Math.max(metric.diff, metric.histDiff);
  // A large luminance swing with comparatively little structural change is a
  // flash or a fade rather than a new shot.
  if (Math.abs(metric.lumaDelta) > DETECTION.flashLumaDelta && metric.histDiff < metric.diff * 0.9) return 'luma';
  // Colour moved and structure did not: a grade change, a light leak, a wash.
  if (metric.chromaDist > DETECTION.colorShift && structural < metric.chromaDist * 0.7) return 'color';
  return 'boundary';
}

/**
 * Changes spread across several frames rather than concentrated in one.
 *
 * Crossfades, fades to black and grade ramps never produce a peak — they
 * produce a plateau, which peak detection is built to ignore. Without this they
 * were simply absent from the analysis, which is why slow cinematic material
 * came back nearly empty.
 */
function findGradual(
  metrics: FrameMetrics[],
  scores: Array<{ time: number; score: number }>,
  threshold: number,
  interval: number,
  existing: Candidate[],
): Candidate[] {
  const floor = threshold * DETECTION.gradualRatio;
  const found: Candidate[] = [];
  let runStart: number | null = null;

  const close = (endIndex: number): void => {
    if (runStart === null) return;
    const span = metrics.slice(runStart, endIndex + 1);
    const first = span[0];
    const last = span[span.length - 1];
    runStart = null;
    if (!first || !last || span.length < DETECTION.gradualMinFrames) return;

    // A run that already contains a detected peak is that peak's shoulder.
    if (existing.some((entry) => entry.time >= first.time - interval && entry.time <= last.time + interval)) return;

    // Monotonic luminance means a fade; otherwise it is a dissolve or a wash.
    const lumaTrend = span.reduce((sum, metric) => sum + metric.lumaDelta, 0);
    const strongest = span.reduce((best, metric) => (changeScore(metric) > changeScore(best) ? metric : best), first);
    const accumulated = span.reduce((sum, metric) => sum + changeScore(metric), 0);

    const kind: CandidateKind = Math.abs(lumaTrend) > DETECTION.flashLumaDelta ? 'luma' : 'gradual';
    const strength = Math.min(1, accumulated / (threshold * span.length * 2));

    found.push(
      toCandidate(strongest, kind, strength, interval, Number((last.time + interval).toFixed(3))),
    );
  };

  for (let index = 0; index < metrics.length; index += 1) {
    const score = scores[index]?.score ?? 0;
    if (score >= floor && score < threshold) {
      if (runStart === null) runStart = index;
    } else if (runStart !== null) {
      close(index - 1);
    }
  }
  close(metrics.length - 1);

  return found;
}

/** Contiguous stretches of sustained camera motion, reported at their peak. */
function findMotionRuns(metrics: FrameMetrics[], interval: number): Candidate[] {
  const runs: Candidate[] = [];
  let start: number | null = null;

  const closeRun = (endIndex: number): void => {
    if (start === null) return;
    const span = metrics.slice(start, endIndex + 1);
    const first = span[0];
    const last = span[span.length - 1];
    start = null;
    if (!first || !last) return;

    const duration = last.time - first.time + interval;
    if (duration < DETECTION.minMotionRunSec) return;

    const strongest = span.reduce((best, metric) => (metric.motionMagnitude > best.motionMagnitude ? metric : best), first);
    const strength = Math.min(1, strongest.motionMagnitude / (DETECTION.motionThreshold * 4));
    runs.push(toCandidate(strongest, 'camera', strength, interval, Number((last.time + interval).toFixed(3))));
  };

  for (let index = 0; index < metrics.length; index += 1) {
    const metric = metrics[index];
    if (!metric) continue;
    if (metric.motionMagnitude >= DETECTION.motionThreshold || metric.motionSaturated) {
      if (start === null) start = index;
    } else if (start !== null) {
      closeRun(index - 1);
    }
  }
  closeRun(metrics.length - 1);

  return runs;
}

// -- Refinement --------------------------------------------------------------

/**
 * Second pass: re-place a candidate on the frame where the change actually
 * peaked, now that we have sampled the neighbourhood densely — and record the
 * velocity curve around it.
 *
 * The coarse pass can only say "somewhere between 4.0 and 4.33". This is what
 * turns that into 00:04.32, and it is the only reason the product may print a
 * two-decimal timestamp at all. The profile it attaches is what later lets an
 * explanation say where the movement peaked relative to the cut, instead of
 * merely that both occurred.
 */
export function refineCandidate(candidate: Candidate, fineMetrics: FrameMetrics[]): Candidate {
  const comparable = fineMetrics.slice(1);
  if (comparable.length === 0) return candidate;

  const best = comparable.reduce((winner, metric) => (changeScore(metric) > changeScore(winner) ? metric : winner));
  const interval = sampleInterval(fineMetrics);

  const fastest = comparable.reduce((winner, metric) =>
    metric.motionVelocity > winner.motionVelocity ? metric : winner,
  );

  const direction = directionOf(best) ?? directionOf(fastest) ?? candidate.metrics.direction;

  // Span: how long the neighbourhood stays above half the peak. For a hard cut
  // that is one interval; for a dissolve or a whip it is genuinely longer.
  const peakScore = changeScore(best);
  const elevated = comparable.filter((metric) => changeScore(metric) >= peakScore * 0.5);
  const spanStart = Math.min(...elevated.map((metric) => metric.time));
  const spanEnd = Math.max(...elevated.map((metric) => metric.time));
  const spans = spanEnd - spanStart > interval * 1.5;

  /**
   * Does the movement survive the change?
   *
   * Split around the change itself rather than around the velocity peak,
   * because the editorial question is what the *incoming* shot does. A whip pan
   * that works has movement on both sides of the cut; a whip pan into a locked
   * shot reads as a mistake. Measuring it is what lets the product say
   * "the incoming shot continues the same movement" and mean it.
   */
  const beforeChange = comparable.filter((metric) => metric.time < best.time);
  const afterChange = comparable.filter((metric) => metric.time > best.time);
  const motionContinues =
    beforeChange.length > 0 && afterChange.length > 0
      ? mean(afterChange.map((metric) => metric.motionVelocity)) >=
        mean(beforeChange.map((metric) => metric.motionVelocity)) * 0.7
      : undefined;

  const scaleChange =
    direction === 'outward' ? ('closer' as const) : direction === 'inward' ? ('farther' as const) : undefined;

  return {
    ...candidate,
    time: spans ? Number(spanStart.toFixed(3)) : best.time,
    peakTime: best.time,
    ...(spans ? { endTime: Number(spanEnd.toFixed(3)) } : candidate.endTime !== undefined ? { endTime: candidate.endTime } : {}),
    metrics: {
      ...candidate.metrics,
      diff: round(best.diff),
      histDiff: round(best.histDiff),
      chromaDist: round(best.chromaDist),
      lumaDelta: round(best.lumaDelta),
      edgeDelta: round(Math.min(best.edgeDelta, fastest.edgeDelta)),
      motionMagnitude: round(Math.max(best.motionMagnitude, candidate.metrics.motionMagnitude)),
      motionVelocity: round(Math.max(fastest.motionVelocity, candidate.metrics.motionVelocity)),
      motionSaturated: candidate.metrics.motionSaturated || comparable.some((metric) => metric.motionSaturated),
      peakVelocity: round(fastest.motionVelocity),
      peakVelocityTime: fastest.time,
      ...(motionContinues !== undefined ? { motionContinues } : {}),
      ...(direction ? { direction } : {}),
      ...(scaleChange ? { scaleChange } : {}),
      sampleIntervalSec: round(interval),
    },
    profile: comparable.map((metric) => ({
      time: metric.time,
      change: round(changeScore(metric)),
      velocity: round(metric.motionVelocity),
      edgeDensity: round(metric.edgeDensity),
    })),
  };
}

// -- Clustering --------------------------------------------------------------

/**
 * Groups candidates that describe one editorial moment.
 *
 * A whip pan measures as a camera run, an edge collapse and a boundary within a
 * few hundred milliseconds. Emitting three markers is not three times the
 * information — it is one fact, repeated, crowding out two real events
 * elsewhere on the timeline. The strongest becomes the primary; the rest become
 * its parts and only appear inside the detail view.
 */
export function clusterCandidates(candidates: Candidate[]): CandidateCluster[] {
  const ordered = [...candidates].sort((a, b) => a.time - b.time);
  const clusters: CandidateCluster[] = [];

  for (const candidate of ordered) {
    const end = candidate.endTime ?? candidate.time;
    const previous = clusters[clusters.length - 1];

    if (previous && candidate.time - previous.endTime <= DETECTION.clusterWindowSec) {
      previous.secondaries.push(candidate);
      previous.endTime = Math.max(previous.endTime, end);
      continue;
    }

    clusters.push({
      id: candidate.id,
      primary: candidate,
      secondaries: [],
      startTime: candidate.time,
      endTime: end,
    });
  }

  // The primary is whichever member carries the most evidence, not whichever
  // happened to come first: a cut preceded by its own camera move should be
  // reported as the cut.
  for (const cluster of clusters) {
    const members = [cluster.primary, ...cluster.secondaries];
    const primary = members.reduce((best, member) => (rank(member) > rank(best) ? member : best));
    cluster.primary = primary;
    cluster.secondaries = members.filter((member) => member !== primary);
    cluster.id = primary.id;
  }

  return clusters;
}

/** Boundaries outrank motion at equal quality: a cut is the editorial event. */
function rank(candidate: Candidate): number {
  const kindBonus = candidate.kind === 'boundary' ? 0.25 : candidate.kind === 'gradual' ? 0.15 : 0;
  return candidate.quality + kindBonus;
}

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const round = (value: number): number => Number(value.toFixed(4));
