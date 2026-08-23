import { describe, expect, it } from 'vitest';
import { checkClaims, composeConfidence, decideCertainty } from './claims.ts';
import type { Candidate } from '../types/analysis.ts';
import type { EventObservations } from '../types/motion.ts';

const candidate = (metrics: Partial<Candidate['metrics']> = {}, overrides: Partial<Candidate> = {}): Candidate => ({
  id: 'c1',
  kind: 'boundary',
  time: 4.32,
  strength: 0.8,
  quality: 0.8,
  metrics: {
    diff: 0.5, histDiff: 0.5, chromaDist: 0.1, lumaDelta: 0, edgeDelta: 0,
    motionMagnitude: 0.05, motionVelocity: 0.6, motionSaturated: false,
    direction: 'right', sampleIntervalSec: 0.04,
    ...metrics,
  },
  ...overrides,
});

const verdictFor = (checks: ReturnType<typeof checkClaims>, field: string) =>
  checks.find((check) => check.field === field)?.verdict;

describe('checkClaims', () => {
  it('accepts a direction claim that matches the measurement', () => {
    const checks = checkClaims({ direction: 'left-to-right' }, candidate());
    expect(verdictFor(checks, 'direction')).toBe('agrees');
  });

  it('catches a direction claim that contradicts the measurement', () => {
    // The hallucination that matters most: the product prints direction as a
    // measured fact, so a contradiction means the whole account is about a
    // different movement.
    const checks = checkClaims({ direction: 'right-to-left' }, candidate());
    expect(verdictFor(checks, 'direction')).toBe('contradicts');
  });

  it('understands the several ways a direction gets phrased', () => {
    for (const phrasing of ['rightward', 'left to right', 'L-to-R', 'right']) {
      expect(verdictFor(checkClaims({ direction: phrasing }, candidate()), 'direction')).toBe('agrees');
    }
  });

  it('is not fooled by a phrase that contains the opposite token', () => {
    // "right-to-left" contains "right". A substring test agreed with it, which
    // silently defeated the entire purpose of checking the claim.
    for (const phrasing of ['right-to-left', 'right to left', 'R-to-L', 'leftward']) {
      expect(verdictFor(checkClaims({ direction: phrasing }, candidate()), 'direction')).toBe('contradicts');
    }
  });

  it('does not resolve a scale phrase to a translation', () => {
    // "push in" contains "in"; a zoom is not a leftward pan.
    const zooming = candidate({ direction: 'outward' });
    expect(verdictFor(checkClaims({ direction: 'push in' }, zooming), 'direction')).toBe('agrees');
  });

  it('abstains on phrasing it cannot resolve', () => {
    const checks = checkClaims({ direction: 'diagonally across the frame' }, candidate());
    expect(verdictFor(checks, 'direction')).toBe('unmeasurable');
  });

  it('reports unmeasurable rather than contradicting when nothing was measured', () => {
    const checks = checkClaims({ direction: 'rightward' }, candidate({ direction: undefined }));
    expect(verdictFor(checks, 'direction')).toBe('unmeasurable');
  });

  it('catches a claimed fade with no measured luminance move', () => {
    // The textbook fabrication this check exists for.
    const checks = checkClaims({ luminanceProgression: 'darkening' }, candidate({ lumaDelta: 0.001 }));
    expect(verdictFor(checks, 'luminanceProgression')).toBe('contradicts');
  });

  it('accepts a fade that the luminance actually supports', () => {
    const checks = checkClaims({ luminanceProgression: 'darkening' }, candidate({ lumaDelta: -0.3 }));
    expect(verdictFor(checks, 'luminanceProgression')).toBe('agrees');
  });

  it('catches claimed blur when detail did not drop', () => {
    expect(verdictFor(checkClaims({ blurProgression: 'increasing' }, candidate({ edgeDelta: 0.05 })), 'blurProgression'))
      .toBe('contradicts');
    expect(verdictFor(checkClaims({ blurProgression: 'increasing' }, candidate({ edgeDelta: -0.2 })), 'blurProgression'))
      .toBe('agrees');
  });

  it('treats a strong-motion claim as safe when the estimator saturated', () => {
    // Saturation means "at least this fast", so the claim cannot be refuted.
    const checks = checkClaims(
      { horizontalMotion: 'strong' },
      candidate({ motionMagnitude: 0.09, motionSaturated: true }),
    );
    expect(verdictFor(checks, 'horizontalMotion')).toBe('agrees');
  });

  it('catches a strong-motion claim on a still frame', () => {
    const checks = checkClaims({ horizontalMotion: 'strong' }, candidate({ motionMagnitude: 0.001 }));
    expect(verdictFor(checks, 'horizontalMotion')).toBe('contradicts');
  });

  it('checks whether movement survived the change', () => {
    expect(
      verdictFor(checkClaims({ incomingMotion: 'continues' }, candidate({ motionContinues: false })), 'incomingMotion'),
    ).toBe('contradicts');
    expect(
      verdictFor(checkClaims({ incomingMotion: 'continues' }, candidate({ motionContinues: true })), 'incomingMotion'),
    ).toBe('agrees');
  });

  it('checks a claimed scene change against the measured discontinuity', () => {
    const onCamera = candidate({}, { kind: 'camera' });
    expect(verdictFor(checkClaims({ sceneIdentityChanges: true }, onCamera), 'sceneIdentityChanges')).toBe('contradicts');
    expect(verdictFor(checkClaims({ sceneIdentityChanges: true }, candidate()), 'sceneIdentityChanges')).toBe('agrees');
  });

  it('says nothing about claims that overlap no measurement', () => {
    const observations: EventObservations = { compositionChange: 'Framing opens out.' };
    expect(checkClaims(observations, candidate())).toHaveLength(0);
  });
});

