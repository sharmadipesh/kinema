import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../components/EmptyState.tsx';
import { FilmIcon, SearchIcon, TrashIcon } from '../components/Icons.tsx';
import { deleteFrames } from '../storage/frame-store.ts';
import { onHistoryChanged, readHistory, removeHistoryItem } from '../storage/history.ts';
import type { AnalysisHistoryItem } from '../types/domain.ts';
import { formatClock, relativeTime } from '../utils/time.ts';

/**
 * Past analyses.
 *
 * An entry exists here because the user pressed Analyse — never because they
 * watched something. Deleting one removes its evidence frames too, so "delete"
 * means the thing it says rather than leaving a megabyte of JPEGs orphaned in
 * IndexedDB.
 */
export function HistoryScreen({ onOpen }: { onOpen(item: AnalysisHistoryItem): void }) {
  const [items, setItems] = useState<AnalysisHistoryItem[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void readHistory().then(setItems);
    return onHistoryChanged(setItems);
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [item.title, item.url ?? '', item.analysis.overview.summary].join(' ').toLowerCase().includes(needle),
    );
  }, [items, query]);

  const remove = async (item: AnalysisHistoryItem): Promise<void> => {
    await removeHistoryItem(item.id);
    await deleteFrames(item.id);
  };

  if (items.length === 0) {
    return (
      <div className="px-3.5 pb-4 pt-2">
        <EmptyState
          icon={<FilmIcon size={16} />}
          title="No analyses yet"
          body="Analyses you run are kept here on this device, so you can reopen a timeline without paying for it twice."
        />
      </div>
    );
  }

  return (
    <div className="px-3.5 pb-4 pt-2">
      <div className="relative mb-2">
        <SearchIcon size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-subtle" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search analyses…"
          aria-label="Search analyses"
          className="w-full rounded-sm border border-line bg-surface-sunken py-1.5 pl-7 pr-2 text-sm text-ink placeholder:text-ink-subtle focus:border-line-strong focus:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-ink-subtle">Nothing matches “{query.trim()}”.</p>
      ) : (
        <ul className="space-y-1.5">
          {filtered.map((item) => (
            <li key={item.id} className="rounded-md border border-line bg-surface-raised">
              <button
                type="button"
                onClick={() => onOpen(item)}
                className="flex w-full items-start gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-[var(--mi-hover)]"
              >
                {item.thumbnail ? (
                  <img
                    src={item.thumbnail}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-10 w-[60px] shrink-0 rounded-xs object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-[60px] shrink-0 items-center justify-center rounded-xs bg-surface-sunken text-ink-subtle">
                    <FilmIcon size={13} />
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
                  <span className="tabular mt-0.5 block text-2xs text-ink-subtle">
                    {formatClock(item.duration)} · {item.eventCount} {item.eventCount === 1 ? 'event' : 'events'} ·{' '}
                    {relativeTime(item.analyzedAt)}
                  </span>
                </span>
              </button>

              <div className="flex items-center gap-1 border-t border-line px-2 py-1">
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="rounded-xs px-1 py-0.5 text-2xs text-ink-muted transition-colors hover:bg-[var(--mi-hover)] hover:text-ink"
                  >
                    Open source
                  </a>
                ) : (
                  <span className="px-1 py-0.5 text-2xs text-ink-subtle">Uploaded file</span>
                )}
                <button
                  type="button"
                  onClick={() => void remove(item)}
                  aria-label={`Delete analysis of ${item.title}`}
                  className="ml-auto rounded-xs p-1 text-ink-subtle transition-colors hover:bg-[var(--mi-hover)] hover:text-critical"
                >
                  <TrashIcon size={11} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
