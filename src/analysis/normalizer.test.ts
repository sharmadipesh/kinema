import { describe, expect, it } from 'vitest';
import { normalizeAnalysis } from './normalizer.ts';
import type { Candidate, CandidateCluster, EvidenceFrame } from '../types/analysis.ts';
import type { ModelEvent } from '../services/validate-motion.ts';

const candidate = (id: string, overrides: Partial<Candidate> = {}): Candidate => ({
  id,
  kind: 'boundary',
  time: 4.32,
  peakTime: 4.32,
  strength: 0.8,
  quality: 0.8,
  metrics: {
    diff: 0.45, histDiff: 0.5, chromaDist: 0.1, lumaDelta: 0, edgeDelta: 0,
    motionMagnitude: 0.06, motionVelocity: 0.5, motionSaturated: false,
    direction: 'right', sampleIntervalSec: 0.33,
  },
  ...overrides,
});

const cluster = (primary: Candidate, secondaries: Candidate[] = []): CandidateCluster => ({
  id: primary.id,
  primary,
  secondaries,
  startTime: primary.time,
  endTime: primary.endTime ?? primary.time,
});

const modelEvent = (overrides: Partial<ModelEvent> = {}): ModelEvent => ({
  eventId: 'c4320',
  observations: {},
  type: 'whip_pan',
  title: 'Whip Pan',
  confidence: 0.9,
  alternatives: [],
  explanations: { short: 'Rapid rightward movement.' },
  effects: [],
  ...overrides,
});

const video = { duration: 30, width: 1080, height: 1920 };
const profile = { cameraMotionShare: 0, translationEvents: 0, zoomEvents: 0, blurEvents: 0, rapidMotionEvents: 0 };
const stats = {
  coarseFrames: 90, mediumFrames: 40, fineFrames: 40,
  candidates: 1, clusters: 1, framesSentToModel: 5, modelCalls: 3,
};

function run(clusters: CandidateCluster[], modelEvents: ModelEvent[], frames: EvidenceFrame[] = []) {
  return normalizeAnalysis({ id: 'analysis-test', clusters, modelEvents, frames, scenes: [], video, profile, stats });
}

