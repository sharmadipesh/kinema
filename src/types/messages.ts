import type { AnalysisHistoryItem, FriendlyError, Settings } from './domain.ts';
import type { AnalysisSession, MotionAnalysis, RecreateGuide, RecreatePlatform } from './motion.ts';
import type { AnalysisFrameSize, Candidate, EvidenceFrame, FrameMetrics } from './analysis.ts';
import type { AnalysisSource, DetectedVideo, FrameAccess, FrameAccessReason, SeekOutcome, UploadedVideo } from './video.ts';

/**
 * Every message in the extension, in three discriminated unions — one per
 * channel. A new message cannot be added without the compiler forcing each
 * handler to acknowledge it.
 *
 * SECURITY: no message in this file carries a credential, and none ever may.
 * The OpenAI key is read inside the service worker at the moment of the request
 * and never travels. `scripts/build-manifest.mjs` fails the build if anything
 * under `src/content/` even reaches the module that holds it.
 */

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: FriendlyError };
export type Result<T> = Ok<T> | Err;

// -- Panel ⇄ service worker (over the `mi:panel` port) ------------------------

export interface PanelState {
  session: AnalysisSession | null;
  analysis: MotionAnalysis | null;
  source: AnalysisSource | null;
  error: FriendlyError | null;
}

export type PanelRequest =
  | { type: 'panel:get-state' }
  | { type: 'panel:detect-videos'; grantPermission: boolean }
  | { type: 'panel:probe-frame-access'; videoId: string }
  | { type: 'panel:register-upload'; upload: UploadedVideo }
  | { type: 'panel:start-analysis'; source: AnalysisSource }
  | { type: 'panel:cancel-analysis'; sessionId: string }
  | { type: 'panel:clear-analysis' }
  | { type: 'panel:seek'; videoId: string; timestamp: number; play: boolean }
  | { type: 'panel:set-sync'; videoId: string; enabled: boolean }
  | { type: 'panel:recreate'; eventId: string; platform: RecreatePlatform }
  | { type: 'panel:load-history'; itemId: string };

export interface DetectionReport {
  tabId: number;
  pageUrl: string;
  siteLabel: string;
  videos: DetectedVideo[];
  /** True when the tab cannot host a content script at all (chrome://, store). */
  unreachable: boolean;
}

export type PanelResponse =
  | { for: 'panel:get-state'; state: PanelState }
  | { for: 'panel:detect-videos'; report: DetectionReport }
  | { for: 'panel:probe-frame-access'; videoId: string; frameAccess: FrameAccess; reason?: FrameAccessReason }
  | { for: 'panel:register-upload' }
  | { for: 'panel:start-analysis'; session: AnalysisSession }
  | { for: 'panel:cancel-analysis'; cancelled: boolean }
  | { for: 'panel:clear-analysis' }
  | { for: 'panel:seek'; outcome: SeekOutcome }
  | { for: 'panel:set-sync' }
  | { for: 'panel:recreate'; guide: RecreateGuide }
  | { for: 'panel:load-history'; analysis: MotionAnalysis };

/**
 * Pushed from the service worker to the panel. Never a reply to a request.
 *
 * `event:state` carries the whole session snapshot rather than a delta. An
 * earlier design pushed session / analysis / failure separately, and there was
 * simply no event for "the analysis was cleared" — so the panel kept rendering
 * a timeline the service worker had already forgotten. A snapshot cannot drift.
 *
 * Time and video-list events stay separate because they arrive at a completely
 * different rate and from a different source.
 */
export type PanelEvent =
  | { type: 'event:state'; state: PanelState }
  | { type: 'event:videos'; report: DetectionReport }
  | { type: 'event:tab-changed' }
  | { type: 'event:time'; videoId: string; currentTime: number; paused: boolean }
  | { type: 'event:video-gone'; videoId: string };

// -- Service worker → content script (chrome.tabs.sendMessage) ----------------

export type ContentCommand =
  | { type: 'content:detect' }
  | { type: 'content:probe'; videoId: string }
  | { type: 'content:seek'; videoId: string; timestamp: number; play: boolean }
  | { type: 'content:set-sync'; videoId: string; enabled: boolean }
  | { type: 'content:sample'; videoId: string; timestamps: number[]; size: AnalysisFrameSize; runId: string }
  | { type: 'content:capture'; videoId: string; times: Array<{ id: string; time: number }>; maxWidth: number; runId: string }
  | { type: 'content:restore'; videoId: string }
  | { type: 'content:abort'; runId: string };

export type ContentReply =
  | { for: 'content:detect'; videos: DetectedVideo[]; siteLabel: string; pageUrl: string }
  | { for: 'content:probe'; videoId: string; frameAccess: FrameAccess; reason?: FrameAccessReason }
  | { for: 'content:seek'; outcome: SeekOutcome }
  | { for: 'content:set-sync' }
  | { for: 'content:sample'; metrics: FrameMetrics[] }
  | { for: 'content:capture'; frames: Array<{ id: string; time: number; dataUrl: string }> }
  | { for: 'content:restore' }
  | { for: 'content:abort' };

/** Pushed from a content script to the service worker. */
export type ContentEvent =
  | { type: 'content-event:videos'; videos: DetectedVideo[]; siteLabel: string; pageUrl: string }
  | { type: 'content-event:time'; videoId: string; currentTime: number; paused: boolean }
  | { type: 'content-event:gone'; videoId: string };

// -- Service worker ⇄ offscreen document (over the `mi:offscreen` port) -------

export type OffscreenRequest =
  | { type: 'offscreen:load'; objectUrl: string }
  | { type: 'offscreen:sample'; timestamps: number[]; size: AnalysisFrameSize }
  | { type: 'offscreen:measure-fps' }
  | { type: 'offscreen:capture'; times: Array<{ id: string; time: number }>; maxWidth: number }
  | { type: 'offscreen:thumbnail'; time: number; maxWidth: number }
  | { type: 'offscreen:release' };

export type OffscreenResponse =
  | { for: 'offscreen:load'; duration: number; width: number; height: number }
  | { for: 'offscreen:sample'; metrics: FrameMetrics[] }
  | { for: 'offscreen:measure-fps'; fps: number | null }
  | { for: 'offscreen:capture'; frames: Array<{ id: string; time: number; dataUrl: string }> }
  | { for: 'offscreen:thumbnail'; dataUrl: string | null }
  | { for: 'offscreen:release' };

// -- Shared shapes -----------------------------------------------------------

/** What the orchestrator hands to the AI layer. */
export interface AnalysisEvidence {
  candidates: Candidate[];
  frames: EvidenceFrame[];
}

export type { AnalysisHistoryItem, Settings, AnalysisSession, MotionAnalysis, RecreateGuide };
