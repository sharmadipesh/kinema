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
  /** Mean luma, 0–1. */
  meanLuma: number;
  /** Fraction of pixels on a strong gradient, 0–1. A blank frame scores ~0. */
  edgeDensity: number;
  /** Mean absolute luma difference against the previous sampled frame, 0–1. */
  diff: number;
  /** Chi-square distance between 32-bin luma histograms, 0–1. */
  histDiff: number;
  /** Signed change in mean luma against the previous frame, −1 → 1. */
  lumaDelta: number;
  /** Estimated global translation in analysis pixels, per sample interval. */
  motionX: number;
  motionY: number;
  /** Normalised against analysis frame width, 0–1. */
  motionMagnitude: number;
  /**
   * Mean outward radial component of the per-quadrant motion vectors.
   * Positive = the frame expanded (zoom in). Negative = contracted (zoom out).
   */
  divergence: number;
}

export type CandidateKind = 'boundary' | 'camera' | 'luma';

/**
 * A timestamp the local pass thinks is worth a closer look. Candidates carry
 * only measurements; naming what happened is the model's job.
 */
export interface Candidate {
  id: string;
  kind: CandidateKind;
  /** Refined by the fine pass. */
  time: number;
  /** Present when the change demonstrably spanned a range rather than a frame. */
  endTime?: number;
  /** 0–1, how far above the adaptive threshold this peak sat. */
  strength: number;
  metrics: {
    diff: number;
    histDiff: number;
    lumaDelta: number;
    motionMagnitude: number;
    direction?: MotionDirection;
    sampleIntervalSec: number;
  };
}

/** An evidence frame: a small JPEG plus the time it was actually taken at. */
export interface EvidenceFrame {
  id: string;
  candidateId: string;
  role: 'before' | 'during' | 'after';
  time: number;
  /** `data:image/jpeg;base64,…` */
  dataUrl: string;
}

/** Analysis-resolution frame size. Small on purpose: this is signal, not imagery. */
export interface AnalysisFrameSize {
  width: number;
  height: number;
}