describe('composeConfidence', () => {
  const base = { modelConfidence: 0.9, candidate: candidate(), hypotheses: [] };

  it('never exceeds the model confidence', () => {
    const result = composeConfidence({ ...base, checks: [] });
    expect(result.final).toBeLessThanOrEqual(0.9);
  });

  it('caps at what the evidence supports', () => {
    // A model may be certain; it may not be more certain than the measurement
    // it was shown.
    const weak = composeConfidence({ ...base, candidate: candidate({}, { quality: 0.1 }), checks: [] });
    expect(weak.final).toBeCloseTo(0.55, 2);
    expect(weak.evidenceCeiling).toBeCloseTo(0.55, 2);
  });

  it('reduces confidence for each contradicted claim', () => {
    const clean = composeConfidence({ ...base, checks: checkClaims({ direction: 'rightward' }, candidate()) });
    const conflicted = composeConfidence({
      ...base,
      checks: checkClaims({ direction: 'leftward', luminanceProgression: 'darkening' }, candidate()),
    });
    expect(conflicted.final).toBeLessThan(clean.final);
    expect(conflicted.claimAgreement).toBeLessThan(1);
  });

  it('reduces confidence when a rival explanation is nearly as strong', () => {
    const lonely = composeConfidence({ ...base, checks: [] });
    const contested = composeConfidence({
      ...base,
      checks: [],
      hypotheses: [{ type: 'hard_cut', confidence: 0.85, reasoning: 'Could equally be a cut.' }],
    });
    expect(contested.final).toBeLessThan(lonely.final);
    expect(contested.hypothesisMargin).toBeLessThan(1);
  });

  it('keeps every component so the number can be taken apart', () => {
    const result = composeConfidence({ ...base, checks: [] });
    expect(result).toHaveProperty('modelConfidence');
    expect(result).toHaveProperty('evidenceQuality');
    expect(result).toHaveProperty('claimAgreement');
    expect(result).toHaveProperty('hypothesisMargin');
    expect(result).toHaveProperty('evidenceCeiling');
  });
});

describe('decideCertainty', () => {
  const strong = candidate({}, { quality: 0.9 });

  it('calls a well-supported, uncontradicted event detected', () => {
    const checks = checkClaims({ direction: 'rightward' }, strong);
    const confidence = composeConfidence({ modelConfidence: 0.9, candidate: strong, checks, hypotheses: [] });
    expect(decideCertainty({ candidate: strong, confidence, checks })).toBe('detected');
  });

  it('never calls a contradicted event detected, however confident the model', () => {
    // If the account does not match the pixels, the product has no business
    // presenting it as measured.
    const checks = checkClaims({ direction: 'leftward' }, strong);
    const confidence = composeConfidence({ modelConfidence: 0.99, candidate: strong, checks, hypotheses: [] });
    expect(decideCertainty({ candidate: strong, confidence, checks })).not.toBe('detected');
  });

  it('drops to possible once several claims fail', () => {
    const checks = checkClaims(
      { direction: 'leftward', luminanceProgression: 'darkening', blurProgression: 'increasing' },
      candidate({ edgeDelta: 0.1 }),
    );
    const confidence = composeConfidence({ modelConfidence: 0.9, candidate: strong, checks, hypotheses: [] });
    expect(decideCertainty({ candidate: strong, confidence, checks })).toBe('possible');
  });

  it('calls a weakly evidenced event possible rather than likely', () => {
    const weak = candidate({}, { quality: 0.05 });
    const confidence = composeConfidence({ modelConfidence: 0.3, candidate: weak, checks: [], hypotheses: [] });
    expect(decideCertainty({ candidate: weak, confidence, checks: [] })).toBe('possible');
  });
});
