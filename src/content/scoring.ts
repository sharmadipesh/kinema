/**
 * Which video is the user actually watching?
 *
 * Pure and DOM-free so it can be unit-tested, because the previous heuristic
 * was wrong in a way nobody would catch by looking at it:
 *
 *   (visible ? 2 : 0) + (paused ? 0 : 2) + min(1, width / 1920)
 *
 * `width` there is the *intrinsic* width, so a 4K clip in a 200px sidebar
 * thumbnail outscored the 1080p one filling the viewport. Rendered area is what
 * matters — a video the user can barely see is not the one they are watching,
 * whatever its encoding.
 *
 * Signals are weighted by how strongly each one indicates attention rather than
 * mere presence. Audio is the most decisive: browsers block autoplay with sound,
 * so a video that is audibly playing is one a person deliberately started.
 */

export interface VideoScoreInput {
  /** Rendered area in CSS pixels. */
  renderedArea: number;
  /** Fraction of the element inside the viewport, 0–1. */
  viewportRatio: number;
  /** Viewport area, for normalising rendered size. */
  viewportArea: number;
  paused: boolean;
  muted: boolean;
  /** True when currentTime moved since the previous observation. */
  advancing: boolean;
  /** Milliseconds since the user last interacted with this element, if ever. */
  msSinceInteraction?: number;
  /** Live streams and zero-duration elements are rarely the subject. */
  hasDuration: boolean;
}

export const SCORE_WEIGHTS = {
  playing: 3,
  advancing: 2.5,
  audible: 3,
  /** Scaled by the share of the viewport the video occupies. */
  size: 3,
  visibility: 2,
  interaction: 2.5,
  hasDuration: 0.5,
} as const;

/** Interaction older than this stops counting as a signal of attention. */
const INTERACTION_WINDOW_MS = 30_000;

export function scoreVideo(input: VideoScoreInput): number {
  let score = 0;

  if (!input.paused) score += SCORE_WEIGHTS.playing;
  // Playing but not advancing means stalled, buffering, or a decoy loop.
  if (input.advancing) score += SCORE_WEIGHTS.advancing;
  if (!input.paused && !input.muted) score += SCORE_WEIGHTS.audible;

  const share = input.viewportArea > 0 ? Math.min(1, input.renderedArea / input.viewportArea) : 0;
  score += SCORE_WEIGHTS.size * share;
  score += SCORE_WEIGHTS.visibility * Math.min(1, Math.max(0, input.viewportRatio));

  if (input.msSinceInteraction !== undefined && input.msSinceInteraction < INTERACTION_WINDOW_MS) {
    // Decays linearly: a click ten seconds ago is weaker evidence than one now.
    score += SCORE_WEIGHTS.interaction * (1 - input.msSinceInteraction / INTERACTION_WINDOW_MS);
  }

  if (input.hasDuration) score += SCORE_WEIGHTS.hasDuration;

  return Number(score.toFixed(4));
}

/**
 * Whether the top-scoring video is a confident pick or a coin toss.
 *
 * The panel labels a confident winner "Likely current video" and stays quiet
 * otherwise. Presenting a near-tie as a confident choice is how the wrong video
 * gets analysed without anyone noticing they had a decision to make.
 */
export function isConfident(scores: number[]): boolean {
  if (scores.length <= 1) return true;
  const [best, runnerUp] = [...scores].sort((a, b) => b - a);
  if (best === undefined || runnerUp === undefined) return true;
  if (best < 3) return false;
  return best - runnerUp >= 2;
}
