import type { EvidenceFrame } from '../types/analysis.ts';
import type { CameraPlan, MotionAnalysis, MotionEvent, ProductionBlueprint, Scene, StoryStage } from '../types/motion.ts';
import { emptyProject, type ProjectRecord } from '../types/project.ts';

/**
 * Shared fixtures.
 *
 * The readiness engine reads across the whole analysis — events, scenes,
 * stages, toolkit, coverage, frames — so building one by hand in every test
 * would be most of each test file, and the interesting difference between two
 * cases would be buried in eighty lines of scaffolding.
 */

export const scene = (index: number): Scene => ({
  id: `s${index}`,
  index,
  startTime: index * 2,
  endTime: index * 2 + 2,
  duration: 2,
  motionLevel: 0.03,
  meanLuma: 0.5,
  sampleCount: 6,
});

export const event = (overrides: Partial<MotionEvent> = {}): MotionEvent => ({
  id: 'e1',
  startTime: 2.4,
  category: 'cut',
  type: 'hard_cut',
  title: 'Hard Cut',
  description: '',
  confidence: 0.9,
  certainty: 'detected',
  role: 'primary',
  ...overrides,
});

export const stage = (overrides: Partial<StoryStage> = {}): StoryStage => ({
  id: 'stage-1',
  index: 1,
  name: 'Hook',
  startTime: 0,
  endTime: 10,
  energy: 0.5,
  shotCount: 3,
  averageShot: 3.3,
  dominantEventTypes: ['hard_cut'],
  referenceTime: 4,
  ...overrides,
});

/** Two contiguous stages covering a 20s video — the healthy default. */
export const twoStages = (): StoryStage[] => [
  stage({ id: 'stage-1', index: 1, name: 'Hook', startTime: 0, endTime: 10, referenceTime: 4, referenceFrameId: 'analysis-1:stage-0' }),
  stage({ id: 'stage-2', index: 2, name: 'Resolve', startTime: 10, endTime: 20, referenceTime: 14, referenceFrameId: 'analysis-1:stage-1' }),
];

export const stageFrame = (index: number, time: number, analysisId = 'analysis-1'): EvidenceFrame => ({
  id: `${analysisId}:stage-${index}`,
  candidateId: `stage-${index + 1}`,
  role: 'stage',
  order: index,
  time,
  dataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
});

export const camera = (overrides: Partial<CameraPlan> = {}): CameraPlan => ({
  priority: 'high',
  capabilities: ['4K 60p'],
  why: 'The edit ramps speed, so the sensor has to over-crank.',
  suitableTypes: ['Mirrorless'],
  tiers: [{ tier: 'creator', setup: ['A7 IV'], bestFor: 'Solo shooter' }],
  frameRates: [{ rate: '60p', use: 'Speed ramps' }],
  settingsNotes: [],
  ...overrides,
});

export const blueprint = (overrides: Partial<ProductionBlueprint> = {}): ProductionBlueprint =>
  ({
    creativeDirection: ['Cut on movement.'],
    movementLanguage: [],
    composition: [],
    camera: camera(),
    equipment: [{ name: 'Gimbal', category: 'stabilization', priority: 'required', why: 'Every move is travelling.' }],
    lighting: { character: ['Hard key'], setup: ['One 60cm softbox camera left'] },
    shootingDirection: [],
    shotList: [{ index: 1, shot: 'Low-angle tracking', durationTarget: '2s', use: 'Hook' }],
    editorToolkit: {
      editMap: [
        { startTime: 0, endTime: 10, label: 'Hook', note: '3 shots.' },
        { startTime: 10, endTime: 20, label: 'Resolve', note: '2 shots.' },
      ],
      cutMap: [{ time: 2.4, type: 'hard_cut', label: 'Hard Cut' }],
      pacing: [],
      transitionRecipes: [{ name: 'Whip pan', sourceFootage: ['Fast pan out'], cutPoint: 'At peak blur', editRequirement: 'Match direction' }],
      footageChecklist: ['A tracking pass alongside the subject'],
      workflow: ['Assemble on the beat'],
      typographyNotes: [],
      coloristNotes: [],
      soundOpportunities: [],
      priorities: [],
      mistakes: [],
    },
    storyStages: twoStages(),
    moodboardKeywords: [],
    referencesToCollect: [],
    topThree: [],
    avoid: [],
    unavailable: [],
    ...overrides,
  }) as ProductionBlueprint;

export const analysis = (overrides: Partial<MotionAnalysis> = {}): MotionAnalysis =>
  ({
    id: 'analysis-1',
    video: { duration: 20, width: 1080, height: 1920 },
    overview: { summary: '', pacing: 'fast', sceneChanges: 2, transitions: 1, textAnimations: 0, cameraMovements: 1, effects: 0 },
    editingDNA: {} as MotionAnalysis['editingDNA'],
    events: [event()],
    scenes: [scene(0), scene(1), scene(2)],
    motionProfile: { cameraMotionShare: 0.3, translationEvents: 1, zoomEvents: 0, blurEvents: 0, rapidMotionEvents: 0 },
    coverage: { scenes: 'complete', transitions: 'complete', cameraMotion: 'complete', typography: 'high', frameAccess: 'complete', notes: [] },
    blueprint: blueprint(),
    version: '2.1',
    stats: { coarseFrames: 60, mediumFrames: 80, fineFrames: 100, candidates: 4, clusters: 3, framesSentToModel: 20, modelCalls: 4 },
    ...overrides,
  }) as MotionAnalysis;

export const project = (overrides: Partial<ProjectRecord> = {}): ProjectRecord => ({
  ...emptyProject('analysis-1'),
  ...overrides,
});

/** Both stage frames present — the case where nothing is missing. */
export const bothFrames = (): EvidenceFrame[] => [stageFrame(0, 4), stageFrame(1, 14)];
