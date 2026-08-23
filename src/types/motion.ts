/**
 * The motion analysis contract.
 *
 * The single most important rule in this file: **measured facts and model
 * interpretation are different things and never share a field.**
 *
 *   - `startTime`, `endTime`, and everything under `MotionEvidence` come from
 *     local frame analysis. The model never supplies a timestamp.
 *   - `title`, `description`, `type`, `effects` and `confidence` are the
 *     model's reading of the evidence it was shown.
 *
 * That split is what lets the product say *why* it thinks something is a whip
 * pan, and what stops it inventing a precision it does not have.
 */

// -- Taxonomy ----------------------------------------------------------------

export const MOTION_CATEGORIES = [
  'cut',
  'transition',
  'camera',
  'motion',
  'subject',
  'text',
  'effect',
  'color',
  'speed',
  'other',
] as const;
export type MotionCategory = (typeof MOTION_CATEGORIES)[number];

export const MOTION_EVENT_TYPES = [
  'scene_change',
  'hard_cut',
  'jump_cut',
  'match_cut',
  'cut_on_motion',
  'smash_cut',
  'masked_transition',
  'object_wipe',
  'crossfade',
  'fade',
  'fade_in',
  'fade_out',
  'whip_pan',
  'zoom',
  'zoom_in',
  'zoom_out',
  'push_in',
  'pull_out',
  'camera_pan',
  'camera_tilt',
  'camera_rotation',
  'tracking',
  'handheld',
  'camera_shake',
  'motion_blur',
  'flash',
  'light_leak',
  'speed_ramp',
  'slow_motion',
  'fast_motion',
  'freeze_frame',
  'text_appears',
  'text_disappears',
  'text_animation',
  'kinetic_typography',
  'object_movement',
  'subject_movement',
  'subject_enters',
  'subject_exits',
  'background_change',
  'color_change',
  'exposure_shift',
  'glitch',
  'effect',
  'other',
] as const;
export type MotionEventType = (typeof MOTION_EVENT_TYPES)[number];

/**
 * Canonical type → category mapping.
 *
 * The model is asked for a category too, but this table wins during
 * normalization: a `whip_pan` filed under `text` is a model slip, and the
 * filters must not inherit it. Extending the taxonomy means adding one row.
 */
export const CATEGORY_OF_TYPE: Record<MotionEventType, MotionCategory> = {
  scene_change: 'cut',
  hard_cut: 'cut',
  jump_cut: 'cut',
  match_cut: 'cut',
  cut_on_motion: 'cut',
  smash_cut: 'cut',
  masked_transition: 'transition',
  object_wipe: 'transition',
  crossfade: 'transition',
  fade: 'transition',
  whip_pan: 'transition',
  fade_in: 'transition',
  fade_out: 'transition',
  zoom: 'camera',
  zoom_in: 'camera',
  zoom_out: 'camera',
  camera_pan: 'camera',
  camera_tilt: 'camera',
  camera_rotation: 'camera',
  push_in: 'camera',
  pull_out: 'camera',
  tracking: 'camera',
  handheld: 'camera',
  camera_shake: 'camera',
  motion_blur: 'effect',
  flash: 'effect',
  light_leak: 'effect',
  speed_ramp: 'speed',
  slow_motion: 'speed',
  fast_motion: 'speed',
  freeze_frame: 'speed',
  text_appears: 'text',
  text_disappears: 'text',
  text_animation: 'text',
  kinetic_typography: 'text',
  object_movement: 'motion',
  subject_movement: 'subject',
  subject_enters: 'subject',
  subject_exits: 'subject',
  background_change: 'motion',
  color_change: 'color',
  exposure_shift: 'color',
  glitch: 'effect',
  effect: 'effect',
  other: 'other',
};

