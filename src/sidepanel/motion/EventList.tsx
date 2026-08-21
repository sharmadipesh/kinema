import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_LABELS, type MotionCategory, type MotionEvent } from '../../types/motion.ts';
import { SearchIcon } from '../../components/Icons.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { EventCard } from './EventCard.tsx';

type Filter = MotionCategory | 'all';

/**
 * Search, filters and the event list.
 *
 * Rendering is windowed rather than virtualised: a fixed slice grows as the
 * user scrolls. A hundred-event analysis is realistic; a thousand is not, and a
 * virtualisation library to serve the difference would cost more than it saves
 * — this keeps the DOM small without taking on a dependency or breaking
 * find-in-page for the common case.
 */
const PAGE = 25;

export function EventList({
  events,
  activeEventId,
  onOpen,
  onJump,
}: {
  events: MotionEvent[];
  activeEventId: string | null;
  onOpen(event: MotionEvent): void;
  onJump(event: MotionEvent): void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  const available = useMemo(() => {
    const present = new Set(events.map((event) => event.category));
    return (['all', ...present] as Filter[]).map((value) => ({
      value,
      label: value === 'all' ? 'All' : CATEGORY_LABELS[value],
      count: value === 'all' ? events.length : events.filter((event) => event.category === value).length,
    }));
  }, [events]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      if (filter !== 'all' && event.category !== filter) return false;
      if (!needle) return true;
      return [event.title, event.description, event.type, event.category, ...(event.effects ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [events, query, filter]);

  useEffect(() => setLimit(PAGE), [query, filter]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setLimit((value) => value + PAGE);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section aria-label="Detected events">
      <div className="relative mb-2">
        <SearchIcon size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-subtle" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search events…"
          aria-label="Search events"
          className="w-full rounded-sm border border-line bg-surface-sunken py-1.5 pl-7 pr-2 text-sm text-ink placeholder:text-ink-subtle focus:border-line-strong focus:outline-none"
        />
      </div>

      {available.length > 2 ? (
        <div className="mb-2.5">
          <Segmented<Filter>
            label="Filter events by category"
            value={filter}
            options={available}
            onChange={setFilter}
            scrollable
          />
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-ink-subtle">
          {query.trim() ? `Nothing matches "${query.trim()}".` : 'No events in this category.'}
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {filtered.slice(0, limit).map((event) => (
              <EventCard
                key={event.id}
                event={event}
                active={event.id === activeEventId}
                onOpen={() => onOpen(event)}
                onJump={() => onJump(event)}
              />
            ))}
          </ul>
          {filtered.length > limit ? <div ref={sentinel} className="h-8" aria-hidden="true" /> : null}
        </>
      )}
    </section>
  );
}
