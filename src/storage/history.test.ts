import { describe, expect, it, beforeEach, vi } from 'vitest';
import { isHistoryItem, readHistory } from './history.ts';
import { STORAGE } from '../config.ts';
import type { AnalysisHistoryItem } from '../types/domain.ts';
import type { MotionAnalysis } from '../types/motion.ts';

/**
 * History has to survive its own schema changing. `MotionAnalysis.id` did not
 * exist before 2.1, and an entry written without it still points at real frames
 * — the entry id has always been the key they were stored under.
 */

const store: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: (key: string) => Promise.resolve(key in store ? { [key]: store[key] } : {}),
      set: (items: Record<string, unknown>) => {
        Object.assign(store, items);
        return Promise.resolve();
      },
      remove: () => Promise.resolve(),
    },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
});

const legacy = (id: string): AnalysisHistoryItem =>
  ({
    id,
    sourceType: 'page',
    title: 'Reel',
    analyzedAt: 1,
    duration: 20,
    eventCount: 3,
    // Written by 2.0, which had no `id` on the analysis itself.
    analysis: { video: { duration: 20, width: 1080, height: 1920 }, events: [], version: '2.0' } as unknown as MotionAnalysis,
  }) as AnalysisHistoryItem;

describe('readHistory', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it('repairs a pre-2.1 entry from its own id rather than discarding it', () => {
    store[STORAGE.historyKey] = [legacy('analysis-abc')];

    return readHistory().then((items) => {
      expect(items[0]?.analysis.id).toBe('analysis-abc');
    });
  });

  it('leaves a current entry untouched', () => {
    const current = legacy('analysis-xyz');
    current.analysis = { ...current.analysis, id: 'analysis-xyz' };
    store[STORAGE.historyKey] = [current];

    return readHistory().then((items) => {
      expect(items[0]?.analysis.id).toBe('analysis-xyz');
    });
  });

  it('rejects entries that were never analyses', () => {
    expect(isHistoryItem({ id: 'x' })).toBe(false);
    expect(isHistoryItem(null)).toBe(false);
  });
});
