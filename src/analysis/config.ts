import type { Settings } from '../types/domain.ts';
import type { AnalysisFrameSize } from '../types/analysis.ts';

/**
 * Every tunable in the pipeline, in one place.
 *
 * These are starting points chosen to be conservative, not thresholds fitted to
 * a particular clip. Over-fitting them is how a scene detector ends up working
 * beautifully on the developer's test video and nowhere else — so the defaults
 * favour missing a soft transition over inventing one, and the adaptive
 * threshold in `candidates.ts` does most of the real work.
 */

export interface SamplingProfile {
  /** Coarse pass, samples per second of video. */
  coarseFps: number;
  /** Hard ceiling on coarse frames, so a long video degrades rather than hangs. */
  maxCoarseFrames: number;
  /** Fine pass, samples per second, around each candidate. */
  fineFps: number;
  /** Seconds either side of a candidate examined by the fine pass. */
  fineWindowSec: number;
  /** Candidates carried into the fine pass and the model call. */
  maxCandidates: number;
}

export const SAMPLING_PROFILES: Record<Settings['samplingRate'], SamplingProfile> = {
  economy: { coarseFps: 1.5, maxCoarseFrames: 90, fineFps: 8, fineWindowSec: 0.28, maxCandidates: 10 },
  balanced: { coarseFps: 3, maxCoarseFrames: 160, fineFps: 12, fineWindowSec: 0.34, maxCandidates: 16 },
  thorough: { coarseFps: 5, maxCoarseFrames: 260, fineFps: 20, fineWindowSec: 0.4, maxCandidates: 24 },
};

/**
 * Analysis resolution.
 *
 * 64x36 is not a compromise — it is the point. Scene boundaries and camera
 * translation are low-frequency signals; downscaling removes the film grain and
 * compression noise that would otherwise dominate a pixel difference, and makes
 * every frame cost a few thousand operations instead of a few million.
 */
export const ANALYSIS_FRAME: AnalysisFrameSize = { width: 64, height: 36 };

export const DETECTION = {
  /** Weight of raw pixel difference vs histogram distance in the change score. */
  diffWeight: 0.6,
  histWeight: 0.4,
  /** Adaptive threshold: median + k x median-absolute-deviation of the series. */
  thresholdK: 3.2,
  /** No candidate below this, however quiet the video — guards against noise. */
  minScore: 0.055,
  /** Two boundaries closer than this are the same event. */
  minGapSec: 0.35,
  /** Sustained motion above this (normalised) starts a camera-movement run. */
  motionThreshold: 0.035,
  /** A camera run must last at least this long to be worth reporting. */
  minMotionRunSec: 0.25,
  /** A camera run within this distance of a boundary is folded into it. */
  motionMergeSec: 0.2,
  /** |lumaDelta| above this, with little structural change, reads as a flash. */
  flashLumaDelta: 0.16,
  /** Divergence above this dominates translation, so the event is a zoom. */
  zoomDominance: 0.35,
} as const;

export const EVIDENCE = {
  /** Longest edge of an evidence JPEG sent to the model. */
  frameMaxWidth: 384,
  jpegQuality: 0.72,
  /** Frames per candidate: before, during, after. */
  framesPerCandidate: 3,
  /**
   * Hard ceiling on images in one model call. Vision tokens are the dominant
   * cost of an analysis, and past roughly this many the model's attention is
   * the binding constraint anyway.
   */
  maxFramesPerRequest: 36,
  /** Candidates ranked below this get a single "during" frame instead of three. */
  richEvidenceCandidates: 8,
} as const;

export function profileFor(rate: Settings['samplingRate']): SamplingProfile {
  return SAMPLING_PROFILES[rate];
}

/**
 * Evenly spaced sample times across the video.
 *
 * The first and last 40ms are avoided: many encoders open on a black or
 * partially decoded frame, and a spurious boundary at t=0 is worse than no
 * boundary at all.
 */
export function coarseTimestamps(duration: number, profile: SamplingProfile): number[] {
  const edge = 0.04;
  const usable = Math.max(0, duration - edge * 2);
  if (usable <= 0) return [];

  const wanted = Math.min(Math.ceil(usable * profile.coarseFps), profile.maxCoarseFrames);
  const count = Math.max(2, wanted);
  const step = usable / (count - 1);
  return Array.from({ length: count }, (_, index) => Number((edge + index * step).toFixed(3)));
}

export function fineTimestamps(center: number, duration: number, profile: SamplingProfile): number[] {
  const step = 1 / profile.fineFps;
  const from = Math.max(0.02, center - profile.fineWindowSec);
  const to = Math.min(duration - 0.02, center + profile.fineWindowSec);
  const times: number[] = [];
  for (let time = from; time <= to + 1e-6; time += step) times.push(Number(time.toFixed(3)));
  return times;
}
