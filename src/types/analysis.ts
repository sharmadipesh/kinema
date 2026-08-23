import type { MotionDirection } from './motion.ts';

/**
 * The measured layer of the pipeline.
 *
 * Frames themselves never cross a message boundary during analysis. Extension
 * messaging is JSON-only — no transferables, no ArrayBuffer — so shipping raw
 * pixels would mean base64-encoding megabytes per pass. Instead the context
 * that already holds the pixels reduces each frame to these few numbers, and
 * only the handful of frames finally chosen as *evidence* are ever encoded as
 * images.
 */

export interface FrameMetrics {
  /** The time the frame was actually decoded at, not the time requested. */
  time: number;
  /** Seconds since the previous sampled frame. Varies once sampling adapts. */
  interval: number;
  /** Mean luma, 0–1. */
  meanLuma: number;
  /** Fraction of pixels on a strong gradient, 0–1. A blank frame scores ~0. */
  edgeDensity: number;
  /**
   * Signed change in edge density against the previous frame.
   *
   * A sharp negative value is the product's only direct evidence of motion
   * blur: detail does not vanish from a frame for any other common reason, and
   * "the image went soft exactly as it started moving" is what separates a whip
   * pan from a fast cut.
   */
  edgeDelta: number;
  /** Mean absolute luma difference against the previous sampled frame, 0–1. */
  diff: number;
  /** Chi-square distance between 32-bin luma histograms, 0–1. */
  histDiff: number;
  /**
   * Chi-square distance between coarse 4x4x4 RGB histograms, 0–1.
   *
   * Luma alone cannot see a grade change: a warm-to-cool shift at constant
   * brightness moves no luma histogram at all. This is what makes colour
   * events detectable rather than merely assertable.
   */
  chromaDist: number;
  /** Signed change in mean luma against the previous frame, −1 → 1. */
  lumaDelta: number;
  /** Estimated global translation in analysis pixels, per sample interval. */
  motionX: number;
  motionY: number;
  /** Normalised against analysis frame width, 0–1. */
  motionMagnitude: number;
  /**
   * Displacement per second rather than per sample, so velocity stays
   * comparable once the sampler starts varying its interval.
   */
  motionVelocity: number;
  /** True when block matching hit its search limit and the real motion is faster. */
  motionSaturated: boolean;
  /**
   * Mean outward radial component of the per-quadrant motion vectors.
   * Positive = the frame expanded (zoom in). Negative = contracted (zoom out).
   */
  divergence: number;
}

/** Which pass produced a measurement. Coarse numbers are cheaper and blunter. */
export type SamplingPass = 'coarse' | 'medium' | 'fine';

export type CandidateKind =
  /** A hard visual discontinuity — most often a cut. */
  | 'boundary'
  /** A change spread across several frames — a dissolve, a fade, a grade shift. */
  | 'gradual'
  /** Sustained camera or subject displacement. */
  | 'camera'
  /** A luminance spike or collapse — a flash, a fade to or from black. */
  | 'luma'
  /** A colour shift with little structural change. */
  | 'color';

/**
 * A timestamp the local pass thinks is worth a closer look. Candidates carry
 * only measurements; naming what happened is the model's job.
 */
export interface Candidate {
  id: string;
  kind: CandidateKind;
  /** Refined by the fine pass. */
  time: number;
  /**
   * Where the change was strongest, when the fine pass could locate it.
   *
   * Distinct from `time` on purpose: a whip pan *starts* before its peak, and
   * "the cut sits near maximum movement" is only a statement anyone can make
   * once these two are measured separately.
   */
  peakTime?: number;
  /** Present when the change demonstrably spanned a range rather than a frame. */
  endTime?: number;
  /** 0–1, how far above the detection threshold this peak sat. */
  strength: number;
  /** 0–1 blend of strength, evidence density and signal agreement. Internal only. */
  quality: number;
  metrics: {
    diff: number;
    histDiff: number;
    chromaDist: number;
    lumaDelta: number;
    edgeDelta: number;
    motionMagnitude: number;
    motionVelocity: number;
    motionSaturated: boolean;
    /** Peak velocity across the fine window, when one was measured. */
    peakVelocity?: number;
    /** When velocity peaked. Compared against `peakTime` to place the cut. */
    peakVelocityTime?: number;
    /**
     * Whether movement in the outgoing frames carries into the incoming ones.
     *
     * Replaces an earlier single "acceleration" scalar, which averaged velocity
     * either side of the peak and was therefore near-meaningless across a
     * window that contains a peak by construction. This is the claim the
     * product actually wants to make — "the incoming shot continues the same
     * movement" — and unlike acceleration it is directly measurable.
     */
    motionContinues?: boolean;
    direction?: MotionDirection;
    scaleChange?: 'closer' | 'farther';
    sampleIntervalSec: number;
  };
  /** The fine-pass series behind this candidate. Drives the filmstrip and prompt. */
  profile?: Array<{ time: number; change: number; velocity: number; edgeDensity: number }>;
}

/**
 * A primary event and the smaller measurements that belong to it.
 *
 * A single whip pan produces a camera run, an edge collapse and a boundary
 * within a few hundred milliseconds. Reporting those as three timeline markers
 * is not more information, it is the same information three times — so they are
 * clustered here, and only the primary reaches the timeline.
 */
export interface CandidateCluster {
  id: string;
  primary: Candidate;
  secondaries: Candidate[];
  startTime: number;
  endTime: number;
}

/** Where a frame sits in an event's temporal sequence. */
/**
 * `stage` is not part of an event filmstrip. It is the single representative
 * frame captured for a story stage, stored in the same place so the Story board
 * can show the frame it was actually built from rather than the nearest
 * unrelated event frame.
 */
export type FrameRole = 'before' | 'build' | 'peak' | 'settle' | 'after' | 'stage';

/** An evidence frame: a small JPEG plus the time it was actually taken at. */
export interface EvidenceFrame {
  id: string;
  candidateId: string;
  role: FrameRole;
  /** Position within the event's filmstrip, earliest first. */
  order: number;
  time: number;
  /** `data:image/jpeg;base64,…` */
  dataUrl: string;
}

/** Analysis-resolution frame size. Small on purpose: this is signal, not imagery. */
export interface AnalysisFrameSize {
  width: number;
  height: number;
}
