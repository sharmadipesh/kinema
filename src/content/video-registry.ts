import { VIDEO } from '../config.ts';
import { resolveAdapter } from '../sites/registry.ts';
import type { DetectedVideo } from '../types/video.ts';
import { probeFrameAccess } from './frame-access.ts';

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
 * when YouTube swaps in an ad, or a feed recycles a tile for the next post.
 * Every id is prefixed with a per-frame token so ids stay unique across the
 * several frames a page may inject this script into.
 */

const FRAME_TOKEN = Math.random().toString(36).slice(2, 8);

interface Identity {
  id: string;
  sourceKey: string;
}

const identities = new WeakMap<HTMLVideoElement, Identity>();
let counter = 0;

const sourceKeyOf = (video: HTMLVideoElement): string => video.currentSrc || video.src || 'none';

function identify(video: HTMLVideoElement): string {
  const sourceKey = sourceKeyOf(video);
  const existing = identities.get(video);
  // A changed source is a different video in the same box. Re-identifying is
  // what stops a seek landing in an ad, or an analysis being attributed to the
  // wrong clip after a feed scroll.
  if (existing && existing.sourceKey === sourceKey) return existing.id;

  counter += 1;
  const id = `${FRAME_TOKEN}-v${counter}`;
  identities.set(video, { id, sourceKey });
  return id;
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

function isVisible(video: HTMLVideoElement): boolean {
  const rect = video.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
}

/** A blob: or MSE source cannot be re-fetched from anywhere else. */
function isStreaming(video: HTMLVideoElement): boolean {
  const source = sourceKeyOf(video);
  return source.startsWith('blob:') || source === 'none';
}

export interface Snapshot {
  videos: DetectedVideo[];
  elements: Map<string, HTMLVideoElement>;
  siteLabel: string;
}

export function snapshot(options: { probe: boolean } = { probe: false }): Snapshot {
  const url = new URL(location.href);
  const adapter = resolveAdapter(url);
  const elements = new Map<string, HTMLVideoElement>();
  const videos: DetectedVideo[] = [];

  const candidates = findVideoElements().filter(
    (video) => isWorthOffering(video) && (adapter.isContentVideo?.(video) ?? true),
  );

  candidates.forEach((video, index) => {
    const id = identify(video);
    elements.set(id, video);

    const probe = options.probe ? probeFrameAccess(video) : { frameAccess: 'unknown' as const };

    videos.push({
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
      visible: isVisible(video),
      frameAccess: probe.frameAccess,
      ...(probe.reason ? { frameAccessReason: probe.reason } : {}),
      streaming: isStreaming(video),
      drmProtected: Boolean(video.mediaKeys),
      title: adapter.describe(video, url),
      ...(video.poster ? { poster: video.poster } : {}),
      siteId: adapter.id,
      siteLabel: adapter.label,
    });
  });

  // The video the user is most likely looking at comes first: playing and
  // visible beats visible beats everything else. `index` records document order
  // separately, so nothing downstream depends on this ordering for identity.
  videos.sort((a, b) => score(b) - score(a));

  return { videos, elements, siteLabel: adapter.label };
}

function score(video: DetectedVideo): number {
  return (video.visible ? 2 : 0) + (video.paused ? 0 : 2) + Math.min(1, video.width / 1920);
}
