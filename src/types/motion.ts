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
  'crossfade',
  'fade',
  'whip_pan',
  'zoom',
  'zoom_in',
  'zoom_out',
  'camera_pan',
  'camera_tilt',
  'camera_rotation',
  'tracking',
  'motion_blur',
  'flash',
  'light_leak',
  'speed_ramp',
  'slow_motion',
  'fast_motion',
  'text_appears',
  'text_disappears',
  'text_animation',
  'object_movement',
  'subject_movement',
  'background_change',
  'color_change',
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
  crossfade: 'transition',
  fade: 'transition',
  whip_pan: 'transition',
  zoom: 'camera',
  zoom_in: 'camera',
  zoom_out: 'camera',
  camera_pan: 'camera',
  camera_tilt: 'camera',
  camera_rotation: 'camera',
  tracking: 'camera',
  motion_blur: 'effect',
  flash: 'effect',
  light_leak: 'effect',
  speed_ramp: 'speed',
  slow_motion: 'speed',
  fast_motion: 'speed',
  text_appears: 'text',
  text_disappears: 'text',
  text_animation: 'text',
  object_movement: 'motion',
  subject_movement: 'subject',
  background_change: 'motion',
  color_change: 'color',
  effect: 'effect',
  other: 'other',
};

export const EVENT_TYPE_LABELS: Record<MotionEventType, string> = {
  scene_change: 'Scene Change',
  hard_cut: 'Hard Cut',
  crossfade: 'Crossfade',
  fade: 'Fade',
  whip_pan: 'Whip Pan',
  zoom: 'Zoom',
  zoom_in: 'Zoom In',
  zoom_out: 'Zoom Out',
  camera_pan: 'Camera Pan',
  camera_tilt: 'Camera Tilt',
  camera_rotation: 'Camera Rotation',
  tracking: 'Tracking Shot',
  motion_blur: 'Motion Blur',
  flash: 'Flash',
  light_leak: 'Light Leak',
  speed_ramp: 'Speed Ramp',
  slow_motion: 'Slow Motion',
  fast_motion: 'Fast Motion',
  text_appears: 'Text Appears',
  text_disappears: 'Text Disappears',
  text_animation: 'Text Animation',
  object_movement: 'Object Movement',
  subject_movement: 'Subject Movement',
  background_change: 'Background Change',
  color_change: 'Colour Change',
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
  /** Sampling interval that produced these numbers, in seconds. */
  sampleIntervalSec?: number;
  beforeFrameId?: string;
  duringFrameId?: string;
  afterFrameId?: string;
}

// -- Events ------------------------------------------------------------------

export interface MotionEvent {
  id: string;
  /** Seconds. Measured, never model-supplied. */
  startTime: number;
  /** Present only when the underlying candidate actually spanned a range. */
  endTime?: number;
  category: MotionCategory;
  type: MotionEventType;
  title: string;
  description: string;
  /** 0–1. */
  confidence: number;
  /**
   * 'detected' — local measurement crossed threshold on its own.
   * 'likely'   — the model's reading of weaker or ambiguous evidence.
   * The UI prefixes 'likely' events with "Likely".
   */
  certainty: 'detected' | 'likely';
  direction?: MotionDirection;
  effects?: string[];
  evidence?: MotionEvidence;
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

/** Each 0–1, derived from the event list by `analysis/editing-dna.ts`. */
export type EditingDNA = Record<DnaTrait, { value: number; label: string }>;

export interface MotionAnalysis {
  video: VideoMetadata;
  overview: VideoOverview;
  editingDNA: EditingDNA;
  events: MotionEvent[];
  /** How many frames were sampled and how many were sent to the model. */
  stats: {
    coarseFrames: number;
    fineFrames: number;
    candidates: number;
    framesSentToModel: number;
  };
}

// -- Session -----------------------------------------------------------------

export const ANALYSIS_STATUSES = [
  'idle',
  'preparing',
  'reading_video',
  'coarse_sampling',
  'detecting_scenes',
  'fine_sampling',
  'capturing_evidence',
  'ai_analysis',
  'normalizing',
  'building_timeline',
  'completed',
  'cancelled',
  'failed',
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/** Stages shown in the progress UI, in order. Terminal states are not stages. */
export const PROGRESS_STAGES = [
  'reading_video',
  'coarse_sampling',
  'detecting_scenes',
  'fine_sampling',
  'capturing_evidence',
  'ai_analysis',
  'building_timeline',
] as const satisfies readonly AnalysisStatus[];

export const STAGE_LABELS: Record<(typeof PROGRESS_STAGES)[number], string> = {
  reading_video: 'Reading video',
  coarse_sampling: 'Sampling frames',
  detecting_scenes: 'Detecting visual changes',
  fine_sampling: 'Refining candidates',
  capturing_evidence: 'Capturing evidence frames',
  ai_analysis: 'Interpreting motion',
  building_timeline: 'Building timeline',
};

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
  /** Ordered, imperative. Each step is one action. */
  steps: string[];
  /** What could not be inferred from the evidence. Null when nothing applies. */
  caveat: string | null;
}
