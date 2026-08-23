/**
 * Central configuration. Every number that governs behaviour lives here rather
 * than scattered through the modules that consume it, so the pipeline can be
 * retuned without a hunt.
 */

/**
 * The product name, in one place.
 *
 * Everything a user can read comes from here. It was previously duplicated as a
 * literal in the panel header, the manifest and the error copy, and the copy
 * had already drifted: the header said "Motion Inspector" while six error and
 * empty states said "KINEMA". One constant means the two can no longer
 * disagree, and changing the name is a one-line change rather than a hunt.
 *
 * Deliberately *not* the package name, the log prefix, or the IndexedDB
 * database name. Those are internal, and renaming the database in particular
 * would orphan every stored frame for no user-visible gain.
 */
export const APP_NAME = 'KINEMA';
export const LOG_PREFIX = '[MotionInspector]';

export const EXTENSION_VERSION = __EXTENSION_VERSION__;
export const DEBUG = __DEBUG__;
export const BUILD_MODE = __BUILD_MODE__;

export const STORAGE = {
  settingsKey: 'mi:settings',
  historyKey: 'mi:history',
  sessionKey: 'mi:session',
  artifactsKey: 'mi:artifacts',
  // NOTE: the credential storage key is deliberately NOT here. This module is
  // reachable from the content bundle, and a constant here would land in the
  // page bundle — which the build's leak guard rightly rejects. It lives in
  // `storage/credentials.ts`, the only module that should know it.
  maxHistoryItems: 40,
  /** A thumbnail bigger than this is dropped rather than stored. */
  maxThumbnailBytes: 24 * 1024,
} as const;

export const VIDEO = {
  /** Below this an element is a decorative loop, an ad bumper, or a sprite. */
  minWidth: 120,
  minHeight: 90,
  /** Videos shorter than this have nothing to analyse. */
  minDurationSec: 0.8,
  /**
   * Above this the coarse pass would take longer than anyone will wait. Longer
   * videos are analysed across their full duration at a lower sample rate.
   */
  longVideoSec: 600,
  /** Registry ceiling, so a page of embeds cannot grow it without bound. */
  maxTrackedVideos: 24,
  /** How long to wait for a `seeked` event before calling a seek failed. */
  seekTimeoutMs: 4000,
  /** Minimum gap between currentTime updates pushed to the panel. */
  syncIntervalMs: 250,
} as const;

export const UPLOAD = {
  maxBytes: 512 * 1024 * 1024,
  /** Extensions offered in the file picker. Real support is probed, not assumed. */
  accept: 'video/mp4,video/webm,video/quicktime,video/x-m4v,video/*',
} as const;

export const API = {
  /** Client-side ceiling for one model call. */
  timeoutMs: 120_000,
} as const;

export const CONTEXT = {
  /** Offscreen document path, relative to the extension root. */
  offscreenPath: 'offscreen.html',
  /**
   * While an analysis runs, the panel and the offscreen document hold a port
   * open to the service worker. Port traffic resets MV3's idle timer; this is
   * the interval at which a heartbeat is sent when nothing else is flowing.
   */
  keepAliveMs: 20_000,
} as const;
