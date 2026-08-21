import type { MotionAnalysis } from './motion.ts';

export interface FriendlyError {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Settings {
  /** Keep an entry in History each time an analysis completes. */
  saveHistory: boolean;
  /**
   * Warn before an analysis scrubs a page video. On by default: moving someone's
   * playhead without telling them first is a surprise, not a feature.
   */
  warnBeforeScrub: boolean;
  /** Frames per second requested during the coarse pass. Cost/accuracy dial. */
  samplingRate: 'economy' | 'balanced' | 'thorough';
  theme: ThemePreference;
}

export type SourceType = 'page' | 'upload';

/**
 * One completed analysis, kept locally.
 *
 * Deliberately modest: the analysis object plus a single small thumbnail. The
 * original video is never stored, and evidence frames live in IndexedDB
 * (`storage/frame-store.ts`) where they can be evicted, because three JPEGs per
 * event would exhaust the 10MB `storage.local` quota within a few analyses.
 */
export interface AnalysisHistoryItem {
  id: string;
  sourceType: SourceType;
  title: string;
  /** The page the video was analysed on. Absent for uploads. */
  url?: string;
  analyzedAt: number;
  duration: number;
  eventCount: number;
  /** Small JPEG data URL, one per analysis. Bounded by STORAGE.maxThumbnailBytes. */
  thumbnail?: string;
  analysis: MotionAnalysis;
}
