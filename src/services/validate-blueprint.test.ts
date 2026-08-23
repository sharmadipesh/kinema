import { describe, expect, it } from 'vitest';
import { validateBlueprint } from './validate-blueprint.ts';
import type { PaletteSwatch, StoryStage } from '../types/motion.ts';

/**
 * The blueprint validator had no tests at all, while its sibling for motion
 * events had twenty-eight. It is the layer that decides what a creator is told
 * to go and buy, so the cases below are the ones where being wrong costs money
 * or trust: unjustified gear, invented stages, and silently missing sections.
 */

const stage = (id: string, index: number): StoryStage => ({
  id,
  index,
  name: 'Hook',
  startTime: 0,
  endTime: 5,
  energy: 0.4,
  shotCount: 2,
  averageShot: 2.5,
  dominantEventTypes: [],
  referenceFrameId: `analysis-1:stage-${index - 1}`,
});

const palette: PaletteSwatch[] = [{ hex: '#101014', weight: 0.5, role: 'primary' }];

const context = {
  stages: [stage('stage-1', 1), stage('stage-2', 2)],
  palette,
  derivedToolkit: {
    editMap: [{ startTime: 0, endTime: 5, label: 'Hook', note: '2 shots.' }],
    cutMap: [{ time: 2.4, type: 'hard_cut' as const, label: 'Hard Cut' }],
    pacing: [],
    footageChecklist: ['A tracking pass'],
    soundOpportunities: [],
  },
};

/** Enough to clear the "blueprint was empty" gate. */
const viable = { creativeDirection: ['Cut on movement.'], topThree: ['Match the direction.'] };

describe('validateBlueprint', () => {
  it('rejects a response that is not an object', () => {
    expect(validateBlueprint(null, context).ok).toBe(false);
    expect(validateBlueprint('nope', context).ok).toBe(false);
  });

  it('rejects a blueprint with nothing usable in it', () => {
    const result = validateBlueprint({ creativeDirection: [], equipment: [] }, context);

    expect(result).toMatchObject({ ok: false });
  });

  it('drops equipment with no stated reason', () => {
    // "Tripod — recommended" with an empty `why` is exactly the useless advice
    // this feature exists to replace.
    const result = validateBlueprint(
      {
        ...viable,
        equipment: [
          { name: 'Tripod', category: 'grip', priority: 'recommended', why: '' },
          { name: 'Gimbal', category: 'stabilization', priority: 'required', why: 'The whole edit is moving.' },
        ],
      },
      context,
    );

    expect(result.ok && result.value.equipment.map((item) => item.name)).toEqual(['Gimbal']);
  });

  it('records why equipment vanished instead of leaving the section blank', () => {
    const result = validateBlueprint(
      { ...viable, equipment: [{ name: 'Tripod', category: 'grip', priority: 'recommended', why: '' }] },
      context,
    );

    expect(result.ok && result.value.unavailable.map((entry) => entry.section)).toContain('Equipment');
  });

  it('records a camera plan dropped for having no reason', () => {
    const result = validateBlueprint(
      { ...viable, camera: { capabilities: ['4K 60p'], why: '' } },
      context,
    );

    expect(result.ok && result.value.camera).toBeUndefined();
    expect(result.ok && result.value.unavailable.map((entry) => entry.section)).toContain('Camera');
  });

  it('does not invent a gap for a section the model never attempted', () => {
    // Saying nothing about lighting is a legitimate answer for a video with
    // nothing to say about lighting.
    const result = validateBlueprint(viable, context);

    expect(result.ok && result.value.unavailable).toEqual([]);
  });

  it('keeps the model\'s own explanation rather than overwriting it', () => {
    const result = validateBlueprint(
      {
        ...viable,
        camera: { capabilities: [], why: '' },
        unavailable: [{ section: 'Camera', reason: 'The frames never showed a full shot.' }],
      },
      context,
    );

    const camera = result.ok ? result.value.unavailable.filter((entry) => entry.section === 'Camera') : [];
    expect(camera).toHaveLength(1);
    expect(camera[0]?.reason).toBe('The frames never showed a full shot.');
  });

  it('discards story stages the model invented', () => {
    // An invented stage has no measured timespan and no place on the timeline.
    const result = validateBlueprint(
      {
        ...viable,
        storyStages: [
          { id: 'stage-1', purpose: 'Stop the scroll.' },
          { id: 'stage-99', purpose: 'A beat that was never measured.' },
        ],
      },
      context,
    );

    const ids = result.ok ? result.value.storyStages.map((entry) => entry.id) : [];
    expect(ids).toEqual(['stage-1', 'stage-2']);
  });

  it('keeps the measured half of a stage when it merges model prose', () => {
    const result = validateBlueprint(
      { ...viable, storyStages: [{ id: 'stage-1', purpose: 'Stop the scroll.' }] },
      context,
    );

    const merged = result.ok ? result.value.storyStages[0] : undefined;
    expect(merged?.purpose).toBe('Stop the scroll.');
    // The frame reference and timings are measured and must survive the merge,
    // or the Story board loses the frame it captured for this stage.
    expect(merged?.referenceFrameId).toBe('analysis-1:stage-0');
    expect(merged?.endTime).toBe(5);
  });

  it('never lets model content overwrite the measured toolkit', () => {
    const result = validateBlueprint(
      { ...viable, editor: { cutMap: [{ time: 99, type: 'hard_cut', label: 'Invented' }] } },
      context,
    );

    expect(result.ok && result.value.editorToolkit.cutMap).toEqual(context.derivedToolkit.cutMap);
  });

  it('treats filler strings as absent', () => {
    const result = validateBlueprint({ ...viable, shootingDirection: ['N/A', 'none', 'Keep the camera moving.'] }, context);

    expect(result.ok && result.value.shootingDirection).toEqual(['Keep the camera moving.']);
  });
});
