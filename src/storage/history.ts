import { STORAGE } from '../config.ts';
import type { AnalysisHistoryItem } from '../types/domain.ts';
import { log } from '../utils/logger.ts';

/**
 * Local analysis history.
 *
 * Deliberately modest, for the same reason Visual Prompt's prompt library is:
 * `chrome.storage.local` is 10MB and image data eats it alive. An entry holds
 * the analysis object and at most one small thumbnail. Evidence frames — three
 * per event — live in `storage/frame-store.ts` (IndexedDB), where they can be
 * evicted without losing the analysis itself.
 *
 * Privacy: an entry exists only because the user pressed Analyse. Nothing here
 * is written by browsing, hovering, or opening the panel.
 */

export async function readHistory(): Promise<AnalysisHistoryItem[]> {
  try {
    const stored = await chrome.storage.local.get(STORAGE.historyKey);
    const raw = stored[STORAGE.historyKey];
    if (!Array.isArray(raw)) return [];
    return raw.filter(isHistoryItem).map(withAnalysisId).slice(0, STORAGE.maxHistoryItems);
  } catch (error) {
    log.warn('history read failed', { error: String(error) });
    return [];
  }
}

/**
 * Writes an entry, and never lets the attempt cost the analysis.
 *
 * This runs at the very end of a successful run, after every model call has
 * been paid for. `chrome.storage.local` is 10MB and an entry now carries a full
 * production blueprint, so a quota rejection here is real — and it used to
 * propagate into the orchestrator's catch, mark the session failed, and hand
 * the user an error for work that had completely succeeded.
 *
 * On a quota failure the oldest half of the library is dropped and the write is
 * retried once. Losing old entries to keep the new one is the right trade: the
 * new one is the thing the user is looking at.
 */
export async function addHistoryItem(item: AnalysisHistoryItem): Promise<AnalysisHistoryItem> {
  // A thumbnail over budget is dropped rather than stored: a missing preview is
  // a cosmetic loss, a blown quota loses the whole library.
  const stored: AnalysisHistoryItem =
    item.thumbnail && item.thumbnail.length > STORAGE.maxThumbnailBytes
      ? { ...item, thumbnail: undefined }
      : item;

  const existing = await readHistory();
  // Re-analysing the same video replaces its earlier entry rather than filling
  // the list with near-duplicates.
  const deduped = existing.filter((entry) => !(entry.url && entry.url === stored.url && entry.title === stored.title));
  const next = [stored, ...deduped].slice(0, STORAGE.maxHistoryItems);

  try {
    await chrome.storage.local.set({ [STORAGE.historyKey]: next });
  } catch (error) {
    log.warn('history write failed, retrying with a trimmed library', { error: String(error) });
    const trimmed = [stored, ...deduped.slice(0, Math.floor(deduped.length / 2))];
    try {
      await chrome.storage.local.set({ [STORAGE.historyKey]: trimmed });
    } catch (retryError) {
      // Still no. The analysis itself is already complete and on screen; a
      // missing History row is a smaller loss than a failed run.
      log.warn('history write abandoned', { error: String(retryError) });
    }
  }
  return stored;
}

export async function removeHistoryItem(id: string): Promise<void> {
  const existing = await readHistory();
  await chrome.storage.local.set({ [STORAGE.historyKey]: existing.filter((entry) => entry.id !== id) });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(STORAGE.historyKey);
}

export function onHistoryChanged(listener: (items: AnalysisHistoryItem[]) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area !== 'local') return;
    const change = changes[STORAGE.historyKey];
    if (!change) return;
    listener(Array.isArray(change.newValue) ? change.newValue.filter(isHistoryItem) : []);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/**
 * Read-side migration for entries written before `MotionAnalysis.id` existed.
 *
 * The entry id has always been the analysis id — it is what the frames were
 * stored under — so an older entry is repaired rather than discarded. Doing it
 * on read keeps one code path: nothing downstream has to ask how old an entry
 * is, and no rewrite of the whole library is needed on upgrade.
 */
function withAnalysisId(item: AnalysisHistoryItem): AnalysisHistoryItem {
  if (item.analysis.id) return item;
  return { ...item, analysis: { ...item.analysis, id: item.id } };
}

export function isHistoryItem(value: unknown): value is AnalysisHistoryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<AnalysisHistoryItem>;
  return (
    typeof item.id === 'string' &&
    typeof item.analyzedAt === 'number' &&
    typeof item.title === 'string' &&
    typeof item.duration === 'number' &&
    typeof item.eventCount === 'number' &&
    typeof item.analysis === 'object' &&
    item.analysis !== null &&
    Array.isArray((item.analysis as { events?: unknown }).events)
  );
}
