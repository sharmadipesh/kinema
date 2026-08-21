import { describe, expect, it } from 'vitest';
import { normalizeAnalysis } from './normalizer.ts';
import type { Candidate, EvidenceFrame } from '../types/analysis.ts';
import type { ModelAnalysis } from '../services/validate-motion.ts';

const candidate = (id: string, overrides: Partial<Candidate> = {}): Candidate => ({
  id,
  kind: 'boundary',
  time: 4.32,
  strength: 0.8,
  metrics: { diff: 0.45, histDiff: 0.5, lumaDelta: 0, motionMagnitude: 0.06, direction: 'right', sampleIntervalSec: 0.33 },
  ...overrides,
});

const model = (events: ModelAnalysis['events']): ModelAnalysis => ({ summary: 'Fast cutting.', events });

const video = { duration: 30, width: 1080, height: 1920 };
const stats = { coarseFrames: 90, fineFrames: 40, candidates: 1, framesSentToModel: 3 };

function run(candidates: Candidate[], analysis: ModelAnalysis, frames: EvidenceFrame[] = []) {
  return normalizeAnalysis({ model: analysis, candidates, frames, video, stats });
}

describe('normalizeAnalysis', () => {
  it('takes the timestamp from the measurement, never from the model', () => {
    const result = run(
      [candidate('c4320')],
      model([{ candidateId: 'c4320', type: 'whip_pan', title: 'Whip Pan', description: 'x', confidence: 0.9, effects: [] }]),
    );
    expect(result.events[0]?.startTime).toBe(4.32);
  });

  it('drops an event citing a candidate that does not exist', () => {
    // The alternative would be placing it at a guessed time, which is the one
    // thing the product must never do.
    const result = run(
      [candidate('c4320')],
      model([
        { candidateId: 'c4320', type: 'hard_cut', title: 'Hard Cut', description: 'x', confidence: 0.8, effects: [] },
        { candidateId: 'c9999', type: 'zoom_in', title: 'Zoom In', description: 'y', confidence: 0.9, effects: [] },
      ]),
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.type).toBe('hard_cut');
  });

  it('overrides a mis-filed category using the canonical type mapping', () => {
    const result = run(
      [candidate('c1')],
      model([{ candidateId: 'c1', type: 'whip_pan', title: 'Whip Pan', description: 'x', confidence: 0.8, effects: [] }]),
    );
    expect(result.events[0]?.category).toBe('transition');
  });

  it('caps confidence at what the evidence supports', () => {
    const weak = candidate('c1', { strength: 0.1 });
    const result = run(
      [weak],
      model([{ candidateId: 'c1', type: 'whip_pan', title: 'Whip Pan', description: 'x', confidence: 0.99, effects: [] }]),
    );
    // ceiling = 0.5 + 0.5 * 0.1
    expect(result.events[0]?.confidence).toBeCloseTo(0.55, 2);
  });

  it('marks weakly supported events as inferred and prefixes the title', () => {
    const result = run(
      [candidate('c1', { strength: 0.2 })],
      model([{ candidateId: 'c1', type: 'whip_pan', title: 'Whip Pan Transition', description: 'x', confidence: 0.5, effects: [] }]),
    );
    expect(result.events[0]?.certainty).toBe('likely');
    expect(result.events[0]?.title).toBe('Likely whip Pan Transition');
  });

  it('leaves a strongly supported event unprefixed', () => {
    const result = run(
      [candidate('c1', { strength: 0.9 })],
      model([{ candidateId: 'c1', type: 'hard_cut', title: 'Hard Cut', description: 'x', confidence: 0.9, effects: [] }]),
    );
    expect(result.events[0]?.certainty).toBe('detected');
    expect(result.events[0]?.title).toBe('Hard Cut');
  });

  it('takes direction only from measurement', () => {
    const withoutDirection = candidate('c1', {
      metrics: { diff: 0.4, histDiff: 0.4, lumaDelta: 0, motionMagnitude: 0, sampleIntervalSec: 0.33 },
    });
    const result = run(
      [withoutDirection],
      model([{ candidateId: 'c1', type: 'camera_pan', title: 'Pan', description: 'moves left to right', confidence: 0.8, effects: [] }]),
    );
    expect(result.events[0]?.direction).toBeUndefined();
  });

  it('omits evidence fields that were not computed rather than zeroing them', () => {
    const flat = candidate('c1', {
      metrics: { diff: 0.4, histDiff: 0.4, lumaDelta: 0, motionMagnitude: 0, sampleIntervalSec: 0.33 },
    });
    const evidence = run(
      [flat],
      model([{ candidateId: 'c1', type: 'hard_cut', title: 'Hard Cut', description: 'x', confidence: 0.8, effects: [] }]),
    ).events[0]?.evidence;

    expect(evidence?.visualChangeScore).toBe(0.4);
    expect(evidence).not.toHaveProperty('motionMagnitude');
    expect(evidence).not.toHaveProperty('luminanceChange');
  });

  it('attaches evidence frame ids by role', () => {
    const frames: EvidenceFrame[] = [
      { id: 'a:c1-before', candidateId: 'c1', role: 'before', time: 4.0, dataUrl: 'data:,' },
      { id: 'a:c1-during', candidateId: 'c1', role: 'during', time: 4.32, dataUrl: 'data:,' },
    ];
    const evidence = run(
      [candidate('c1')],
      model([{ candidateId: 'c1', type: 'hard_cut', title: 'Hard Cut', description: 'x', confidence: 0.8, effects: [] }]),
      frames,
    ).events[0]?.evidence;

    expect(evidence?.beforeFrameId).toBe('a:c1-before');
    expect(evidence?.duringFrameId).toBe('a:c1-during');
    expect(evidence?.afterFrameId).toBeUndefined();
  });

  it('allows two distinct events on one moment but not three', () => {
    const result = run(
      [candidate('c1')],
      model([
        { candidateId: 'c1', type: 'hard_cut', title: 'Hard Cut', description: 'x', confidence: 0.8, effects: [] },
        { candidateId: 'c1', type: 'text_appears', title: 'Text Appears', description: 'y', confidence: 0.7, effects: [] },
        { candidateId: 'c1', type: 'flash', title: 'Flash', description: 'z', confidence: 0.6, effects: [] },
      ]),
    );
    expect(result.events).toHaveLength(2);
  });

  it('sorts events by time', () => {
    const result = run(
      [candidate('c1', { time: 9 }), candidate('c2', { time: 2 })],
      model([
        { candidateId: 'c1', type: 'hard_cut', title: 'A', description: 'x', confidence: 0.8, effects: [] },
        { candidateId: 'c2', type: 'hard_cut', title: 'B', description: 'y', confidence: 0.8, effects: [] },
      ]),
    );
    expect(result.events.map((event) => event.startTime)).toEqual([2, 9]);
  });
});
