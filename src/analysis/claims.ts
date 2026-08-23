import type { Candidate } from '../types/analysis.ts';
import type {
  ClaimCheck,
  MotionDirection,
  ConfidenceBreakdown,
  Certainty,
  EventHypothesis,
  EventObservations,
} from '../types/motion.ts';
import { DETECTION } from './config.ts';

/**
 * Checking what the model says against what the pixels measured.
 *
 * A vision model asked to explain a moment will produce a coherent account
 * whether or not that account matches the frames — and a coherent wrong answer
 * is far more damaging here than an uncertain one, because it reads as
 * authoritative and a creator will go and try to reproduce it.
 *
 * So every claim the model makes that overlaps something already measured is
 * checked. Disagreement does not discard the event: the model may be right
 * about the technique and wrong about one detail. It lowers confidence, caps
 * certainty, and is recorded — visibly in development, and in the stored event
 * either way.
 *
 * Claims that overlap nothing measurable return `unmeasurable`, which is not a
 * failure. Most of what a model usefully says about an edit — matched subjects,
 * compositional rhyme, intent — is beyond a 64x36 luma buffer, and pretending
 * otherwise would be its own kind of dishonesty.
 */

const MOTION_BANDS: Record<'none' | 'slight' | 'moderate' | 'strong', [number, number]> = {
  none: [0, 0.008],
  slight: [0.004, 0.03],
  moderate: [0.018, 0.06],
  strong: [0.04, 1],
};

export function checkClaims(observations: EventObservations, candidate: Candidate): ClaimCheck[] {
  const checks: ClaimCheck[] = [];
  const metrics = candidate.metrics;

  // -- Direction. The claim most worth checking: it is the one the product
  //    prints as a measured fact, and a contradiction here means the model's
  //    whole account of the movement is about a different movement.
  if (observations.direction) {
    const claimed = observations.direction.toLowerCase();
    const implied = impliedDirection(claimed);
    if (!metrics.direction) {
      checks.push({ field: 'direction', claimed, measured: 'not measurable', verdict: 'unmeasurable' });
    } else if (!implied) {
      // The phrasing could not be resolved to a direction. Unparsed is not the
      // same as wrong, and guessing either way would be worse than abstaining.
      checks.push({ field: 'direction', claimed, measured: metrics.direction, verdict: 'unmeasurable' });
    } else {
      checks.push({
        field: 'direction',
        claimed,
        measured: metrics.direction,
        verdict: implied === metrics.direction ? 'agrees' : 'contradicts',
      });
    }
  }

  // -- Horizontal motion strength
  if (observations.horizontalMotion) {
    const band = MOTION_BANDS[observations.horizontalMotion];
    const measured = Math.abs(metrics.motionMagnitude);
    // Saturation means "at least this fast", so a strong claim is never wrong.
    const agrees = metrics.motionSaturated
      ? observations.horizontalMotion === 'strong' || observations.horizontalMotion === 'moderate'
      : measured >= band[0] && measured <= band[1];
    checks.push({
      field: 'horizontalMotion',
      claimed: observations.horizontalMotion,
      measured: `${(measured * 100).toFixed(1)}% of frame width${metrics.motionSaturated ? ' (saturated)' : ''}`,
      verdict: agrees ? 'agrees' : 'contradicts',
    });
  }

  // -- Blur. Edge density falling is the only direct pixel evidence of smear.
  if (observations.blurProgression && observations.blurProgression !== 'none') {
    const lost = -metrics.edgeDelta;
    const agrees = observations.blurProgression === 'increasing' ? lost > 0.01 : lost <= 0.02;
    checks.push({
      field: 'blurProgression',
      claimed: observations.blurProgression,
      measured: lost > 0 ? `detail down ${(lost * 100).toFixed(0)}%` : 'detail steady or rising',
      verdict: agrees ? 'agrees' : 'contradicts',
    });
  }

  // -- Luminance. A claimed fade with no measured luminance move is the
  //    textbook hallucination this check exists for.
  if (observations.luminanceProgression && observations.luminanceProgression !== 'none') {
    const delta = metrics.lumaDelta;
    const agrees =
      observations.luminanceProgression === 'brightening'
        ? delta > 0.04
        : observations.luminanceProgression === 'darkening'
          ? delta < -0.04
          : Math.abs(delta) > DETECTION.flashLumaDelta;
    checks.push({
      field: 'luminanceProgression',
      claimed: observations.luminanceProgression,
      measured: `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(0)}% brightness`,
      verdict: agrees ? 'agrees' : 'contradicts',
    });
  }

  // -- Scale. Divergence separates a push from a pan; nothing else can.
  if (observations.scaleProgression && observations.scaleProgression !== 'none') {
    const scale = metrics.scaleChange;
    if (!scale) {
      checks.push({
        field: 'scaleProgression',
        claimed: observations.scaleProgression,
        measured: 'no radial component measured',
        verdict: 'unmeasurable',
      });
    } else {
      const agrees = (observations.scaleProgression === 'growing') === (scale === 'closer');
      checks.push({
        field: 'scaleProgression',
        claimed: observations.scaleProgression,
        measured: scale === 'closer' ? 'frame expanding' : 'frame contracting',
        verdict: agrees ? 'agrees' : 'contradicts',
      });
    }
  }

  // -- Whether movement survived the change
  if (observations.incomingMotion && metrics.motionContinues !== undefined) {
    const agrees =
      observations.incomingMotion === 'continues' ? metrics.motionContinues : !metrics.motionContinues;
    checks.push({
      field: 'incomingMotion',
      claimed: observations.incomingMotion,
      measured: metrics.motionContinues ? 'movement continues after the change' : 'movement stops at the change',
      verdict: agrees ? 'agrees' : 'contradicts',
    });
  }

  // -- Scene identity. A boundary candidate is a measured discontinuity.
  if (observations.sceneIdentityChanges !== undefined) {
    const measuredChange = candidate.kind === 'boundary' || candidate.kind === 'gradual';
    checks.push({
      field: 'sceneIdentityChanges',
      claimed: String(observations.sceneIdentityChanges),
      measured: measuredChange ? 'discontinuity measured' : 'no discontinuity measured',
      verdict: observations.sceneIdentityChanges === measuredChange ? 'agrees' : 'contradicts',
    });
  }

  return checks;
}

