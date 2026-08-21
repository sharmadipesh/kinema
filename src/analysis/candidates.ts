import type { Candidate, CandidateKind, FrameMetrics } from '../types/analysis.ts';
import type { MotionDirection } from '../types/motion.ts';
import { ANALYSIS_FRAME, DETECTION } from './config.ts';
import { describeDirection } from './metrics.ts';

/**
 * Turns a series of frame measurements into a shortlist of timestamps worth
 * looking at closely.
 *
 * The threshold is adaptive, not fixed. A locked-off interview and a hand-held
 * street edit produce difference series an order of magnitude apart, and any
 * constant that works for one invents events in the other. So: take the median
 * of the series as "normal for this video", and treat a peak as interesting
 * only when it stands k median-absolute-deviations above that. The floor in
 * `DETECTION.minScore` stops a perfectly static screen recording from promoting
 * its own compression noise.
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
  return DETECTION.diffWeight * metric.diff + DETECTION.histWeight * metric.histDiff;
}

export interface DetectionResult {
  candidates: Candidate[];
  /** Exposed for the development debug panel. Never shown in the product UI. */
  threshold: number;
  scores: Array<{ time: number; score: number }>;
}

export function detectCandidates(metrics: FrameMetrics[], maxCandidates: number): DetectionResult {
  // Index 0 has no predecessor, so its differences are zero by definition and
  // would drag the median down if included.
  const comparable = metrics.slice(1);
  if (comparable.length < 2) return { candidates: [], threshold: 0, scores: [] };

  const scores = comparable.map((metric) => ({ time: metric.time, score: changeScore(metric) }));
  const values = scores.map((entry) => entry.score);
  const centre = median(values);
  const spread = medianAbsoluteDeviation(values, centre);
  const threshold = Math.max(DETECTION.minScore, centre + DETECTION.thresholdK * spread);

  const sampleIntervalSec = estimateInterval(metrics);
  const peaks = findPeaks(comparable, scores, threshold, sampleIntervalSec);
  const runs = findMotionRuns(comparable, sampleIntervalSec);

  // A camera run that starts on a cut is that cut's motion, not a separate
  // event — reporting both would double-count one moment on the timeline.
  const merged = [
    ...peaks,
    ...runs.filter((run) => !peaks.some((peak) => Math.abs(peak.time - run.time) < DETECTION.motionMergeSec)),
  ];

  const ranked = merged
    .sort((a, b) => b.strength - a.strength)
    .slice(0, maxCandidates)
    .sort((a, b) => a.time - b.time);

  return { candidates: ranked, threshold, scores };
}

function estimateInterval(metrics: FrameMetrics[]): number {
  if (metrics.length < 2) return 0;
  const gaps: number[] = [];
  for (let index = 1; index < metrics.length; index += 1) {
    gaps.push((metrics[index]?.time ?? 0) - (metrics[index - 1]?.time ?? 0));
  }
  return median(gaps);
}

function toCandidate(
  metric: FrameMetrics,
  kind: CandidateKind,
  strength: number,
  sampleIntervalSec: number,
  endTime?: number,
): Candidate {
  const direction = describeDirection(
    {
      dx: metric.motionX,
      dy: metric.motionY,
      magnitude: metric.motionMagnitude,
      divergence: metric.divergence,
    },
    ANALYSIS_FRAME.width,
  );

  return {
    id: `c${Math.round(metric.time * 1000)}`,
    kind,
    time: metric.time,
    ...(endTime !== undefined ? { endTime } : {}),
    strength: Math.min(1, Math.max(0, strength)),
    metrics: {
      diff: round(metric.diff),
      histDiff: round(metric.histDiff),
      lumaDelta: round(metric.lumaDelta),
      motionMagnitude: round(metric.motionMagnitude),
      ...(direction ? { direction } : {}),
      sampleIntervalSec: round(sampleIntervalSec),
    },
  };
}

