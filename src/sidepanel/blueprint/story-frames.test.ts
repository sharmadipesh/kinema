import { describe, expect, it } from 'vitest';
import { NEARBY_TOLERANCE_SEC, resolveStageFrame, stageFrameNotice } from './story-frames.ts';
import type { EvidenceFrame } from '../../types/analysis.ts';
import type { StoryStage } from '../../types/motion.ts';

const frame = (id: string, time: number, role: EvidenceFrame['role'] = 'peak'): EvidenceFrame => ({
  id,
  candidateId: 'c1',
  role,
  order: 0,
  time,
  dataUrl: 'data:,',
});

const stage = (overrides: Partial<StoryStage> = {}): StoryStage => ({
  id: 'stage-1',
  index: 1,
  name: 'Hook',
  startTime: 20,
  endTime: 28,
  energy: 0.4,
  shotCount: 2,
  averageShot: 4,
  dominantEventTypes: [],
  referenceTime: 21,
  ...overrides,
});

describe('resolveStageFrame', () => {
  it('uses the frame captured for the stage when it is present', () => {
    const own = frame('a:stage-0', 21, 'stage');
    const result = resolveStageFrame(stage({ referenceFrameId: 'a:stage-0' }), [frame('a:c1-0', 4), own]);

    expect(result).toEqual({ kind: 'exact', frame: own });
  });

  it('refuses a distant event frame rather than passing it off as the stage', () => {
    // The defect this module exists for: a stage at 00:21 was rendering an
    // event frame from 00:04 — a different shot — with no caveat at all.
    const result = resolveStageFrame(stage(), [frame('a:c1-0', 4)]);

    expect(result.kind).toBe('none');
  });

  it('accepts a near frame and reports how far off it is', () => {
    const result = resolveStageFrame(stage(), [frame('a:c1-0', 21.6)]);

    expect(result).toMatchObject({ kind: 'nearby', offsetSec: 0.6 });
  });

  it('treats exactly the tolerance as acceptable', () => {
    const result = resolveStageFrame(stage(), [frame('a:c1-0', 21 + NEARBY_TOLERANCE_SEC)]);

    expect(result.kind).toBe('nearby');
  });

  it('distinguishes an evicted frame from one that never existed', () => {
    // Different facts and different sentences: one says the store dropped it,
    // the other says the pipeline never captured it.
    expect(resolveStageFrame(stage({ referenceFrameId: 'a:stage-0' }), []).kind).toBe('evicted');
    expect(resolveStageFrame(stage(), []).kind).toBe('none');
  });

  it('falls back to a near frame when the intended one was evicted', () => {
    const result = resolveStageFrame(stage({ referenceFrameId: 'gone' }), [frame('a:c1-0', 21.2)]);

    expect(result.kind).toBe('nearby');
  });

  it('falls back to startTime when a stage never got a reference time', () => {
    const result = resolveStageFrame(stage({ referenceTime: undefined }), [frame('a:c1-0', 20.3)]);

    expect(result.kind).toBe('nearby');
  });
});

describe('stageFrameNotice', () => {
  it('says nothing when the frame is the intended one', () => {
    expect(stageFrameNotice({ kind: 'exact', frame: frame('a', 1) })).toBeNull();
  });

  it('names the substitution and its distance', () => {
    expect(stageFrameNotice({ kind: 'nearby', frame: frame('a', 1), offsetSec: 0.6 })).toContain('0.6s');
  });

  it('gives every empty state a reason', () => {
    expect(stageFrameNotice({ kind: 'evicted' })).toMatch(/no longer stored/i);
    expect(stageFrameNotice({ kind: 'none' })).toMatch(/no frame captured/i);
  });
});