/**
 * Resolves a phrase like "left-to-right" to the direction it means.
 *
 * Order is load-bearing and was the source of a genuine bug: a naive substring
 * test agreed that "right-to-left" matched a measured `right`, because the
 * string contains it. Two-sided phrases are therefore matched before any bare
 * token, and diagonals before their components.
 *
 * Returns undefined for anything unrecognised, which produces an `unmeasurable`
 * verdict rather than a coin-flip.
 */
function impliedDirection(claimed: string): MotionDirection | undefined {
  const text = claimed.toLowerCase().replace(/[\s_]+/g, '-');

  // Two-sided phrases first: they contain the tokens they are not.
  if (/left-?to-?right|l-?to-?r/.test(text)) return 'right';
  if (/right-?to-?left|r-?to-?l/.test(text)) return 'left';
  if (/bottom-?to-?top|up-?wards?|upward/.test(text)) return 'up';
  if (/top-?to-?bottom|down-?wards?|downward/.test(text)) return 'down';

  // Scale before translation: "push in" contains "in".
  if (/push-?in|zoom-?in|closer|expand/.test(text)) return 'outward';
  if (/pull-?out|zoom-?out|farther|further|contract/.test(text)) return 'inward';

  // Diagonals before their components.
  for (const diagonal of ['up-left', 'up-right', 'down-left', 'down-right'] as const) {
    if (text.includes(diagonal)) return diagonal;
  }

  if (/\boutward\b/.test(text)) return 'outward';
  if (/\binward\b/.test(text)) return 'inward';
  if (/\bright\b|rightward/.test(text)) return 'right';
  if (/\bleft\b|leftward/.test(text)) return 'left';
  if (/\bup\b/.test(text)) return 'up';
  if (/\bdown\b/.test(text)) return 'down';

  return undefined;
}

export interface ConfidenceInput {
  modelConfidence: number;
  candidate: Candidate;
  checks: ClaimCheck[];
  hypotheses: EventHypothesis[];
}

/**
 * How the final confidence is calculated.
 *
 * Multiplicative, and never above the model's own figure. Each factor can only
 * take confidence away, which keeps the result interpretable: the product is
 * never *more* sure than either the model or the evidence, and every reduction
 * has a named cause.
 *
 *   final = modelConfidence
 *         x claimAgreement      1.0 all agree, down to 0.45 with contradictions
 *         x hypothesisMargin    1.0 no close runner-up, down to 0.8
 *         capped at 0.5 + 0.5 x candidate.quality
 *
 * The cap is the load-bearing part: a model is free to be certain, but not
 * more certain than the measurement it was shown. A candidate that barely
 * cleared the detection threshold cannot yield a 95% event however fluent the
 * explanation.
 */
export function composeConfidence(input: ConfidenceInput): ConfidenceBreakdown {
  const contradictions = input.checks.filter((check) => check.verdict === 'contradicts').length;
  const checkable = input.checks.filter((check) => check.verdict !== 'unmeasurable').length;

  // One contradiction is a detail wrong; three is a different account entirely.
  const claimAgreement = checkable === 0 ? 1 : Math.max(0.45, 1 - contradictions * 0.22);

  const runnerUp = input.hypotheses.reduce((best, entry) => Math.max(best, entry.confidence), 0);
  const hypothesisMargin =
    runnerUp <= 0 || input.modelConfidence <= 0
      ? 1
      : Math.max(0.8, Math.min(1, 1 - (runnerUp / Math.max(input.modelConfidence, 0.01)) * 0.2));

  const evidenceCeiling = 0.5 + 0.5 * input.candidate.quality;
  const raw = input.modelConfidence * claimAgreement * hypothesisMargin;

  return {
    modelConfidence: round(input.modelConfidence),
    evidenceQuality: round(input.candidate.quality),
    claimAgreement: round(claimAgreement),
    hypothesisMargin: round(hypothesisMargin),
    evidenceCeiling: round(evidenceCeiling),
    final: round(Math.max(0, Math.min(raw, evidenceCeiling))),
  };
}

/**
 * Certainty bands.
 *
 *   detected  — local measurement alone supports this, and nothing contradicts it
 *   likely    — the frames support this reading
 *   possible  — several readings remain plausible, or a claim did not hold up
 *
 * A contradicted claim can never be `detected`, however confident the model is:
 * if the account does not match the pixels, the product has no business
 * presenting it as measured.
 */
export function decideCertainty(input: {
  candidate: Candidate;
  confidence: ConfidenceBreakdown;
  checks: ClaimCheck[];
}): Certainty {
  const contradictions = input.checks.filter((check) => check.verdict === 'contradicts').length;
  if (contradictions >= 2) return 'possible';

  if (contradictions === 0 && input.candidate.quality >= 0.5 && input.confidence.final >= 0.6) {
    return 'detected';
  }
  if (input.confidence.final >= 0.45) return 'likely';
  return 'possible';
}

const round = (value: number): number => Number(value.toFixed(3));
