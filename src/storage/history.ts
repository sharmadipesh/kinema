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
    return raw.filter(isHistoryItem).slice(0, STORAGE.maxHistoryItems);
  } catch (error) {
    log.warn('history read failed', { error: String(error) });
    return [];
  }
}

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

  await chrome.storage.local.set({ [STORAGE.historyKey]: next });
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