export const EVENT_TYPE_LABELS: Record<MotionEventType, string> = {
  scene_change: 'Scene Change',
  hard_cut: 'Hard Cut',
  jump_cut: 'Jump Cut',
  match_cut: 'Match Cut',
  cut_on_motion: 'Cut on Motion',
  smash_cut: 'Smash Cut',
  masked_transition: 'Masked Transition',
  object_wipe: 'Object Wipe',
  crossfade: 'Crossfade',
  fade: 'Fade',
  whip_pan: 'Whip Pan',
  fade_in: 'Fade In',
  fade_out: 'Fade Out',
  zoom: 'Zoom',
  zoom_in: 'Zoom In',
  zoom_out: 'Zoom Out',
  camera_pan: 'Camera Pan',
  camera_tilt: 'Camera Tilt',
  camera_rotation: 'Camera Rotation',
  push_in: 'Push In',
  pull_out: 'Pull Out',
  tracking: 'Tracking Shot',
  handheld: 'Handheld Movement',
  camera_shake: 'Camera Shake',
  motion_blur: 'Motion Blur',
  flash: 'Flash',
  light_leak: 'Light Leak',
  speed_ramp: 'Speed Ramp',
  slow_motion: 'Slow Motion',
  fast_motion: 'Fast Motion',
  freeze_frame: 'Freeze Frame',
  text_appears: 'Text Appears',
  text_disappears: 'Text Disappears',
  text_animation: 'Text Animation',
  kinetic_typography: 'Kinetic Typography',
  object_movement: 'Object Movement',
  subject_movement: 'Subject Movement',
  subject_enters: 'Subject Enters',
  subject_exits: 'Subject Exits',
  background_change: 'Background Change',
  color_change: 'Colour Change',
  exposure_shift: 'Exposure Shift',
  glitch: 'Glitch',
  effect: 'Effect',
  other: 'Event',
};

export const CATEGORY_LABELS: Record<MotionCategory, string> = {
  cut: 'Cuts',
  transition: 'Transitions',
  camera: 'Camera',
  motion: 'Motion',
  subject: 'Subject',
  text: 'Text',
  effect: 'Effects',
  color: 'Colour',
  speed: 'Speed',
  other: 'Other',
};

/** Compass direction derived from measured block motion. */
export type MotionDirection =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'up-left'
  | 'up-right'
  | 'down-left'
  | 'down-right'
  | 'inward'
  | 'outward';

export const DIRECTION_LABELS: Record<MotionDirection, string> = {
  left: 'Right → Left',
  right: 'Left → Right',
  up: 'Down → Up',
  down: 'Up → Down',
  'up-left': 'Down-right → Up-left',
  'up-right': 'Down-left → Up-right',
  'down-left': 'Up-right → Down-left',
  'down-right': 'Up-left → Down-right',
  inward: 'Inward (zoom out)',
  outward: 'Outward (zoom in)',
};

// -- Evidence ----------------------------------------------------------------

/**
 * Measured signals only. Every field is optional because every field is omitted
 * when it was not actually computed — a zero here would be a lie the UI would
 * happily render as a fact.
 */
export interface MotionEvidence {
  /** 0–1. Mean absolute luma difference against the preceding sampled frame. */
  visualChangeScore?: number;
  /** 0–1. Chi-square distance between 32-bin luma histograms. */
  histogramDistance?: number;
  /** 0–1, normalised against the analysis frame width. */
  motionMagnitude?: number;
  dominantDirection?: MotionDirection;
  /** Signed, −1 → 1. Positive means the frame got brighter. */
  luminanceChange?: number;
  /** Coarse RGB histogram distance. Sees grade shifts luma is blind to. */
  colorChange?: number;
  /** How much fine detail was lost, 0–1. The direct evidence of smear. */
  detailLoss?: number;
  /** Peak displacement per second across the fine window. */
  peakVelocity?: number;
  /** Whether movement carried across the change rather than stopping at it. */
  motionContinues?: boolean;
  /**
   * The fine-pass velocity curve around this moment.
   *
   * Already measured and previously discarded at the normalizer. Kept so a
   * motion graph can be drawn from real samples rather than a shape invented to
   * look like one.
   */
  motionCurve?: Array<{ time: number; velocity: number }>;
  /** Sampling interval that produced these numbers, in seconds. */
  sampleIntervalSec?: number;
  /** Every evidence frame for this event, earliest first. Drives the filmstrip. */
  frameIds?: string[];
}

// -- Events ------------------------------------------------------------------

/**
 * How much weight to put on a classification.
 *
 * Three levels rather than two, because "the measurements alone prove this",
 * "the frames support this reading" and "this is the best available guess" are
 * genuinely different claims and collapsing the last two flatters the weakest
 * events. The UI prefixes the lower two so a scan never mistakes one for the
 * first.
 */
export type Certainty = 'detected' | 'likely' | 'possible';

export const CERTAINTY_PREFIX: Record<Certainty, string> = {
  detected: '',
  likely: 'Likely',
  possible: 'Possible',
};

