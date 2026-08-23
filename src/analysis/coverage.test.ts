import { describe, expect, it } from 'vitest';
import { attachCoverage, deriveCoverage } from './coverage.ts';
import type { MotionAnalysis } from '../types/motion.ts';
import type { Candidate, EvidenceFrame } from '../types/analysis.ts';
import type { MotionEvent, Scene } from '../types/motion.ts';

const scene = (index: number): Scene => ({
  id: `s${index}`, index, startTime: index, endTime: index + 1, duration: 1,
  motionLevel: 0.02, meanLuma: 0.5, sampleCount: 5,
});

const candidate = (direction?: 'right'): Candidate => ({
  id: `c${Math.random()}`, kind: 'boundary', time: 1, strength: 0.8, quality: 0.8,
  metrics: {
    diff: 0.4, histDiff: 0.4, chromaDist: 0.1, lumaDelta: 0, edgeDelta: 0,
    motionMagnitude: 0.04, motionVelocity: 0.4, motionSaturated: false,
    ...(direction ? { direction } : {}), sampleIntervalSec: 0.04,
  },
});

const frame = (): EvidenceFrame => ({
  id: 'a:c1-0', candidateId: 'c1', role: 'peak', order: 0, time: 1, dataUrl: 'data:,',
});

const textEvent = (): MotionEvent => ({
  id: 'e1', startTime: 1, category: 'text', type: 'text_appears', title: 'Text',
  description: '', confidence: 0.8, certainty: 'detected', role: 'primary',
});

const base = {
  scenes: [scene(1), scene(2), scene(3)],
  candidates: [candidate('right'), candidate('right')],
  events: [textEvent()],
  frames: [frame()],
  localOnly: false,
  interpretedClusters: 4,
  totalClusters: 4,
  frameAccessRestricted: false,
};

describe('deriveCoverage', () => {
  it('reports complete coverage for a fully analysed video', () => {
    const coverage = deriveCoverage(base);
    expect(coverage.scenes).toBe('complete');
    expect(coverage.transitions).toBe('complete');
    expect(coverage.cameraMotion).toBe('complete');
    expect(coverage.frameAccess).toBe('complete');
  });

  it('never invents a single accuracy number', () => {
    // Per-area status is checkable against the run's own statistics; an overall
    // accuracy figure would require knowing the right answer.
    expect(Object.keys(deriveCoverage(base))).toEqual([
      'scenes', 'transitions', 'cameraMotion', 'typography', 'frameAccess', 'notes',
    ]);
  });

  it('says transitions are partial when interpretation never ran', () => {
    const coverage = deriveCoverage({ ...base, localOnly: true, interpretedClusters: 0 });
    expect(coverage.transitions).toBe('partial');
    expect(coverage.typography).toBe('unavailable');
    expect(coverage.notes.join(' ')).toContain('Interpretation was unavailable');
  });

  it('names how many moments went uninterpreted', () => {
    const coverage = deriveCoverage({ ...base, interpretedClusters: 2, totalClusters: 10 });
    expect(coverage.transitions).toBe('partial');
    expect(coverage.notes.join(' ')).toContain('8 of 10');
  });

  it('reports one continuous take rather than claiming full scene coverage', () => {
    const coverage = deriveCoverage({ ...base, scenes: [scene(1)] });
    expect(coverage.scenes).toBe('partial');
    expect(coverage.notes.join(' ')).toContain('one continuous take');
  });

  it('reports typography as partial rather than complete when none was found', () => {
    // Absence is ambiguous: no text, or text the sampler never landed on.
    // Claiming full coverage of something never looked for would be wrong.
    const coverage = deriveCoverage({ ...base, events: [] });
    expect(coverage.typography).toBe('partial');
    expect(coverage.notes.join(' ')).toContain('between sampled frames');
  });

  it('flags unreadable frames', () => {
    const coverage = deriveCoverage({ ...base, frames: [], frameAccessRestricted: true });
    expect(coverage.frameAccess).toBe('unavailable');
  });

  it('flags footage with no resolvable movement direction', () => {
    const coverage = deriveCoverage({ ...base, candidates: [candidate(), candidate()] });
    expect(coverage.cameraMotion).toBe('partial');
    expect(coverage.notes.join(' ')).toContain('largely static');
  });
});

/**
 * The seam the module tests could not see.
 *
 * `deriveCoverage` was always correct in isolation — these tests passed — while
 * both call sites handed it `events: []`, because coverage was computed as an
 * *input* to normalisation and the events do not exist until normalisation has
 * run. The typography branch was therefore dead: it reported "partial" and
 * printed "No typography was detected" over videos full of it. `attachCoverage`
 * takes the finished analysis, so there is no longer anywhere to pass the wrong
 * events from.
 */
describe('attachCoverage', () => {
  const analysis = (events: MotionAnalysis['events']): MotionAnalysis =>
    ({
      id: 'analysis-1',
      video: { duration: 20, width: 1080, height: 1920 },
      overview: {} as MotionAnalysis['overview'],
      editingDNA: {} as MotionAnalysis['editingDNA'],
      events,
      scenes: base.scenes,
      motionProfile: {} as MotionAnalysis['motionProfile'],
      version: '2.1',
      stats: {} as MotionAnalysis['stats'],
    }) as MotionAnalysis;

  const extras = {
    candidates: base.candidates,
    frames: base.frames,
    localOnly: false,
    interpretedClusters: 4,
    totalClusters: 4,
    frameAccessRestricted: false,
  };

  it('reads typography from the analysis it is attached to', () => {
    const result = attachCoverage(analysis([textEvent()]), extras);

    expect(result.coverage?.typography).toBe('high');
    expect(result.coverage?.notes.join(' ')).not.toContain('No typography was detected');
  });

  it('still reports partial typography when the analysis really has none', () => {
    const result = attachCoverage(analysis([]), extras);

    expect(result.coverage?.typography).toBe('partial');
    expect(result.coverage?.notes.join(' ')).toContain('No typography was detected');
  });

  it('takes scenes from the analysis rather than a separately passed copy', () => {
    // Two sources for the same fact is how they drift. There is now one.
    const result = attachCoverage(analysis([textEvent()]), extras);

    expect(result.coverage?.scenes).toBe('complete');
  });
});
