import type { ContentCommand, ContentReply, DetectionReport, Result } from '../types/messages.ts';
import type { DetectedVideo } from '../types/video.ts';
import { localError } from '../utils/errors.ts';
import { withTimeout } from '../utils/schedule.ts';
import { log } from '../utils/logger.ts';

/**
 * What each tab has told us about its videos, and how to talk back to the right
 * frame.
 *
 * The frame part matters more than it looks. A Vimeo embed, a YouTube iframe
 * and the host page are three separate documents; the script is injected into
 * all of them, and each reports the videos it can see. A seek sent to the top
 * frame would silently do nothing for a video living in the embed — so every
 * video id is remembered alongside the frame that owns it.
 *
 * Nothing here is written by browsing. A tab appears in this map only after the
 * user has asked Motion Inspector to look at it.
 */

interface TabRecord {
  videos: DetectedVideo[];
  frameOf: Map<string, number>;
  siteLabel: string;
  pageUrl: string;
  updatedAt: number;
}

/** Long enough for a slow seek run, short enough to catch a dead handler. */
const TAB_COMMAND_TIMEOUT_MS = 180_000;

const tabs = new Map<number, TabRecord>();
const injected = new Set<number>();

export function recordDetection(
  tabId: number,
  frameId: number,
  videos: DetectedVideo[],
  siteLabel: string,
  pageUrl: string,
): DetectionReport {
  const record = tabs.get(tabId) ?? {
    videos: [],
    frameOf: new Map<string, number>(),
    siteLabel,
    pageUrl,
    updatedAt: 0,
  };

  // Replace this frame's contribution wholesale, keep every other frame's.
  const fromOtherFrames = record.videos.filter((video) => record.frameOf.get(video.id) !== frameId);
  for (const [videoId, owner] of [...record.frameOf]) {
    if (owner === frameId) record.frameOf.delete(videoId);
  }
  for (const video of videos) record.frameOf.set(video.id, frameId);

  /**
   * Ordered by active score, not document order.
   *
   * `video-registry.ts` sorts by a measured active-video score and the panel
   * presents the result as "likely current" first. Re-sorting by `index` here
   * threw that away and handed the panel document order under a label claiming
   * otherwise — and `index` is assigned per frame, so on a page with embeds the
   * indices collide and the merge was arbitrary as well as wrong.
   *
   * Frame id then index break ties: the top frame wins, then document order
   * within it, which is stable across re-detections.
   */
  record.videos = [...fromOtherFrames, ...videos].sort((a, b) => {
    const byScore = (b.activeScore ?? 0) - (a.activeScore ?? 0);
    if (byScore !== 0) return byScore;
    const byFrame = (record.frameOf.get(a.id) ?? 0) - (record.frameOf.get(b.id) ?? 0);
    return byFrame !== 0 ? byFrame : a.index - b.index;
  });
  record.updatedAt = Date.now();
  // The top frame names the page; an embed should not overwrite that.
  if (frameId === 0) {
    record.siteLabel = siteLabel;
    record.pageUrl = pageUrl;
  } else if (!record.pageUrl) {
    record.pageUrl = pageUrl;
  }

  tabs.set(tabId, record);
  return toReport(tabId, record);
}

export function forgetVideo(tabId: number, videoId: string): void {
  const record = tabs.get(tabId);
  if (!record) return;
  record.videos = record.videos.filter((video) => video.id !== videoId);
  record.frameOf.delete(videoId);
}

export function forgetTab(tabId: number): void {
  tabs.delete(tabId);
  injected.delete(tabId);
}

export function getReport(tabId: number): DetectionReport | null {
  const record = tabs.get(tabId);
  return record ? toReport(tabId, record) : null;
}

export function findVideo(videoId: string): { tabId: number; frameId: number; video: DetectedVideo } | null {
  for (const [tabId, record] of tabs) {
    const video = record.videos.find((entry) => entry.id === videoId);
    const frameId = record.frameOf.get(videoId);
    if (video && frameId !== undefined) return { tabId, frameId, video };
  }
  return null;
}

function toReport(tabId: number, record: TabRecord): DetectionReport {
  return {
    tabId,
    pageUrl: record.pageUrl,
    siteLabel: record.siteLabel,
    videos: record.videos,
    unreachable: false,
  };
}

/**
 * Whether a tab is one Chrome will never let an extension script.
 *
 * Returns `unknown` when the URL is not visible, which is the normal state for
 * a tab the user has not invoked the extension on — Motion Inspector holds no
 * blanket host permission, so `tab.url` is simply withheld. Treating that as
 * "not scriptable" told users the page could not be inspected when the truth
 * was that permission had not been granted yet, which is a different problem
 * with a different fix.
 */
export function scriptability(url: string | undefined): 'yes' | 'no' | 'unknown' {
  if (!url) return 'unknown';
  if (!/^https?:|^file:/.test(url)) return 'no';
  return /^https:\/\/chromewebstore\.google\.com/.test(url) ? 'no' : 'yes';
}

export async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

/**
 * Injects the detection script into every frame of a tab.
 *
 * Injection succeeds only where the user has granted access — `activeTab` from
 * the toolbar click that opened the panel, or an origin they explicitly
 * approved. That failure is the permission boundary working, so it is reported
 * as something the user can fix rather than swallowed.
 */
export async function ensureInjected(tabId: number, force = false): Promise<void> {
  if (injected.has(tabId) && !force) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js'],
    });
    injected.add(tabId);
  } catch (error) {
    log.warn('injection failed', { tabId, error: String(error) });
    throw localError('PAGE_PERMISSION');
  }
}

/** Sends a command to the frame that owns a video, and unwraps the result. */
export async function commandVideo<T extends ContentReply>(videoId: string, command: ContentCommand): Promise<T> {
  const located = findVideo(videoId);
  if (!located) throw localError('VIDEO_GONE');
  return commandFrame<T>(located.tabId, located.frameId, command);
}

export async function commandFrame<T extends ContentReply>(
  tabId: number,
  frameId: number,
  command: ContentCommand,
): Promise<T> {
  let response: Result<ContentReply> | undefined;
  try {
    /**
     * `tabs.sendMessage` rejects when the content script is *gone*, but not
     * when it is present and its handler never calls `sendResponse` — a page
     * navigating mid-analysis lands exactly there. Without this the service
     * worker waits forever on a tab that has moved on.
     */
    response = (await withTimeout(
      chrome.tabs.sendMessage(tabId, command, { frameId }) as Promise<Result<ContentReply> | undefined>,
      TAB_COMMAND_TIMEOUT_MS,
      `tab command ${command.type}`,
    )) as Result<ContentReply> | undefined;
  } catch (error) {
    log.warn('tab command failed', { tabId, frameId, type: command.type, error: String(error) });
    throw localError('VIDEO_GONE');
  }
  if (!response) throw localError('VIDEO_GONE');
  if (!response.ok) throw response.error;
  return response.data as T;
}