/** Model-written prose describing one phase of an event. */
export interface EventObservation {
  before?: string;
  build?: string;
  peak?: string;
  after?: string;
}

/**
 * What the model *saw*, kept apart from what it concluded.
 *
 * This split is the spine of the analysis. "Horizontal displacement increases
 * and detail smears" is an observation that can be checked against the pixel
 * measurements; "this is a whip pan" is an inference that cannot. Collapsing
 * them — which the earlier schema did — makes a classification look like
 * evidence for itself, and leaves nothing to validate against.
 */
export interface EventObservations {
  horizontalMotion?: 'none' | 'slight' | 'moderate' | 'strong';
  verticalMotion?: 'none' | 'slight' | 'moderate' | 'strong';
  direction?: string;
  scaleProgression?: 'none' | 'growing' | 'shrinking';
  blurProgression?: 'none' | 'increasing' | 'decreasing' | 'sustained';
  luminanceProgression?: 'none' | 'brightening' | 'darkening' | 'spike';
  sceneIdentityChanges?: boolean;
  incomingMotion?: 'none' | 'continues' | 'reverses' | 'different';
  compositionChange?: string;
  textPresent?: boolean;
}

/**
 * A classification the model considered but did not choose.
 *
 * Kept because a confident answer with a close runner-up is a different thing
 * from a confident answer with none, and confidence should say so. Never shown
 * as-is in the product — it feeds the margin term in `composeConfidence` and
 * the development inspector.
 */
export interface EventHypothesis {
  type: MotionEventType;
  confidence: number;
  reasoning: string;
}

/**
 * How the incoming shot relates to the outgoing one.
 *
 * Many professional transitions are not a named effect at all — they are a
 * straight cut that works because something carries across it. Reporting only
 * "hard cut" for those describes the mechanism and misses the technique.
 *
 * `measured` comes from comparing the two shots' motion vectors; `interpreted`
 * is the model's reading, which can see things measurement cannot (a matched
 * subject, a matched composition) and is marked accordingly.
 */
export const CONTINUITY_KINDS = [
  'direction-matched',
  'direction-reversed',
  'motion-interrupted',
  'motion-introduced',
  'scale-matched',
  'shape-matched',
  'subject-matched',
  'composition-matched',
  'none',
] as const;
export type ContinuityKind = (typeof CONTINUITY_KINDS)[number];

export const CONTINUITY_LABELS: Record<ContinuityKind, string> = {
  'direction-matched': 'Movement continues in the same direction',
  'direction-reversed': 'Movement reverses across the cut',
  'motion-interrupted': 'Movement stops at the cut',
  'motion-introduced': 'Movement begins at the cut',
  'scale-matched': 'Scale movement continues through the cut',
  'shape-matched': 'A shape carries across the cut',
  'subject-matched': 'The subject carries across the cut',
  'composition-matched': 'The framing carries across the cut',
  none: 'No clear relationship between the shots',
};

export interface EventContinuity {
  /** Derived from the two shots' measured motion. Absent when unmeasurable. */
  measured?: ContinuityKind;
  /** The model's reading. May name relationships measurement cannot see. */
  interpreted?: ContinuityKind;
  note?: string;
}

/**
 * Explanations at three depths, stored separately.
 *
 * One string cannot serve a timeline card, a forensic breakdown and a
 * recreation brief — compressing to fit the card loses the analysis, and
 * expanding to fill the detail view makes the card unscannable.
 */
export interface EventExplanations {
  /** One line for the card. */
  short: string;
  /** The forensic account, for the detail view. */
  detailed?: string;
  /** Imperative, for Recreate. */
  technical?: string;
}

/**
 * Measured phase boundaries. Missing phases stay missing.
 *
 * `boundary` is distinct from `peak`: where the *shot changes* is a different
 * measurement from where *movement is strongest*, and the gap between them is
 * exactly what makes a whip pan a whip pan rather than a fast pan next to a cut.
 */
export interface EventTiming {
  start: number;
  build?: number;
  peak?: number;
  boundary?: number;
  settle?: number;
  end?: number;
}

/**
 * How each confidence figure was arrived at. Development builds only.
 *
 * Confidence that cannot be taken apart is a number the team cannot improve,
 * and the components are far more useful than the product of them when tuning.
 */
export interface ConfidenceBreakdown {
  modelConfidence: number;
  evidenceQuality: number;
  claimAgreement: number;
  hypothesisMargin: number;
  evidenceCeiling: number;
  final: number;
}

