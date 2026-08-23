import type { Candidate, EvidenceFrame } from '../types/analysis.ts';
import type { AnalysisCoverage, CoverageLevel, MotionAnalysis, MotionEvent, Scene } from '../types/motion.ts';

/**
 * What the analysis actually managed to cover.
 *
 * Deliberately per-area and deliberately not a percentage. There is no
 * defensible way to compute "this analysis is 87% accurate" — accuracy would
 * require knowing the right answer — and a number in that position would be
 * read as measured however it were labelled. Per-area status is checkable
 * against the run's own statistics, and an area that could not be analysed
 * says so instead of quietly scoring low.
 */

export interface CoverageInput {
  scenes: Scene[];
  candidates: Candidate[];
  events: MotionEvent[];
  frames: EvidenceFrame[];
  localOnly: boolean;
  /** Clusters that reached the model at all. */
  interpretedClusters: number;
  totalClusters: number;
  frameAccessRestricted: boolean;
}

/**
 * Attaches coverage to a finished analysis.
 *
 * The only supported way to produce it. Coverage reads `events` — that is how
 * it knows whether typography was found — and the events do not exist until
 * normalisation has run. Both call sites previously derived coverage *as an
 * input* to normalisation and passed `events: []`, which made the typography
 * branch permanently dead and printed "No typography was detected" over videos
 * full of it. Deriving it from the finished analysis is what stops that
 * recurring: there is no longer a place to pass the wrong events.
 */
export function attachCoverage(
  analysis: MotionAnalysis,
  input: Omit<CoverageInput, 'events' | 'scenes'>,
): MotionAnalysis {
  return {
    ...analysis,
    coverage: deriveCoverage({ ...input, scenes: analysis.scenes, events: analysis.events }),
  };
}

export function deriveCoverage(input: CoverageInput): AnalysisCoverage {
  const notes: string[] = [];

  // Scenes are local and either found or not.
  const scenes: CoverageLevel =
    input.scenes.length > 1 ? 'complete' : input.candidates.length > 0 ? 'partial' : 'unavailable';
  if (scenes === 'partial') notes.push('No shot boundaries were detected, so this reads as one continuous take.');

  const interpretedShare = input.totalClusters === 0 ? 0 : input.interpretedClusters / input.totalClusters;

  const transitions: CoverageLevel = input.localOnly
    ? 'partial'
    : interpretedShare >= 0.95
      ? 'complete'
      : interpretedShare >= 0.7
        ? 'high'
        : 'partial';
  if (input.localOnly) {
    notes.push('Interpretation was unavailable, so transitions carry measured timings without a technique reading.');
  } else if (interpretedShare < 0.7 && input.totalClusters > 0) {
    notes.push(
      `${input.totalClusters - input.interpretedClusters} of ${input.totalClusters} moments were measured but not interpreted.`,
    );
  }

  // Camera motion is measured whenever any direction was resolvable.
  const directed = input.candidates.filter((candidate) => candidate.metrics.direction).length;
  const cameraMotion: CoverageLevel =
    input.candidates.length === 0
      ? 'unavailable'
      : directed / input.candidates.length >= 0.5
        ? 'complete'
        : directed > 0
          ? 'high'
          : 'partial';
  if (cameraMotion === 'partial') {
    notes.push('Movement direction could not be resolved for most moments — the footage may be largely static.');
  }

  /**
   * Typography is the one area where absence is genuinely ambiguous: no text
   * events can mean a video with no text, or text the sampler never landed on.
   * Reported as partial rather than complete, because claiming full coverage of
   * something never looked for would be the wrong kind of confident.
   */
  const textEvents = input.events.filter((event) => event.category === 'text').length;
  const typography: CoverageLevel = input.localOnly ? 'unavailable' : textEvents > 0 ? 'high' : 'partial';
  if (typography === 'partial') {
    notes.push('No typography was detected. Short or infrequent text can fall between sampled frames.');
  }

  const frameAccess: CoverageLevel = input.frameAccessRestricted
    ? 'unavailable'
    : input.frames.length > 0
      ? 'complete'
      : 'partial';

  return { scenes, transitions, cameraMotion, typography, frameAccess, notes };
}

export const COVERAGE_LABELS: Record<CoverageLevel, string> = {
  complete: 'Complete',
  high: 'High confidence',
  partial: 'Partial',
  unavailable: 'Unavailable',
};