function findPeaks(
  metrics: FrameMetrics[],
  scores: Array<{ time: number; score: number }>,
  threshold: number,
  sampleIntervalSec: number,
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
    if (metric.time - lastTime < DETECTION.minGapSec) continue;

    lastTime = metric.time;
    const strength = peak > threshold ? (score - threshold) / (peak - threshold) : 1;
    // A large luminance swing with comparatively little structural change is a
    // flash or a fade rather than a new shot.
    const kind: CandidateKind =
      Math.abs(metric.lumaDelta) > DETECTION.flashLumaDelta && metric.histDiff < metric.diff * 0.9
        ? 'luma'
        : 'boundary';
    candidates.push(toCandidate(metric, kind, strength, sampleIntervalSec));
  }

  return candidates;
}

/** Contiguous stretches of sustained camera motion, reported at their peak. */
function findMotionRuns(metrics: FrameMetrics[], sampleIntervalSec: number): Candidate[] {
  const runs: Candidate[] = [];
  let start: number | null = null;

  const closeRun = (endIndex: number): void => {
    if (start === null) return;
    const span = metrics.slice(start, endIndex + 1);
    const first = span[0];
    const last = span[span.length - 1];
    start = null;
    if (!first || !last) return;

    const duration = last.time - first.time + sampleIntervalSec;
    if (duration < DETECTION.minMotionRunSec) return;

    const strongest = span.reduce((best, metric) => (metric.motionMagnitude > best.motionMagnitude ? metric : best), first);
    const strength = Math.min(1, strongest.motionMagnitude / (DETECTION.motionThreshold * 4));
    runs.push(toCandidate(strongest, 'camera', strength, sampleIntervalSec, Number((last.time + sampleIntervalSec).toFixed(3))));
  };

  for (let index = 0; index < metrics.length; index += 1) {
    const metric = metrics[index];
    if (!metric) continue;
    if (metric.motionMagnitude >= DETECTION.motionThreshold) {
      if (start === null) start = index;
    } else if (start !== null) {
      closeRun(index - 1);
    }
  }
  closeRun(metrics.length - 1);

  return runs;
}

/**
 * Second pass: re-place a candidate on the frame where the change actually
 * peaked, now that we have sampled the neighbourhood densely.
 *
 * The coarse pass can only say "somewhere between 4.0 and 4.33". This is what
 * turns that into 00:04.32 — and it is the only reason the product may print a
 * two-decimal timestamp at all.
 */
export function refineCandidate(candidate: Candidate, fineMetrics: FrameMetrics[]): Candidate {
  const comparable = fineMetrics.slice(1);
  if (comparable.length === 0) return candidate;

  const best = comparable.reduce((winner, metric) =>
    changeScore(metric) > changeScore(winner) ? metric : winner,
  );

  const sampleIntervalSec = estimateInterval(fineMetrics);
  const direction =
    describeDirection(
      { dx: best.motionX, dy: best.motionY, magnitude: best.motionMagnitude, divergence: best.divergence },
      ANALYSIS_FRAME.width,
    ) ?? candidate.metrics.direction;

  // Span: how long the neighbourhood stays above half the peak. For a hard cut
  // that is one interval; for a dissolve or a whip it is genuinely longer.
  const peakScore = changeScore(best);
  const elevated = comparable.filter((metric) => changeScore(metric) >= peakScore * 0.5);
  const spanStart = Math.min(...elevated.map((metric) => metric.time));
  const spanEnd = Math.max(...elevated.map((metric) => metric.time));
  const span = spanEnd - spanStart;

  return {
    ...candidate,
    time: best.time,
    ...(span > sampleIntervalSec * 1.5 ? { endTime: Number(spanEnd.toFixed(3)) } : {}),
    metrics: {
      diff: round(best.diff),
      histDiff: round(best.histDiff),
      lumaDelta: round(best.lumaDelta),
      motionMagnitude: round(Math.max(best.motionMagnitude, candidate.metrics.motionMagnitude)),
      ...(direction ? { direction: direction as MotionDirection } : {}),
      sampleIntervalSec: round(sampleIntervalSec),
    },
  };
}

const round = (value: number): number => Number(value.toFixed(4));