/** A model claim checked against a local measurement. */
export interface ClaimCheck {
  field: string;
  claimed: string;
  measured: string;
  verdict: 'agrees' | 'contradicts' | 'unmeasurable';
}

export interface EventMotion {
  direction?: MotionDirection;
  /** Descriptive band, because the underlying number is not frame-accurate. */
  magnitude?: 'slight' | 'moderate' | 'strong' | 'extreme';
  speed?: 'slow' | 'steady' | 'rapid' | 'very rapid';
  acceleration?: 'building' | 'steady' | 'settling';
  scaleChange?: 'closer' | 'farther';
}

export interface EventTransition {
  technique?: string;
  outgoingBehavior?: string;
  transitionMoment?: string;
  incomingBehavior?: string;
}

export interface EventTypography {
  textDetected: boolean;
  content?: string;
  animationType?: string;
  entrance?: string;
  exit?: string;
  direction?: string;
}

export interface EventCamera {
  movement?: string;
  intensity?: 'subtle' | 'moderate' | 'strong';
  /** Whether an optical, digital or physical move could be distinguished. */
  ambiguity?: string;
}

export interface MotionEvent {
  id: string;
  /** Seconds. Measured, never model-supplied. */
  startTime: number;
  /** Where the change was strongest. Measured by the fine pass. */
  peakTime?: number;
  /** Present only when the underlying candidate actually spanned a range. */
  endTime?: number;
  category: MotionCategory;
  type: MotionEventType;
  title: string;
  /** One line, for the card. */
  description: string;
  /** 0–1. */
  confidence: number;
  certainty: Certainty;
  /** Primary events reach the timeline; secondary ones live inside the detail. */
  role: 'primary' | 'secondary';
  /** Ids of the secondary events this one contains. */
  containsIds?: string[];
  /** Other primary events this one relates to, e.g. a repeated motif. */
  relatedEventIds?: string[];
  /** Measured phase boundaries. */
  timing?: EventTiming;
  /** What the model saw, kept apart from what it concluded. */
  observations?: EventObservations;
  /** How the incoming shot relates to the outgoing one. */
  continuity?: EventContinuity;
  /** Short / detailed / technical, stored separately. */
  explanations?: EventExplanations;
  /** Claims checked against measurement. Drives confidence and the inspector. */
  claimChecks?: ClaimCheck[];
  /** Development builds only. Stripped from production bundles by `DEBUG`. */
  diagnostics?: {
    candidateKind: string;
    candidateStrength: number;
    candidateQuality: number;
    hypotheses: EventHypothesis[];
    confidence: ConfidenceBreakdown;
    sampleTimes: number[];
    mergedFrom: string[];
  };
  direction?: MotionDirection;
  effects?: string[];
  evidence?: MotionEvidence;

  // -- Deep analysis. Every field optional: an absent one means the evidence
  //    did not support it, which is information the UI renders as silence.
  observation?: EventObservation;
  motion?: EventMotion;
  camera?: EventCamera;
  transition?: EventTransition;
  typography?: EventTypography;
  /** Why the local measurements pointed here. Written from the numbers. */
  whyDetected?: string;
  /** Why the technique works on a viewer. The teaching sentence. */
  whyItWorks?: string;
  /** One-line bridge into the Recreate flow. */
  recreationHint?: string;
}

/** One shot. Derived locally from boundary candidates; see `analysis/scenes.ts`. */
export interface Scene {
  id: string;
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  /** Mean normalised motion magnitude across the shot. */
  motionLevel: number;
  meanLuma: number;
  dominantDirection?: MotionDirection;
  /** How many sampled frames fell inside. Low counts mean a coarse reading. */
  sampleCount: number;
  entryCandidateId?: string;
  exitCandidateId?: string;
  /** Model-supplied, and only where it was worth asking. */
  summary?: string;
  camera?: string;
  subject?: string;
  text?: string;
}

export interface EditRhythm {
  shotCount: number;
  averageShot: number;
  medianShot: number;
  shortestShot: number;
  longestShot: number;
  cutsPerMinute: number;
  density: 'low' | 'moderate' | 'high' | 'very high';
  fastestSectionStart?: number;
  fastestSectionEnd?: number;
}

export interface MotionProfile {
  dominantDirection?: MotionDirection;
  dominantDirectionCount?: number;
  /** Fraction of shots containing measurable movement, 0–1. */
  cameraMotionShare: number;
  translationEvents: number;
  zoomEvents: number;
  blurEvents: number;
  /** Movements that hit the estimator's ceiling — genuinely fast. */
  rapidMotionEvents: number;
}

