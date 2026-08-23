import { VIDEO } from '../config.ts';
import { resolveAdapter } from '../sites/registry.ts';
import type { DetectedVideo } from '../types/video.ts';
import { probeFrameAccess } from './frame-access.ts';
import { isConfident, scoreVideo } from './scoring.ts';

/**
 * Every video this frame can see, and a stable identity for each.
 *
 * `document.querySelector('video')` is not enough, for three reasons this
 * module handles: players are frequently inside a custom element's shadow root;
 * a page can hold several videos and the first in document order is routinely
 * not the one being watched; and a single-page app recycles elements, so
 * document order is not an identity.
 *
 * Identity is therefore a token attached to the element itself via a WeakMap,
 * invalidated when the element's source changes — which is exactly what happens
 * when a feed swaps the next clip into the player the user is already looking
 * at. Every id is prefixed with a per-frame token so ids stay unique across the
 * several frames a page may inject this script into.
 */

const FRAME_TOKEN = Math.random().toString(36).slice(2, 8);

interface Identity {
  id: string;
  sourceKey: string;
}

const identities = new WeakMap<HTMLVideoElement, Identity>();
/** Last observed playhead, so "is this actually advancing" is answerable. */
const observed = new WeakMap<HTMLVideoElement, { time: number; at: number }>();
/** When the user last clicked or tapped this element. */
const interactions = new WeakMap<HTMLVideoElement, number>();
/** Elements already carrying lifecycle listeners, so they are attached once. */
const wired = new WeakSet<HTMLVideoElement>();

let counter = 0;

const sourceKeyOf = (video: HTMLVideoElement): string => video.currentSrc || video.src || 'none';

function identify(video: HTMLVideoElement): string {
  const sourceKey = sourceKeyOf(video);
  const existing = identities.get(video);
  // A changed source is a different video in the same box. Re-identifying is
  // what stops a seek landing in an ad, or an analysis being attributed to the
  // wrong clip after a feed scroll.
  if (existing && existing.sourceKey === sourceKey) return existing.id;

  /**
   * A source swap passes through an empty state: `emptied` fires, `currentSrc`
   * clears, and the real source arrives a moment later. Minting an identity for
   * that gap would churn two ids per swap and fire a spurious "video gone" for
   * the intermediate one. An element between sources is not yet a different
   * video, so the previous identity is held until a real source appears.
   */
  if (existing && sourceKey === 'none') return existing.id;

  counter += 1;
  const id = `${FRAME_TOKEN}-v${counter}`;
  identities.set(video, { id, sourceKey });
  return id;
}

/**
 * Watches one element for the events that mean "this is a different video now".
 *
 * The reason this exists at all: a `MutationObserver` on `childList` cannot see
 * a source swap performed in place, and neither can one watching the `src`
 * attribute when the page drives playback through Media Source Extensions —
 * there `currentSrc` is a blob URL that changes with no attribute mutation
 * whatsoever. Instagram, TikTok and YouTube Shorts all recycle a single
 * `<video>` element this way, so without these listeners the registry kept
 * serving the previous clip's id and descriptor indefinitely. The
 * re-identification logic was already correct; nothing ever triggered it.
 */
export function watchElement(video: HTMLVideoElement, onChange: () => void): void {
  if (wired.has(video)) return;
  wired.add(video);

  for (const event of ['loadstart', 'loadedmetadata', 'durationchange', 'emptied', 'abort'] as const) {
    video.addEventListener(event, onChange, { passive: true });
  }
  // Playback state feeds the active-video score, so a change to it changes
  // which video the panel should be offering.
  for (const event of ['play', 'pause', 'volumechange'] as const) {
    video.addEventListener(event, onChange, { passive: true });
  }

  video.addEventListener(
    'pointerdown',
    () => {
      interactions.set(video, Date.now());
    },
    { passive: true, capture: true },
  );
}

/**
 * Collects video elements, descending into open shadow roots.
 *
 * The shadow walk is skipped entirely when the light DOM already produced
 * results, because `querySelectorAll('*')` across a large document is genuinely
 * expensive and most sites do not need it. It is bounded by depth regardless.
 */
function collect(root: ParentNode, out: HTMLVideoElement[], depth: number): void {
  for (const element of root.querySelectorAll('video')) {
    if (out.length >= VIDEO.maxTrackedVideos) return;
    out.push(element);
  }
  if (depth >= 3) return;
  for (const element of root.querySelectorAll('*')) {
    const shadow = element.shadowRoot;
    if (shadow) collect(shadow, out, depth + 1);
    if (out.length >= VIDEO.maxTrackedVideos) return;
  }
}

export function findVideoElements(): HTMLVideoElement[] {
  const found: HTMLVideoElement[] = [];
  collect(document, found, 3);
  if (found.length === 0) collect(document, found, 0);

  // Same-origin iframes are readable directly; cross-origin ones get their own
  // injected copy of this script and report themselves.
  for (const frame of document.querySelectorAll('iframe')) {
    if (found.length >= VIDEO.maxTrackedVideos) break;
    try {
      const doc = frame.contentDocument;
      if (doc) collect(doc, found, 1);
    } catch {
      // Cross-origin. Expected, and not an error.
    }
  }

  return [...new Set(found)];
}

