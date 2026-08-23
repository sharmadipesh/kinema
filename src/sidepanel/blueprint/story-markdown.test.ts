import { describe, expect, it } from 'vitest';
import { boardToMarkdown, stageToMarkdown } from './story-markdown.ts';
import type { MotionAnalysis, StoryStage } from '../../types/motion.ts';

const stage = (overrides: Partial<StoryStage> = {}): StoryStage => ({
  id: 'stage-1',
  index: 1,
  name: 'Hook',
  startTime: 0,
  endTime: 6.05,
  energy: 0.45,
  shotCount: 3,
  averageShot: 2.02,
  dominantEventTypes: ['hard_cut'],
  referenceTime: 4.12,
  ...overrides,
});

const analysis = (overrides: Partial<MotionAnalysis> = {}): MotionAnalysis =>
  ({
    id: 'analysis-1',
    video: { duration: 28.4, width: 1080, height: 1920 },
    overview: {} as MotionAnalysis['overview'],
    editingDNA: {} as MotionAnalysis['editingDNA'],
    events: [],
    scenes: [],
    motionProfile: {} as MotionAnalysis['motionProfile'],
    version: '2.1',
    stats: {} as MotionAnalysis['stats'],
    ...overrides,
  }) as MotionAnalysis;

describe('stageToMarkdown', () => {
  it('always carries the measured structure', () => {
    const out = stageToMarkdown(stage());

    expect(out).toContain('00:00 – 00:06');
    expect(out).toContain('**Shots**: 3 (avg 2.02s)');
    expect(out).toContain('**Energy**: 45%');
  });

  it('marks interpreted direction as read from frames, not measured', () => {
    // The evidence contract has to survive the export — a pasted board that
    // mixes the two travels further than the UI that made the distinction.
    const out = stageToMarkdown(stage({ purpose: 'Stop the scroll.', camera: 'Push in.' }));

    expect(out).toContain('read from sampled frames');
    expect(out).toContain('**Purpose**: Stop the scroll.');
  });

  it('omits the interpretation block entirely when there is none', () => {
    const out = stageToMarkdown(stage());

    expect(out).not.toContain('read from sampled frames');
  });
});

describe('boardToMarkdown', () => {
  it('states that timings are measured', () => {
    const out = boardToMarkdown(analysis({ blueprint: { storyStages: [stage()] } as MotionAnalysis['blueprint'] }), 'Reel');

    expect(out).toContain('# Story board — Reel');
    expect(out).toContain('measured from the video');
  });

  it('carries unavailable sections into the export rather than dropping them', () => {
    // A board pasted into a brief with silent holes reads as complete.
    const out = boardToMarkdown(
      analysis({
        blueprint: {
          storyStages: [stage()],
          unavailable: [{ section: 'Lighting', reason: 'The blueprint pass could not be completed.' }],
        } as MotionAnalysis['blueprint'],
      }),
      'Reel',
    );

    expect(out).toContain('## Not produced');
    expect(out).toContain('**Lighting** — The blueprint pass could not be completed.');
  });

  it('flags a local-only analysis in the document', () => {
    const out = boardToMarkdown(
      analysis({ localOnly: true, blueprint: { storyStages: [stage()] } as MotionAnalysis['blueprint'] }),
      'Reel',
    );

    expect(out).toContain('Interpretation was unavailable');
  });
});
