import { describe, expect, it, beforeEach } from 'vitest';
import { forgetTab, getReport, recordDetection } from './tab-videos.ts';
import type { DetectedVideo } from '../types/video.ts';

/**
 * Ordering across frames, which is the contract the video selector reads.
 *
 * The registry in the content script sorts by a measured active-video score and
 * flags a leader; the panel presents that order as "likely current" first. The
 * background used to re-sort the merged list by document index, silently
 * replacing the ordering with a different one under the same label.
 */

const video = (id: string, index: number, activeScore: number): DetectedVideo => ({
  id,
  index,
  duration: 30,
  currentTime: 0,
  width: 1920,
  height: 1080,
  paused: false,
  muted: false,
  visible: true,
  frameAccess: 'unknown',
  streaming: false,
  drmProtected: false,
  title: id,
  siteId: 'generic',
  siteLabel: 'Example',
  activeScore,
  likelyActive: false,
});

const TAB = 1;

describe('recordDetection', () => {
  beforeEach(() => forgetTab(TAB));

  it('keeps the highest-scoring video first even when it is last in the document', () => {
    // Document order says the hero is last; the score says it is the one being
    // watched. The score has to win, or the panel preselects an ad bumper.
    recordDetection(TAB, 0, [video('a', 0, 0.1), video('b', 1, 0.2), video('hero', 2, 0.9)], 'Example', 'https://x');

    expect(getReport(TAB)?.videos.map((entry) => entry.id)).toEqual(['hero', 'b', 'a']);
  });

  it('orders across frames by score, not by each frame\'s own index', () => {
    // `index` is assigned per frame, so both of these are index 0. Sorting by
    // index alone made the merge arbitrary as well as wrong.
    recordDetection(TAB, 0, [video('top', 0, 0.3)], 'Example', 'https://x');
    recordDetection(TAB, 7, [video('embed', 0, 0.8)], 'Example', 'https://x');

    expect(getReport(TAB)?.videos.map((entry) => entry.id)).toEqual(['embed', 'top']);
  });

  it('breaks an exact score tie with the top frame first', () => {
    recordDetection(TAB, 9, [video('embed', 0, 0.5)], 'Example', 'https://x');
    recordDetection(TAB, 0, [video('top', 0, 0.5)], 'Example', 'https://x');

    expect(getReport(TAB)?.videos.map((entry) => entry.id)).toEqual(['top', 'embed']);
  });

  it('replaces only the reporting frame\'s contribution', () => {
    recordDetection(TAB, 0, [video('top', 0, 0.9)], 'Example', 'https://x');
    recordDetection(TAB, 3, [video('embed', 0, 0.4)], 'Example', 'https://x');
    recordDetection(TAB, 3, [video('embed2', 0, 0.5)], 'Example', 'https://x');

    expect(getReport(TAB)?.videos.map((entry) => entry.id)).toEqual(['top', 'embed2']);
  });
});
