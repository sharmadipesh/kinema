/**
 * What the extension knows about a video it can see.
 *
 * The three capabilities are kept deliberately separate, because they are
 * separate in the browser:
 *
 *   1. detection      — we found a <video> element
 *   2. control        — we may set currentTime and read timeupdate
 *   3. pixel access   — we may draw it to a canvas and read the pixels back
 *
 * A site can permit the first two and forbid the third. `frameAccess` therefore
 * starts at 'unknown' and is only ever changed by an actual runtime probe
 * (`content/frame-access.ts`) — never inferred from a hostname.
 */

export type FrameAccess = 'unknown' | 'available' | 'restricted';

/** Why pixel access failed. Drives which error copy the panel shows. */
export type FrameAccessReason =
  /** getImageData threw: the canvas is tainted by cross-origin media. */
  | 'tainted'
  /** The element reports EME media keys. We do not attempt protected media. */
  | 'protected'
  /** Pixels read back, but identical and featureless at two different times. */
  | 'blank'
  /** The element had no decoded frame to draw. */
  | 'no-frame';

export interface DetectedVideo {
  /** Stable for the lifetime of this element+source. See `content/video-registry.ts`. */
  id: string;
  /** Document order at the time of detection. Presentation only — never an identity. */
  index: number;
  src?: string;
  currentSrc?: string;
  /** Seconds. 0 when the browser has not reported one; Infinity for live streams. */
  duration: number;
  currentTime: number;
  /** Intrinsic pixel dimensions, not layout size. */
  width: number;
  height: number;
  paused: boolean;
  muted: boolean;
  /** Intersecting the viewport at the last sweep. */
  visible: boolean;
  frameAccess: FrameAccess;
  frameAccessReason?: FrameAccessReason;
  /**
   * Media Source Extensions or a blob: source. The bytes cannot be re-fetched
   * from any other context, so frames must be captured from the live element —
   * which visibly scrubs the user's playback.
   */
  streaming: boolean;
  /** Encrypted Media Extensions in use. Frames are unavailable, by design. */
  drmProtected: boolean;
  title?: string;
  poster?: string;
  siteId: string;
  siteLabel: string;
  /** How strongly this looks like the video the user is watching. */
  activeScore?: number;
  /**
   * Set only when one video clearly leads. A near-tie leaves every entry false,
   * so the panel asks rather than choosing for the user.
   */
  likelyActive?: boolean;
}

/** A video the user picked from disk. Decoded in the offscreen document. */
export interface UploadedVideo {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  duration: number;
  width: number;
  height: number;
  /** Object URL, extension-origin. Revoked when the upload is replaced. */
  objectUrl: string;
}

export type AnalysisSource =
  | { kind: 'page'; videoId: string; tabId: number; label: string; pageUrl: string }
  | { kind: 'upload'; uploadId: string; label: string };

/** Result of a seek request. Never optimistic — `actualTime` is what happened. */
export interface SeekOutcome {
  ok: boolean;
  actualTime: number;
  /** Present when ok is false. */
  reason?: string;
}
