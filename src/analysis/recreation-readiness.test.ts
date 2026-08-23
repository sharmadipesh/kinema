import { describe, expect, it } from 'vitest';
import { deriveRecreationReadiness } from './recreation-readiness.ts';
import { analysis, blueprint, bothFrames, camera, project, stage, stageFrame } from '../test/fixtures.ts';
import type { RecreationMode } from '../types/project.ts';

const run = (mode: RecreationMode | undefined, overrides: Parameters<typeof project>[0] = {}, extra: Partial<Parameters<typeof deriveRecreationReadiness>[0]> = {}) =>
  deriveRecreationReadiness({
    analysis: analysis(),
    frames: bothFrames(),
    project: project({ ...(mode ? { mode } : {}), ...overrides }),
    canSeek: true,
    ...extra,
  });

const find = (result: ReturnType<typeof run>, id: string) => result.items.find((entry) => entry.id === id);

describe('mode', () => {
  it('refuses to grade anything before a mode is chosen', () => {
    // Grading against an assumed mode reports a readiness that is not the
    // user's. The engine says what it needs instead.
    const result = run(undefined);

    expect(result.summary.verdict).toBe('needs_decisions');
    expect(result.summary.nextAction?.target).toBe('brief#mode');
  });

  it('weighs the same analysis differently per mode', () => {
    const noLighting = { analysis: analysis({ blueprint: blueprint({ lighting: undefined }) }) };

    // Irrelevant to someone studying an edit, required for someone shooting it.
    expect(find(run('study', {}, noLighting), 'production.lighting')?.state).toBe('optional');
    expect(find(run('shoot', {}, noLighting), 'production.lighting')?.state).toBe('unavailable');
  });

  it('drops rows the mode has no use for entirely', () => {
    // A cutdown does not need a camera body recommendation.
    expect(find(run('cutdown'), 'production.camera')).toBeUndefined();
    expect(find(run('shoot'), 'production.camera')).toBeDefined();
  });
});

describe('blockers', () => {
  it('cannot be hidden by a pile of satisfied rows', () => {
    // The exact failure the old counter had: nine green rows reported 9/9 over
    // an analysis nobody could act on.
    const broken = analysis({
      blueprint: blueprint({
        storyStages: [stage({ id: 'stage-1', startTime: 0, endTime: 8 }), stage({ id: 'stage-2', index: 2, startTime: 14, endTime: 20 })],
      }),
    });
    const result = deriveRecreationReadiness({ analysis: broken, frames: bothFrames(), project: project({ mode: 'shoot' }), canSeek: true });

    expect(result.summary.verdict).toBe('blocked');
    expect(result.summary.blockers.length).toBeGreaterThan(0);
  });

  it('puts a broken board ahead of a missing gear suggestion', () => {
    const broken = analysis({
      blueprint: blueprint({
        equipment: [],
        storyStages: [stage({ id: 'stage-1', startTime: 0, endTime: 8 }), stage({ id: 'stage-2', index: 2, startTime: 14, endTime: 20 })],
      }),
    });
    const result = deriveRecreationReadiness({ analysis: broken, frames: bothFrames(), project: project({ mode: 'shoot' }), canSeek: true });

    expect(result.summary.nextAction?.target).toBe('story#stages');
  });

  it('never lets an optional row hold back a verdict', () => {
    // Study mode marks creative direction optional; its absence must not count.
    const result = deriveRecreationReadiness({
      analysis: analysis({ blueprint: blueprint({ creativeDirection: [] }) }),
      frames: bothFrames(),
      project: project({ mode: 'study' }),
      canSeek: true,
    });

    expect(find(result, 'production.creative')?.state).toBe('optional');
    expect(result.summary.verdict).not.toBe('blocked');
  });
});

describe('frames', () => {
  it('cannot report full readiness when a stage has no usable frame', () => {
    const result = deriveRecreationReadiness({
      analysis: analysis(),
      frames: [stageFrame(0, 4)], // second stage has nothing
      project: project({ mode: 'shoot' }),
      canSeek: true,
    });

    expect(find(result, 'story.frames')?.state).toBe('needs_input');
    expect(result.summary.verdict).toBe('needs_decisions');
  });

  it('is satisfied when every stage has its own frame', () => {
    expect(find(run('shoot'), 'story.frames')?.state).toBe('ready');
  });
});

