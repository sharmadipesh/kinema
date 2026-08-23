import { describe, expect, it } from 'vitest';
import { checkConsistency } from './consistency.ts';
import { analysis, blueprint, bothFrames, stage, stageFrame, twoStages } from '../test/fixtures.ts';

const findingIds = (input: Parameters<typeof checkConsistency>[0]): string[] =>
  checkConsistency(input).map((finding) => finding.id);

describe('checkConsistency', () => {
  it('finds nothing wrong with an analysis the pipeline produced', () => {
    // The healthy case has to be silent, or every readiness verdict inherits a
    // permanent warning and the check stops meaning anything.
    expect(findingIds({ analysis: analysis(), frames: bothFrames() })).toEqual([]);
  });

  it('says nothing at all when there is no story board to check', () => {
    expect(findingIds({ analysis: analysis({ blueprint: blueprint({ storyStages: [] }) }), frames: [] })).toEqual([]);
  });

  it('catches a gap in the middle of the board', () => {
    // The failure mode: a stage set that skips 10–14s while the edit map calls
    // that range a beat. A board with holes cannot rebuild the edit.
    const stages = [
      stage({ id: 'stage-1', startTime: 0, endTime: 10 }),
      stage({ id: 'stage-2', index: 2, startTime: 14, endTime: 20 }),
    ];
    expect(findingIds({ analysis: analysis({ blueprint: blueprint({ storyStages: stages }) }), frames: [] })).toContain(
      'stage-gap',
    );
  });

  it('catches overlapping stages', () => {
    const stages = [
      stage({ id: 'stage-1', startTime: 0, endTime: 12 }),
      stage({ id: 'stage-2', index: 2, startTime: 10, endTime: 20 }),
    ];
    expect(findingIds({ analysis: analysis({ blueprint: blueprint({ storyStages: stages }) }), frames: [] })).toContain(
      'stage-overlap',
    );
  });

  it('catches a stage with no duration', () => {
    const stages = [stage({ id: 'stage-1', startTime: 5, endTime: 5 })];
    expect(findingIds({ analysis: analysis({ blueprint: blueprint({ storyStages: stages }) }), frames: [] })).toContain(
      'stage-range-invalid',
    );
  });

  it('catches duplicate stage identifiers', () => {
    const stages = [stage({ id: 'dup', startTime: 0, endTime: 10 }), stage({ id: 'dup', index: 2, startTime: 10, endTime: 20 })];
    expect(findingIds({ analysis: analysis({ blueprint: blueprint({ storyStages: stages }) }), frames: [] })).toContain(
      'stage-ids-duplicated',
    );
  });

  it('catches a frame borrowed from a different analysis', () => {
    // Invisible on screen — a frame from another video renders perfectly well.
    const stages = [
      stage({ id: 'stage-1', startTime: 0, endTime: 10, referenceFrameId: 'analysis-OTHER:stage-0' }),
      stage({ id: 'stage-2', index: 2, startTime: 10, endTime: 20 }),
    ];
    expect(findingIds({ analysis: analysis({ blueprint: blueprint({ storyStages: stages }) }), frames: [] })).toContain(
      'frame-foreign',
    );
  });

  it('separates an evicted frame from a foreign one', () => {
    const ids = findingIds({ analysis: analysis(), frames: [] });
    expect(ids).toContain('frame-missing');
    expect(ids).not.toContain('frame-foreign');
  });

  it('catches Story and Edit describing a different number of beats', () => {
    const withExtraRow = blueprint({
      storyStages: twoStages(),
      editorToolkit: {
        ...blueprint().editorToolkit,
        editMap: [
          { startTime: 0, endTime: 10, label: 'Hook', note: '' },
          { startTime: 10, endTime: 15, label: 'Peak', note: '' },
          { startTime: 15, endTime: 20, label: 'Resolve', note: '' },
        ],
      },
    });
    expect(findingIds({ analysis: analysis({ blueprint: withExtraRow }), frames: bothFrames() })).toContain(
      'canonical-stage-count',
    );
  });

  it('catches Story and Edit disagreeing on a boundary', () => {
    const shifted = blueprint({
      editorToolkit: {
        ...blueprint().editorToolkit,
        editMap: [
          { startTime: 0, endTime: 10, label: 'Hook', note: '' },
          { startTime: 13, endTime: 20, label: 'Resolve', note: '' },
        ],
      },
    });
    expect(findingIds({ analysis: analysis({ blueprint: shifted }), frames: bothFrames() })).toContain(
      'canonical-stage-times',
    );
  });

  it('catches a cut marked past the end of the video', () => {
    const bad = blueprint({
      editorToolkit: { ...blueprint().editorToolkit, cutMap: [{ time: 99, type: 'hard_cut', label: 'Hard Cut' }] },
    });
    expect(findingIds({ analysis: analysis({ blueprint: bad }), frames: bothFrames() })).toContain(
      'cut-outside-duration',
    );
  });

  it('warns rather than errors when the board simply starts late', () => {
    const stages = [stage({ id: 'stage-1', startTime: 3, endTime: 20, referenceFrameId: 'analysis-1:stage-0' })];
    const found = checkConsistency({
      analysis: analysis({
        blueprint: blueprint({
          storyStages: stages,
          editorToolkit: { ...blueprint().editorToolkit, editMap: [{ startTime: 3, endTime: 20, label: 'Hook', note: '' }] },
        }),
      }),
      frames: [stageFrame(0, 4)],
    });
    const head = found.find((finding) => finding.id === 'stage-head-gap');
    expect(head?.severity).toBe('warning');
  });
});