// -- Analysis ----------------------------------------------------------------

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  /**
   * Only present when it was measured from decoded frames. Container metadata
   * is not exposed to the browser, so an unmeasurable video simply has no fps.
   */
  fps?: number;
}

export interface VideoOverview {
  /** Editing and motion language. Never a description of the subject matter. */
  summary: string;
  pacing: 'slow' | 'moderate' | 'fast' | 'very fast';
  sceneChanges: number;
  transitions: number;
  textAnimations: number;
  cameraMovements: number;
  effects: number;
}

export const DNA_TRAITS = ['pacing', 'cuts', 'motion', 'text', 'transitions', 'effects'] as const;
export type DnaTrait = (typeof DNA_TRAITS)[number];

/**
 * Each 0–1, derived from the scene and event lists by `analysis/editing-dna.ts`.
 *
 * `why` is the sentence that turns a bar into a claim someone can check. A bar
 * on its own asks to be trusted; a bar that says "11 shots across 18 seconds"
 * can be argued with, which is the more useful property.
 */
export type EditingDNA = Record<DnaTrait, { value: number; label: string; why: string }>;

// -- Story, energy and the production blueprint -------------------------------

export interface EnergyPoint {
  startTime: number;
  endTime: number;
  /** 0–1, normalised against this video's own maxima. */
  value: number;
  cuts: number;
}

export interface StoryStage {
  id: string;
  index: number;
  /** Derived from position and energy, not from a fixed template. */
  name: string;
  startTime: number;
  endTime: number;
  energy: number;
  shotCount: number;
  averageShot: number;
  dominantEventTypes: string[];
  /** A frame worth showing for this stage. */
  referenceTime?: number;
  /**
   * The evidence frame actually captured for this stage, in the frame store.
   *
   * Without it the Story board could only guess, and its guess was the nearest
   * event frame at any distance — which routinely showed a different shot as
   * though it represented this stage.
   */
  referenceFrameId?: string;
  /** Model-written, and only where the frames supported it. */
  purpose?: string;
  mood?: string;
  composition?: string;
  camera?: string;
  lighting?: string;
  color?: string;
  movement?: string;
  typography?: string;
  keywords?: string[];
  shotSuggestion?: string;
}

/** A colour measured from the sampled frames, not asked for. */
export interface PaletteSwatch {
  hex: string;
  /** Share of sampled pixels, 0–1. */
  weight: number;
  role: 'primary' | 'secondary' | 'accent' | 'neutral';
}

export type GearPriority = 'required' | 'recommended' | 'optional';

export interface GearItem {
  name: string;
  category:
    | 'camera' | 'lens' | 'stabilization' | 'lighting' | 'grip'
    | 'audio' | 'monitoring' | 'power' | 'storage' | 'specialty';
  priority: GearPriority;
  /** Why it is useful, and which part of the reference demands it. */
  why: string;
  /** Cheaper ways to achieve the same thing. */
  alternatives?: string[];
}

export interface CameraPlan {
  priority: 'high' | 'moderate' | 'low';
  capabilities: string[];
  why: string;
  suitableTypes: string[];
  tiers: Array<{ tier: 'lean' | 'creator' | 'professional'; setup: string[]; bestFor: string }>;
  frameRates: Array<{ rate: string; use: string }>;
  settingsNotes: string[];
}

export interface LensPlan {
  character: string;
  ranges: Array<{ range: string; use: string }>;
  caveat: string;
}

export interface StabilizationPlan {
  items: Array<{ tool: string; priority: GearPriority; why: string }>;
}

export interface LightingPlan {
  character: string[];
  setup: string[];
  caveat: string;
}

export interface ColorPlan {
  direction: string[];
  guidance: string[];
  palette: PaletteSwatch[];
}

export interface EditorToolkit {
  editMap: Array<{ startTime: number; endTime: number; label: string; note: string }>;
  cutMap: Array<{ time: number; type: string; label: string }>;
  pacing: Array<{ section: string; description: string }>;
  transitionRecipes: Array<{
    name: string;
    sourceFootage: string[];
    cutPoint: string;
    editRequirement: string;
    post?: string;
  }>;
  footageChecklist: string[];
  workflow: string[];
  typographyNotes: string[];
  coloristNotes: string[];
  /** Suggested only — no audio was analysed. */
  soundOpportunities: Array<{ time: number; event: string; suggestion: string }>;
  priorities: string[];
  mistakes: string[];
}

