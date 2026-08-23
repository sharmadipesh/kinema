import { describe, expect, it } from 'vitest';
import { isConfident, scoreVideo, type VideoScoreInput } from './scoring.ts';

const VIEWPORT = 1280 * 720;

const video = (overrides: Partial<VideoScoreInput> = {}): VideoScoreInput => ({
  renderedArea: 640 * 360,
  viewportRatio: 1,
  viewportArea: VIEWPORT,
  paused: true,
  muted: true,
  advancing: false,
  hasDuration: true,
  ...overrides,
});

describe('scoreVideo', () => {
  it('ranks a playing video above a paused one', () => {
    expect(scoreVideo(video({ paused: false, advancing: true }))).toBeGreaterThan(scoreVideo(video()));
  });

  it('ranks by rendered area, not intrinsic resolution', () => {
    // The bug the old heuristic had: a 4K clip in a thumbnail outscored the
    // 1080p one filling the screen, because it compared encoded width.
    const thumbnail = video({ renderedArea: 200 * 112 });
    const fullBleed = video({ renderedArea: 1280 * 720 });
    expect(scoreVideo(fullBleed)).toBeGreaterThan(scoreVideo(thumbnail));
  });

  it('treats audible playback as the strongest single signal', () => {
    // Browsers block autoplay with sound, so audible means deliberately started.
    const audible = scoreVideo(video({ paused: false, muted: false, advancing: true }));
    const silent = scoreVideo(video({ paused: false, muted: true, advancing: true }));
    expect(audible).toBeGreaterThan(silent);
  });

  it('discounts a playing video whose time is not advancing', () => {
    // Stalled, buffering, or a decoy loop behind a poster.
    const stalled = scoreVideo(video({ paused: false, advancing: false }));
    const running = scoreVideo(video({ paused: false, advancing: true }));
    expect(stalled).toBeLessThan(running);
  });

  it('rewards a recent interaction and decays it', () => {
    const justNow = scoreVideo(video({ msSinceInteraction: 0 }));
    const awhile = scoreVideo(video({ msSinceInteraction: 20_000 }));
    const stale = scoreVideo(video({ msSinceInteraction: 60_000 }));
    expect(justNow).toBeGreaterThan(awhile);
    expect(awhile).toBeGreaterThan(stale);
    expect(stale).toBe(scoreVideo(video()));
  });

  it('penalises a video scrolled out of view', () => {
    expect(scoreVideo(video({ viewportRatio: 0 }))).toBeLessThan(scoreVideo(video({ viewportRatio: 1 })));
  });

  it('picks the on-screen playing video over an off-screen autoplaying one', () => {
    // The feed case: several autoplaying muted videos, one actually watched.
    const watched = scoreVideo(video({ paused: false, advancing: true, renderedArea: 400 * 700, viewportRatio: 1 }));
    const offscreen = scoreVideo(
      video({ paused: false, advancing: true, renderedArea: 400 * 700, viewportRatio: 0 }),
    );
    expect(watched).toBeGreaterThan(offscreen);
  });

  it('never returns a negative score', () => {
    expect(scoreVideo(video({ renderedArea: 0, viewportRatio: 0, hasDuration: false }))).toBeGreaterThanOrEqual(0);
  });
});

describe('isConfident', () => {
  it('is confident about a lone video', () => {
    expect(isConfident([4])).toBe(true);
    expect(isConfident([])).toBe(true);
  });

  it('is confident when one video clearly leads', () => {
    expect(isConfident([9, 2])).toBe(true);
  });

  it('is not confident about a near-tie', () => {
    // Presenting a coin toss as a confident pick is how the wrong video gets
    // analysed without the user realising they had a choice to make.
    expect(isConfident([5, 4.2])).toBe(false);
  });

  it('is not confident when nothing scores well', () => {
    expect(isConfident([1.2, 0.4])).toBe(false);
  });
});
