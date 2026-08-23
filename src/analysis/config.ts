import type { Settings } from '../types/domain.ts';
import type { AnalysisFrameSize } from '../types/analysis.ts';

/**
 * Every tunable in the pipeline, in one place.
 *
 * These are starting points chosen to be conservative, not thresholds fitted to
 * a particular clip. Over-fitting them is how a scene detector ends up working
 * beautifully on the developer's test video and nowhere else — so the adaptive
 * logic in `candidates.ts` does most of the real work, and these mostly bound
 * how much of the video gets looked at.
 */

// -- Analysis mode -----------------------------------------------------------

export type AnalysisMode = 'short' | 'medium' | 'long';

/**
 * A 15-second Reel and a 20-minute talk are not the same problem, and sampling
 * them by one rule serves neither. Short form gets density; long form gets
 * triage first and density only where something is happening.
 */
export function modeFor(duration: number): AnalysisMode {
  if (duration <= 60) return 'short';
  if (duration <= 420) return 'medium';
  return 'long';
}

export interface SamplingProfile {
  /**
   * Pass A. A wide, cheap sweep whose only job is to say where the video is
   * busy — not to locate anything precisely.
   */
  coarseFps: number;
  maxCoarseFrames: number;
  /**
   * Pass B. Re-samples every region the coarse pass found active, at a rate
   * high enough to resolve the events short-form editing is actually made of.
   *
   * This pass is the fix for the single largest source of missed events: at one
   * fixed 3 fps, a 400ms whip pan produced one or two elevated samples and a
   * 60ms flash frame produced none at all. Nothing downstream can recover an
   * event that was never sampled.
   */
  mediumFps: number;
  maxMediumFrames: number;
  /** Pass C. Around each confirmed candidate, to resolve peak and velocity. */
  fineFps: number;
  fineWindowSec: number;
  /** Ceiling on events carried into interpretation. */
  maxCandidates: number;
  /** Regions the medium pass will densify. Bounds pass B's cost. */
  maxActiveRegions: number;
}

/**
 * Quality dial x duration mode.
 *
 * `economy` is held at roughly the cost of the previous single-pass design;
 * `balanced` spends about twice that and is where the product should sit.
 */
const BASE_PROFILES: Record<Settings['samplingRate'], SamplingProfile> = {
  economy: {
    coarseFps: 2,
    maxCoarseFrames: 110,
    mediumFps: 8,
    maxMediumFrames: 120,
    fineFps: 16,
    fineWindowSec: 0.3,
    maxCandidates: 14,
    maxActiveRegions: 12,
  },
  balanced: {
    coarseFps: 3,
    maxCoarseFrames: 170,
    mediumFps: 12,
    maxMediumFrames: 260,
    fineFps: 24,
    fineWindowSec: 0.36,
    maxCandidates: 26,
    maxActiveRegions: 22,
  },
  thorough: {
    coarseFps: 4,
    maxCoarseFrames: 240,
    mediumFps: 18,
    maxMediumFrames: 420,
    fineFps: 30,
    fineWindowSec: 0.42,
    maxCandidates: 40,
    maxActiveRegions: 34,
  },
};

/**
 * Longer videos trade density for coverage.
 *
 * A 20-minute video sampled at short-form rates would be thousands of seeks and
 * an unusable bill. It is swept thinly, and the budget is then spent on the
 * regions that turned out to contain something.
 */
const MODE_SCALE: Record<AnalysisMode, { coarse: number; medium: number; candidates: number; regions: number }> = {
  short: { coarse: 1, medium: 1, candidates: 1, regions: 1 },
  medium: { coarse: 0.55, medium: 0.85, candidates: 1.3, regions: 1.3 },
  long: { coarse: 0.18, medium: 0.7, candidates: 1.6, regions: 1.6 },
};