describe('normalizeAnalysis', () => {
  it('takes the timestamp from the measurement, never from the model', () => {
    const result = run([cluster(candidate('c4320'))], [modelEvent()]);
    expect(result.events[0]?.startTime).toBe(4.32);
  });

  it('keeps a measured event the model never described', () => {
    // The degradation guarantee: a failed batch must shorten the explanation,
    // not the timeline. Dropping it would silently hide a real scene change.
    const result = run([cluster(candidate('c4320'))], []);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.type).toBe('scene_change');
    expect(result.events[0]?.startTime).toBe(4.32);
    expect(result.events[0]?.whyDetected).toContain('Local measurement');
  });

  it('ignores a model event citing a cluster that does not exist', () => {
    const result = run([cluster(candidate('c4320'))], [modelEvent({ eventId: 'c9999', type: 'zoom_in' })]);
    expect(result.events).toHaveLength(1);
    // Fell back to measurement rather than adopting the stray classification.
    expect(result.events[0]?.type).toBe('scene_change');
  });

  it('overrides a mis-filed category using the canonical type mapping', () => {
    const result = run([cluster(candidate('c1'))], [modelEvent({ eventId: 'c1' })]);
    expect(result.events[0]?.category).toBe('transition');
  });

  it('caps confidence at what the evidence supports', () => {
    const weak = candidate('c1', { quality: 0.1 });
    const result = run([cluster(weak)], [modelEvent({ eventId: 'c1', confidence: 0.99 })]);
    expect(result.events[0]?.confidence).toBeCloseTo(0.55, 2);
  });

  it('lowers confidence when a claim contradicts the measurement', () => {
    // The check that makes a fluent wrong answer cost something.
    const honest = run([cluster(candidate('c1'))], [modelEvent({ eventId: 'c1', observations: { direction: 'rightward' } })]);
    const wrong = run([cluster(candidate('c1'))], [modelEvent({ eventId: 'c1', observations: { direction: 'leftward' } })]);
    expect(wrong.events[0]!.confidence).toBeLessThan(honest.events[0]!.confidence);
    expect(wrong.events[0]?.certainty).not.toBe('detected');
    expect(wrong.events[0]?.claimChecks?.[0]?.verdict).toBe('contradicts');
  });

  it('records measured continuity across the cut', () => {
    const scenes = [
      { id: 's1', index: 1, startTime: 0, endTime: 4.32, duration: 4.32, motionLevel: 0.05, meanLuma: 0.5, sampleCount: 6, dominantDirection: 'right' as const },
      { id: 's2', index: 2, startTime: 4.32, endTime: 9, duration: 4.68, motionLevel: 0.05, meanLuma: 0.5, sampleCount: 6, dominantDirection: 'right' as const },
    ];
    const result = normalizeAnalysis({
      id: 'analysis-test',
      clusters: [cluster(candidate('c1'))],
      modelEvents: [modelEvent({ eventId: 'c1' })],
      frames: [], scenes, video, profile, stats,
    });
    expect(result.events[0]?.continuity?.measured).toBe('direction-matched');
  });

  it('keeps a model continuity claim only where measurement cannot reach', () => {
    // A matched subject is real and unmeasurable at 64x36; a movement claim
    // that disagrees with the vectors is not kept.
    const result = run(
      [cluster(candidate('c1'))],
      [modelEvent({ eventId: 'c1', continuity: { kind: 'subject-matched', note: 'Same person continues.' } })],
    );
    expect(result.events[0]?.continuity?.interpreted).toBe('subject-matched');
  });

  it('separates the three explanation depths', () => {
    const result = run(
      [cluster(candidate('c1'))],
      [modelEvent({ eventId: 'c1', explanations: { short: 'Short.', detailed: 'Detailed account.', technical: 'Do this.' } })],
    );
    expect(result.events[0]?.description).toBe('Short.');
    expect(result.events[0]?.explanations?.detailed).toBe('Detailed account.');
    expect(result.events[0]?.recreationHint).toBe('Do this.');
  });

  it('reports measured phase boundaries', () => {
    const withPeak = candidate('c1', {
      peakTime: 4.34,
      endTime: 4.61,
      metrics: {
        diff: 0.45, histDiff: 0.5, chromaDist: 0.1, lumaDelta: 0, edgeDelta: -0.1,
        motionMagnitude: 0.06, motionVelocity: 0.5, motionSaturated: false,
        peakVelocityTime: 4.3, direction: 'right', sampleIntervalSec: 0.04,
      },
    });
    const timing = run([cluster(withPeak)], [modelEvent({ eventId: 'c1' })]).events[0]?.timing;
    // Where movement peaks and where the shot changes are different facts.
    expect(timing?.peak).toBe(4.3);
    expect(timing?.boundary).toBe(4.34);
  });

  it('bands certainty across three levels', () => {
    const strong = run([cluster(candidate('c1', { quality: 0.9 }))], [modelEvent({ eventId: 'c1', confidence: 0.9 })]);
    expect(strong.events[0]?.certainty).toBe('detected');
    expect(strong.events[0]?.title).toBe('Whip Pan');

    const middling = run([cluster(candidate('c1', { quality: 0.3 }))], [modelEvent({ eventId: 'c1', confidence: 0.5 })]);
    expect(middling.events[0]?.certainty).toBe('likely');
    expect(middling.events[0]?.title).toBe('Likely whip Pan');

    const weak = run([cluster(candidate('c1', { quality: 0.05 }))], [modelEvent({ eventId: 'c1', confidence: 0.2 })]);
    expect(weak.events[0]?.certainty).toBe('possible');
    expect(weak.events[0]?.title).toBe('Possible whip Pan');
  });

  it('takes direction from measurement even when the model has an opinion', () => {
    const noDirection = candidate('c1', {
      metrics: {
        diff: 0.4, histDiff: 0.4, chromaDist: 0.1, lumaDelta: 0, edgeDelta: 0,
        motionMagnitude: 0, motionVelocity: 0, motionSaturated: false, sampleIntervalSec: 0.33,
      },
    });
    const result = run([cluster(noDirection)], [modelEvent({ eventId: 'c1', type: 'camera_pan' })]);
    expect(result.events[0]?.direction).toBeUndefined();
  });

  it('omits evidence fields that were not computed rather than zeroing them', () => {
    const flat = candidate('c1', {
      metrics: {
        diff: 0.4, histDiff: 0.4, chromaDist: 0, lumaDelta: 0, edgeDelta: 0,
        motionMagnitude: 0, motionVelocity: 0, motionSaturated: false, sampleIntervalSec: 0.33,
      },
    });
    const evidence = run([cluster(flat)], [modelEvent({ eventId: 'c1' })]).events[0]?.evidence;
    expect(evidence?.visualChangeScore).toBe(0.4);
    expect(evidence).not.toHaveProperty('motionMagnitude');
    expect(evidence).not.toHaveProperty('detailLoss');
    expect(evidence).not.toHaveProperty('colorChange');
  });

  it('demotes clustered measurements to secondary events', () => {
    // One whip pan measured three ways must produce one timeline marker.
    const primary = candidate('cut', { quality: 0.9 });
    const clustered = cluster(primary, [
      candidate('pan', { kind: 'camera', time: 4.2, quality: 0.5 }),
      candidate('blur', { kind: 'luma', time: 4.4, quality: 0.4 }),
    ]);
    const result = run([clustered], [modelEvent({ eventId: 'cut' })]);

    const primaries = result.events.filter((event) => event.role === 'primary');
    const secondaries = result.events.filter((event) => event.role === 'secondary');
    expect(primaries).toHaveLength(1);
    expect(secondaries).toHaveLength(2);
    expect(primaries[0]?.containsIds).toHaveLength(2);
  });

  it('carries the deep analysis fields through', () => {
    const result = run(
      [cluster(candidate('c1'))],
      [
        modelEvent({
          eventId: 'c1',
          phases: { before: 'Stable.', build: 'Movement builds.', peak: 'Maximum smear.', after: 'Continues.' },
          whyDetected: 'Displacement across five frames.',
          whyItWorks: 'The cut hides where detail is scarcest.',
          transition: { technique: 'Whip', incomingBehavior: 'Continues rightward.' },
        }),
      ],
    );
    const event = result.events[0]!;
    expect(event.observation?.peak).toBe('Maximum smear.');
    expect(event.whyItWorks).toContain('detail is scarcest');
    expect(event.transition?.incomingBehavior).toBe('Continues rightward.');
  });

  it('applies a reconciliation correction to the event type', () => {
    const result = normalizeAnalysis({
      id: 'analysis-test',
      clusters: [cluster(candidate('c1'))],
      modelEvents: [modelEvent({ eventId: 'c1', type: 'scene_change' })],
      frames: [],
      scenes: [],
      video,
      profile,
      reconciliation: {
        summary: 'Reconciled.',
        corrections: [{ eventId: 'c1', newType: 'match_cut', reason: 'One of six identical joins.' }],
        relationships: [],
        motifs: [],
        dnaNotes: {},
      },
      stats,
    });
    expect(result.events[0]?.type).toBe('match_cut');
    expect(result.overview.summary).toBe('Reconciled.');
  });

  it('flags a local-only analysis so the UI can say so', () => {
    const result = normalizeAnalysis({
      id: 'analysis-test',
      clusters: [cluster(candidate('c1'))],
      modelEvents: [],
      frames: [],
      scenes: [],
      video,
      profile,
      localOnly: true,
      stats,
    });
    expect(result.localOnly).toBe(true);
    expect(result.overview.summary).toContain('Local analysis only');
  });

  it('sorts events by time with the primary ahead of its parts', () => {
    const result = run(
      [cluster(candidate('c1', { time: 9 })), cluster(candidate('c2', { time: 2 }))],
      [modelEvent({ eventId: 'c1', title: 'A' }), modelEvent({ eventId: 'c2', title: 'B' })],
    );
    expect(result.events.map((event) => event.startTime)).toEqual([2, 9]);
  });
});
