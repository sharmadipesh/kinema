import { describe, expect, it } from 'vitest';
import { deriveReadiness, readinessSummary } from './readiness.ts';
import type { MotionAnalysis, MotionEvent, Scene } from '../types/motion.ts';

const event = (): MotionEvent => ({
  id: 'e1', startTime: 1, category: 'cut', type: 'hard_cut', title: 'Hard Cut',
  description: '', confidence: 0.9, certainty: 'detected', role: 'primary',
});

const scene = (index: number): Scene => ({
  id: `s${index}`, index, startTime: index, endTime: index + 1, duration: 1,
  motionLevel: 0.02, meanLuma: 0.5, sampleCount: 4,
});

const analysis = (overrides: Partial<MotionAnalysis> = {}): MotionAnalysis => ({
  id: 'analysis-test',
  video: { duration: 20, width: 1080, height: 1920 },
  overview: { summary: '', pacing: 'fast', sceneChanges: 2, transitions: 1, textAnimations: 0, cameraMovements: 1, effects: 0 },
  editingDNA: {} as MotionAnalysis['editingDNA'],
  events: [event()],
  scenes: [scene(1), scene(2)],
  motionProfile: { cameraMotionShare: 0, translationEvents: 0, zoomEvents: 0, blurEvents: 0, rapidMotionEvents: 0 },
  version: '2.0',
  stats: { coarseFrames: 0, mediumFrames: 0, fineFrames: 0, candidates: 0, clusters: 0, framesSentToModel: 0, modelCalls: 0 },
  ...overrides,
});

describe('deriveReadiness', () => {
  it('never ticks a row whose data does not exist', () => {
    // The failure this guards against: a reassuring tick next to "Camera plan"
    // when no camera plan was produced.
    const items = deriveReadiness(analysis());
    const camera = items.find((item) => item.label === 'Camera plan');
    expect(camera?.ready).toBe(false);
    expect(camera?.detail).toBe('Not produced');
  });

  it('ticks the rows the analysis genuinely produced', () => {
    const items = deriveReadiness(analysis());
    expect(items.find((item) => item.label === 'Motion analysis')?.ready).toBe(true);
    expect(items.find((item) => item.label === 'Shot structure')?.ready).toBe(true);
  });

  it('does not call a single shot a shot structure', () => {
    const items = deriveReadiness(analysis({ scenes: [scene(1)] }));
    expect(items.find((item) => item.label === 'Shot structure')?.ready).toBe(false);
  });

  it('points an incomplete row at the section that would hold it', () => {
    const items = deriveReadiness(analysis());
    expect(items.find((item) => item.label === 'Equipment')?.tab).toBe('create');
  });

  it('counts a fully populated blueprint', () => {
    const full = analysis({
      blueprint: {
        creativeDirection: ['a'], movementLanguage: [], composition: [],
        equipment: [{ name: 'Gimbal', category: 'stabilization', priority: 'recommended', why: 'x' }],
        shootingDirection: [], shotList: [{ index: 1, shot: 'x', durationTarget: '2s', use: 'open' }],
        camera: { priority: 'high', capabilities: ['4K'], why: 'x', suitableTypes: [], tiers: [], frameRates: [], settingsNotes: [] },
        lighting: { character: ['soft'], setup: ['key'], caveat: 'x' },
        editorToolkit: {
          editMap: [], cutMap: [{ time: 1, type: 'hard_cut', label: 'Hard Cut' }], pacing: [],
          transitionRecipes: [], footageChecklist: [], workflow: [], typographyNotes: [],
          coloristNotes: [], soundOpportunities: [], priorities: [], mistakes: [],
        },
        storyStages: [
          { id: 's1', index: 1, name: 'Hook', startTime: 0, endTime: 5, energy: 0.4, shotCount: 2, averageShot: 2, dominantEventTypes: [] },
          { id: 's2', index: 2, name: 'Resolve', startTime: 5, endTime: 20, energy: 0.2, shotCount: 2, averageShot: 7, dominantEventTypes: [] },
        ],
        moodboardKeywords: [], referencesToCollect: [], topThree: [], avoid: [], unavailable: [],
      },
    });
    const summary = readinessSummary(deriveReadiness(full));
    expect(summary.ready).toBe(summary.total);
  });
});