function isWorthOffering(video: HTMLVideoElement): boolean {
  const width = video.videoWidth || video.clientWidth;
  const height = video.videoHeight || video.clientHeight;
  if (width && width < VIDEO.minWidth) return false;
  if (height && height < VIDEO.minHeight) return false;
  // Live streams report Infinity; a video with no duration yet may still be
  // loading, so only a positive-but-tiny duration disqualifies.
  if (Number.isFinite(video.duration) && video.duration > 0 && video.duration < VIDEO.minDurationSec) return false;
  return true;
}

/** Fraction of the element inside the viewport, 0–1. */
function viewportRatio(rect: DOMRect): number {
  const area = rect.width * rect.height;
  if (area <= 0) return 0;
  const visibleWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
  const visibleHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
  return (visibleWidth * visibleHeight) / area;
}

/**
 * Has the playhead moved since we last looked?
 *
 * Distinguishes genuine playback from a stalled or buffering element, and from
 * the muted decoy loops feeds place behind posters. Recorded on every snapshot
 * so the next one has something to compare against.
 */
function isAdvancing(video: HTMLVideoElement): boolean {
  const now = Date.now();
  const previous = observed.get(video);
  observed.set(video, { time: video.currentTime, at: now });
  if (!previous) return false;
  if (now - previous.at < 120) return !video.paused;
  return video.currentTime > previous.time + 0.01;
}

/** A blob: or MSE source cannot be re-fetched from any other context. */
function isStreaming(video: HTMLVideoElement): boolean {
  const source = sourceKeyOf(video);
  return source.startsWith('blob:') || source === 'none';
}

export interface Snapshot {
  videos: DetectedVideo[];
  elements: Map<string, HTMLVideoElement>;
  siteLabel: string;
}

export interface SnapshotOptions {
  probe: boolean;
  /**
   * Called for every element found, before filtering.
   *
   * Takes the callback rather than letting the caller walk the DOM itself: the
   * shadow-root traversal is the expensive part of a scan, and doing it twice
   * per announce on a large page is pure waste. Watching is applied before
   * `isWorthOffering` filters, so a video that is briefly zero-sized while its
   * source swaps still gets listeners.
   */
  onElement?(video: HTMLVideoElement): void;
}

export function snapshot(options: SnapshotOptions = { probe: false }): Snapshot {
  const url = new URL(location.href);
  const adapter = resolveAdapter(url);
  const elements = new Map<string, HTMLVideoElement>();
  const viewportArea = Math.max(1, innerWidth * innerHeight);

  const found = findVideoElements();
  if (options.onElement) for (const video of found) options.onElement(video);

  const candidates = found.filter(
    (video) => isWorthOffering(video) && (adapter.isContentVideo?.(video) ?? true),
  );

  const scored = candidates.map((video, index) => {
    const id = identify(video);
    elements.set(id, video);

    const rect = video.getBoundingClientRect();
    const ratio = viewportRatio(rect);
    const interactedAt = interactions.get(video);
    const probe = options.probe ? probeFrameAccess(video) : { frameAccess: 'unknown' as const };

    const activeScore = scoreVideo({
      renderedArea: rect.width * rect.height,
      viewportRatio: ratio,
      viewportArea,
      paused: video.paused,
      muted: video.muted || video.volume === 0,
      advancing: isAdvancing(video),
      ...(interactedAt !== undefined ? { msSinceInteraction: Date.now() - interactedAt } : {}),
      hasDuration: Number.isFinite(video.duration) && video.duration > 0,
    });

    const descriptor: DetectedVideo = {
      id,
      index,
      ...(video.src ? { src: video.src } : {}),
      ...(video.currentSrc ? { currentSrc: video.currentSrc } : {}),
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      currentTime: video.currentTime,
      width: video.videoWidth,
      height: video.videoHeight,
      paused: video.paused,
      muted: video.muted,
      visible: ratio > 0.05 && rect.width > 2,
      frameAccess: probe.frameAccess,
      ...(probe.reason ? { frameAccessReason: probe.reason } : {}),
      streaming: isStreaming(video),
      drmProtected: Boolean(video.mediaKeys),
      title: adapter.describe(video, url),
      ...(video.poster ? { poster: video.poster } : {}),
      siteId: adapter.id,
      siteLabel: adapter.label,
      activeScore,
      likelyActive: false,
    };

    return descriptor;
  });

  // Highest score first. `index` records document order separately, so nothing
  // downstream depends on this ordering for identity.
  scored.sort((a, b) => (b.activeScore ?? 0) - (a.activeScore ?? 0));

  const confident = isConfident(scored.map((video) => video.activeScore ?? 0));
  const leader = scored[0];
  if (leader && confident) leader.likelyActive = true;

  return { videos: scored, elements, siteLabel: adapter.label };
}