describe('source', () => {
  it('lets a history result be plan-ready while saying seeking is unavailable', () => {
    const result = deriveRecreationReadiness({
      analysis: analysis(),
      frames: bothFrames(),
      project: project({ mode: 'study' }),
      canSeek: false,
    });

    expect(find(result, 'analysis.source')?.state).toBe('warning');
    expect(result.summary.verdict).not.toBe('blocked');
  });
});

describe('audio', () => {
  it('is a footnote when studying', () => {
    expect(find(run('study'), 'audio.status')?.state).toBe('optional');
  });

  it('is a required decision when cutting to music', () => {
    expect(find(run('edit'), 'audio.status')?.state).toBe('needs_input');
  });

  it('stops asking once the user has said where audio stands', () => {
    expect(find(run('edit', { brief: { audio: 'music-selected' } }), 'audio.status')?.state).toBe('warning');
  });
});

describe('camera', () => {
  it('is not satisfied by an object with no stated reason', () => {
    // The old check was `Boolean(blueprint.camera)`, which ticked for exactly
    // the spec-sheet advice the validator already refuses to render.
    const thin = analysis({ blueprint: blueprint({ camera: camera({ capabilities: [], why: '' }) }) });
    const result = deriveRecreationReadiness({ analysis: thin, frames: bothFrames(), project: project({ mode: 'shoot' }), canSeek: true });

    expect(find(result, 'production.camera')?.state).toBe('unavailable');
  });

  it('warns when there are capabilities but no tier to choose between', () => {
    const noTiers = analysis({ blueprint: blueprint({ camera: camera({ tiers: [] }) }) });
    const result = deriveRecreationReadiness({ analysis: noTiers, frames: bothFrames(), project: project({ mode: 'shoot' }), canSeek: true });

    expect(find(result, 'production.camera')?.state).toBe('warning');
  });
});

describe('manual confirmation', () => {
  it('marks user-answerable rows as not automatically evaluated', () => {
    const tier = find(run('shoot'), 'production.tier');
    expect(tier?.automaticallyEvaluated).toBe(false);
  });

  it('keeps measured rows marked as automatic', () => {
    expect(find(run('shoot'), 'analysis.events')?.automaticallyEvaluated).toBe(true);
  });

  it('reflects a confirmation the user has given', () => {
    expect(find(run('shoot', { confirmations: { location: true } }), 'confirm.location')?.state).toBe('ready');
    expect(find(run('shoot'), 'confirm.location')?.state).toBe('needs_input');
  });
});

describe('unavailable blueprint sections', () => {
  it('carries the stated reason into the readiness row', () => {
    const withGap = analysis({
      blueprint: blueprint({
        lighting: undefined,
        unavailable: [{ section: 'Lighting', reason: 'The blueprint pass could not be completed.' }],
      }),
    });
    const result = deriveRecreationReadiness({ analysis: withGap, frames: bothFrames(), project: project({ mode: 'shoot' }), canSeek: true });

    expect(find(result, 'production.lighting')?.reason).toBe('The blueprint pass could not be completed.');
  });
});

describe('verdicts', () => {
  it('reaches a mode-specific ready verdict when nothing is outstanding', () => {
    const settled = { brief: { tier: 'creator' as const, audio: 'reference-only' as const }, confirmations: { location: true, talent: true, equipment: true }, stageEdits: { 'stage-1': { approved: true }, 'stage-2': { approved: true } }, footage: { 'A tracking pass alongside the subject': 'available' as const } };
    expect(run('shoot', settled).summary.verdict).toBe('ready_to_shoot');
  });

  it('reports every decision it is waiting on', () => {
    const result = run('shoot');
    expect(result.summary.decisions.length).toBeGreaterThan(0);
    expect(result.summary.verdict).toBe('needs_decisions');
  });
});