export function profileFor(rate: Settings['samplingRate'], duration: number): SamplingProfile {
  const base = BASE_PROFILES[rate];
  const scale = MODE_SCALE[modeFor(duration)];
  return {
    ...base,
    coarseFps: base.coarseFps * scale.coarse,
    mediumFps: base.mediumFps * scale.medium,
    maxCandidates: Math.round(base.maxCandidates * scale.candidates),
    maxActiveRegions: Math.round(base.maxActiveRegions * scale.regions),
  };
}

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
  /** Weights of the three change signals in the combined score. */
  diffWeight: 0.45,
  histWeight: 0.35,
  chromaWeight: 0.2,

  /**
   * Adaptive threshold: median + k x median-absolute-deviation of the series.
   *
   * Robust statistics, with a caveat that cost this product real recall: when
   * a large minority of intervals contain a cut, the deviation inflates and the
   * threshold climbs *above* many genuine cuts. The absolute ceiling below is
   * what stops a dense edit from hiding its own cuts.
   */
  thresholdK: 3.0,
  /** No candidate below this, however quiet the video — guards against noise. */
  minScore: 0.045,
  /**
   * A score this high is a cut whatever the rest of the video is doing. The
   * adaptive threshold is never allowed above it.
   */
  absoluteCut: 0.3,
  /** Regions above this fraction of the adaptive threshold get densified. */
  activeRatio: 0.55,

  /**
   * Two boundaries closer than this are the same event.
   *
   * A floor rather than the whole rule: the effective gap is derived from the
   * sampling interval in `candidates.ts`, because a constant larger than the
   * interval silently merges every pair of adjacent cuts — which is precisely
   * how sub-half-second cutting became invisible.
   */
  minGapFloorSec: 0.1,
  /** Sustained motion above this (normalised) starts a camera-movement run. */
  motionThreshold: 0.03,
  /** A camera run must last at least this long to be worth reporting. */
  minMotionRunSec: 0.22,
  /** |lumaDelta| above this, with little structural change, reads as a flash. */
  flashLumaDelta: 0.16,
  /** A chroma shift this large with little structural change is a grade change. */
  colorShift: 0.22,
  /** Divergence above this dominates translation, so the event is a zoom. */
  zoomDominance: 0.35,
  /** Edge density falling by this fraction during motion reads as blur. */
  blurEdgeDrop: 0.25,

  /** A gradual change must persist across at least this many samples. */
  gradualMinFrames: 3,
  /** ...and each of them must exceed this fraction of the adaptive threshold. */
  gradualRatio: 0.4,

  /** Candidates within this window are one event with secondary parts. */
  clusterWindowSec: 0.45,
} as const;

export const EVIDENCE = {
  /** Longest edge of an evidence JPEG sent to the model. */
  frameMaxWidth: 448,
  jpegQuality: 0.74,
  /**
   * Frames per primary event: a real temporal sequence rather than a triptych.
   *
   * Three frames can show that something changed. They cannot show velocity,
   * acceleration, or where the peak sits — which is why the previous design
   * could say "a whip pan happened" and never "the cut lands just after maximum
   * movement". Five is the smallest strip that carries a curve.
   */
  primaryFrames: 5,
  /** Frames per secondary event. Enough to classify, not to narrate. */
  secondaryFrames: 3,
  /** Images per candidate-interpretation call. */
  framesPerBatch: 20,
  /** Events per candidate-interpretation call. */
  eventsPerBatch: 4,
  /** Hard ceiling on images across the whole analysis, all passes included. */
  maxFramesPerAnalysis: 96,
  /** Thumbnails handed to the global context pass. */
  globalFrames: 8,
  globalFrameMaxWidth: 320,
} as const;

// -- Timestamp planning ------------------------------------------------------

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

export interface ActiveRegion {
  start: number;
  end: number;
  score: number;
}

/**
 * Densifies the regions the coarse pass found busy.
 *
 * Returns timestamps only — the caller samples them and re-runs detection on
 * the combined series. Regions are padded by one coarse interval either side,
 * because a change detected between two samples began somewhere before the
 * later one and the interesting part is often just outside the bracket.
 */
export function mediumTimestamps(
  regions: ActiveRegion[],
  duration: number,
  profile: SamplingProfile,
): number[] {
  if (regions.length === 0) return [];

  const step = 1 / profile.mediumFps;
  const times = new Set<number>();

  for (const region of [...regions].sort((a, b) => b.score - a.score).slice(0, profile.maxActiveRegions)) {
    for (let time = region.start; time <= region.end + 1e-6; time += step) {
      if (times.size >= profile.maxMediumFrames) break;
      const clamped = Math.max(0.02, Math.min(duration - 0.02, time));
      times.add(Number(clamped.toFixed(3)));
    }
    if (times.size >= profile.maxMediumFrames) break;
  }

  return [...times].sort((a, b) => a - b);
}

export function fineTimestamps(center: number, duration: number, profile: SamplingProfile): number[] {
  const step = 1 / profile.fineFps;
  const from = Math.max(0.02, center - profile.fineWindowSec);
  const to = Math.min(duration - 0.02, center + profile.fineWindowSec);
  const times: number[] = [];
  for (let time = from; time <= to + 1e-6; time += step) times.push(Number(time.toFixed(3)));
  return times;
}

/** Evenly spread thumbnails for the global pass, avoiding both extremes. */
export function globalTimestamps(duration: number, count = EVIDENCE.globalFrames): number[] {
  if (duration <= 0) return [];
  const usable = duration * 0.94;
  const offset = duration * 0.03;
  return Array.from({ length: count }, (_, index) =>
    Number((offset + (usable * (index + 0.5)) / count).toFixed(3)),
  );
}