/**
 * How much effort recreating this actually takes.
 *
 * Four axes rather than one number, because "advanced" hides which part is
 * hard — a piece can be trivial to light and brutal to shoot, and a creator
 * deciding whether to attempt it needs to know which.
 */
export interface ProductionComplexity {
  crew: 'low' | 'moderate' | 'high';
  lighting: 'low' | 'moderate' | 'high';
  cameraMovement: 'low' | 'moderate' | 'high';
  post: 'low' | 'moderate' | 'high';
  note?: string;
}

/**
 * Which roles this analysis is worth reading as.
 *
 * A filter over emphasis, not a set of separate screens: the same analysis
 * matters differently to a cinematographer and an editor, and building two
 * screens for it would mean maintaining two truths.
 */
export const ANALYSIS_ROLES = ['all', 'director', 'cinematographer', 'editor', 'motion-designer', 'colorist'] as const;
export type AnalysisRole = (typeof ANALYSIS_ROLES)[number];

export const ROLE_LABELS: Record<AnalysisRole, string> = {
  all: 'All',
  director: 'Director',
  cinematographer: 'Cinematographer',
  editor: 'Editor',
  'motion-designer': 'Motion designer',
  colorist: 'Colourist',
};

/** One row of the readiness check. Complete only when the data is really there. */
export interface ReadinessItem {
  label: string;
  ready: boolean;
  detail: string;
  /** Which section to jump to when it is missing. */
  tab?: 'overview' | 'story' | 'create' | 'edit';
}

export interface ProductionBlueprint {
  creativeIntent?: { labels: string[]; why: string };
  creativeDirection: string[];
  movementLanguage: string[];
  composition: string[];
  camera?: CameraPlan;
  lenses?: LensPlan;
  stabilization?: StabilizationPlan;
  equipment: GearItem[];
  lighting?: LightingPlan;
  color?: ColorPlan;
  shootingDirection: string[];
  shotList: Array<{ index: number; shot: string; direction?: string; durationTarget: string; use: string }>;
  editorToolkit: EditorToolkit;
  storyStages: StoryStage[];
  moodboardKeywords: string[];
  referencesToCollect: string[];
  topThree: string[];
  avoid: string[];
  difficulty?: { level: 'easy' | 'moderate' | 'advanced'; why: string };
  complexity?: ProductionComplexity;
  /** Named reasons a section is absent, so an empty panel never reads as broken. */
  unavailable: Array<{ section: string; reason: string }>;
}

export interface MotionAnalysis {
  /**
   * Identity of this analysis, and the key its frames are stored under.
   *
   * Previously absent, and recovered by string-splitting an event's first frame
   * id — which failed outright for an analysis that captured no frames, and
   * left stage frames with nothing to belong to. History entries written before
   * this field existed are repaired on read from the entry id, which has always
   * been the same value.
   */
  id: string;
  video: VideoMetadata;
  overview: VideoOverview;
  editingDNA: EditingDNA;
  events: MotionEvent[];
  scenes: Scene[];
  rhythm?: EditRhythm;
  motionProfile: MotionProfile;
  /** Plain-language rhythm note, derived from the numbers above. */
  rhythmNote?: string;
  /**
   * True when the model could not be reached and this analysis is local
   * measurement only. The UI says so rather than presenting thin results as
   * though they were the finished product.
   */
  localOnly?: boolean;
  version: string;
  coverage?: AnalysisCoverage;
  energy?: EnergyPoint[];
  blueprint?: ProductionBlueprint;
  /** How much of the video was looked at, and how hard. */
  stats: {
    coarseFrames: number;
    mediumFrames: number;
    fineFrames: number;
    candidates: number;
    clusters: number;
    framesSentToModel: number;
    modelCalls: number;
  };
}

// -- Session -----------------------------------------------------------------

export const ANALYSIS_STATUSES = [
  'idle',
  'preparing',
  'reading_video',
  'coarse_sampling',
  'medium_sampling',
  'detecting_scenes',
  'fine_sampling',
  'building_scenes',
  'capturing_evidence',
  'global_pass',
  'ai_analysis',
  'reconciling',
  'normalizing',
  'building_timeline',
  'blueprint',
  'completed',
  'cancelled',
  'failed',
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/** Stages shown in the progress UI, in order. Terminal states are not stages. */
export const PROGRESS_STAGES = [
  'reading_video',
  'coarse_sampling',
  'medium_sampling',
  'detecting_scenes',
  'fine_sampling',
  'building_scenes',
  'capturing_evidence',
  'global_pass',
  'ai_analysis',
  'reconciling',
  'building_timeline',
  'blueprint',
] as const satisfies readonly AnalysisStatus[];

export const STAGE_LABELS: Record<(typeof PROGRESS_STAGES)[number], string> = {
  reading_video: 'Reading video',
  coarse_sampling: 'Scanning for activity',
  medium_sampling: 'Sampling active regions',
  detecting_scenes: 'Detecting visual changes',
  fine_sampling: 'Measuring each moment',
  building_scenes: 'Segmenting shots',
  capturing_evidence: 'Capturing frame sequences',
  global_pass: 'Reading the edit',
  ai_analysis: 'Interpreting motion',
  reconciling: 'Reconciling events',
  building_timeline: 'Building timeline',
  blueprint: 'Writing the blueprint',
};

/**
 * The schema version of an analysis.
 *
 * Stored on every result and every artifact set. Detection thresholds and the
 * event model will keep changing; without a version, a History entry from an
 * older algorithm is indistinguishable from a current one, and a resumed run
 * could splice artifacts from two different pipelines into one result.
 */
export const ANALYSIS_VERSION = '2.1';

export interface AnalysisSession {
  id: string;
  /** Page video id, or the upload id. Retained through every later message. */
  videoId: string;
  sourceKind: 'page' | 'upload';
  label: string;
  startedAt: number;
  status: AnalysisStatus;
  /** Free-form detail for the current stage, e.g. "18 / 60 frames". */
  detail?: string;
  /** Populated as stages complete, so the UI never has to guess. */
  completedStages: AnalysisStatus[];

  /**
   * When the pipeline last moved.
   *
   * The panel's only honest way to tell "working" from "hung": a service worker
   * suspended mid-run stops pushing state while its port stays open and
   * healthy, so silence is the sole available signal. Compared against the
   * clock in the panel rather than tracked in the worker, because the worker is
   * exactly the thing that may have stopped.
   */
  lastProgressAt: number;
  /** When the current stage began. Used for per-stage patience thresholds. */
  stageStartedAt: number;
  /** How many times a stage has been retried in this session. */
  retries: number;
  /** True when local artifacts survive, so a retry need not re-scrub. */
  resumable: boolean;
  version: string;
}

/**
 * What the analysis actually managed to cover.
 *
 * Deliberately not a single accuracy percentage — there is no way to compute
 * one, and inventing it would be exactly the fabricated precision this product
 * refuses elsewhere. Per-area status is checkable; a number is not.
 */
export type CoverageLevel = 'complete' | 'high' | 'partial' | 'unavailable';

export interface AnalysisCoverage {
  scenes: CoverageLevel;
  transitions: CoverageLevel;
  cameraMotion: CoverageLevel;
  typography: CoverageLevel;
  frameAccess: CoverageLevel;
  /** Named reasons for anything below `high`. */
  notes: string[];
}

// -- Recreate ----------------------------------------------------------------

export const RECREATE_PLATFORMS = [
  'after-effects',
  'premiere-pro',
  'davinci-resolve',
  'capcut',
  'css',
  'framer-motion',
  'gsap',
] as const;
export type RecreatePlatform = (typeof RECREATE_PLATFORMS)[number];

export const RECREATE_PLATFORM_LABELS: Record<RecreatePlatform, string> = {
  'after-effects': 'After Effects',
  'premiere-pro': 'Premiere Pro',
  'davinci-resolve': 'DaVinci Resolve',
  capcut: 'CapCut',
  css: 'CSS',
  'framer-motion': 'Framer Motion',
  gsap: 'GSAP',
};

export interface RecreateGuide {
  platform: RecreatePlatform;
  /** The technique being reproduced, named in a few words. */
  technique?: string;
  /** Timing breakdown built from the measured spans. Values carry a ~ prefix. */
  timing: Array<{ label: string; value: string }>;
  /** Ordered, imperative. Each step is one action. */
  steps: string[];
  /** How the steps tie back to what was actually observed in this video. */
  whyThisMatches?: string;
  /** What could not be inferred from the evidence. Null when nothing applies. */
  caveat: string | null;
}
