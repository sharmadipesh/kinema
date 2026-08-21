import { useEffect, useMemo, useRef, useState } from 'react';
import type { PanelEvent } from '../../../types/messages.ts';
import type { MotionEvent } from '../../../types/motion.ts';
import { formatClock } from '../../../utils/time.ts';
import { layoutLabels, type LabelCandidate } from './layout.ts';
import { Playhead } from './Playhead.tsx';

/**
 * The timeline.
 *
 * Everything else in the product is a list; this is the instrument. It has to
 * stay legible from 320px, hold a hundred events without becoming a smear, and
 * never imply a precision the analysis does not have.
 *
 * Three decisions carry most of that:
 *  - Markers are always drawn, labels are rationed by collision (see layout.ts).
 *  - Events that measurably spanned a range are drawn as bars; instantaneous
 *    ones as ticks. The shape is the claim.
 *  - The playhead owns its own DOM node and never re-renders this component.
 */
export function Timeline({
  duration,
  events,
  activeEventId,
  selectedEventId,
  videoId,
  initialTime,
  subscribe,
  onSelect,
}: {
  duration: number;
  events: MotionEvent[];
  activeEventId: string | null;
  selectedEventId: string | null;
  videoId: string | null;
  initialTime: number;
  subscribe(listener: (event: PanelEvent) => void): () => void;
  onSelect(event: MotionEvent): void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = track.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const positioned = useMemo(
    () =>
      events.map((event) => ({
        event,
        start: duration > 0 ? Math.min(1, Math.max(0, event.startTime / duration)) : 0,
        end:
          event.endTime !== undefined && duration > 0
            ? Math.min(1, Math.max(0, event.endTime / duration))
            : null,
      })),
    [events, duration],
  );

  const labels = useMemo(() => {
    const candidates: LabelCandidate[] = positioned.map(({ event, start }) => ({
      id: event.id,
      position: start,
      label: shortLabel(event),
      // The selected event always wins its space; after that, confidence
      // decides, so the strongest reading is the one that keeps its name.
      priority: (event.id === selectedEventId ? 10 : 0) + (event.id === activeEventId ? 5 : 0) + event.confidence,
    }));
    return layoutLabels(candidates, width);
  }, [positioned, width, selectedEventId, activeEventId]);

  return (
    <div className="select-none">
      <div className="mb-1 flex items-baseline justify-between text-2xs tabular text-ink-subtle">
        <span>{formatClock(0)}</span>
        <span>{formatClock(duration)}</span>
      </div>

      <div ref={track} className="relative h-10 rounded-sm bg-surface-sunken">
        <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--mi-track)]" />

        {positioned.map(({ event, start, end }) => {
          const active = event.id === activeEventId;
          const selected = event.id === selectedEventId;
          const spanning = end !== null && end - start > 0.004;

          return (
            <button
              key={event.id}
              type="button"
              onClick={() => onSelect(event)}
              aria-label={`${formatClock(event.startTime)} ${event.title}`}
              aria-pressed={selected}
              title={`${formatClock(event.startTime)} · ${event.title}`}
              className="group absolute inset-y-0 z-10 -ml-2 w-4 cursor-pointer"
              style={{ left: `${(start * 100).toFixed(3)}%` }}
            >
              {spanning ? (
                <span
                  className={[
                    'absolute top-1/2 h-[7px] -translate-y-1/2 rounded-pill transition-colors duration-fast',
                    selected || active ? 'bg-accent' : 'bg-ink-subtle group-hover:bg-ink-muted',
                  ].join(' ')}
                  style={{ left: '8px', width: `${Math.max(4, (end - start) * width).toFixed(1)}px` }}
                />
              ) : null}
              <span
                className={[
                  'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-pill transition-all duration-fast',
                  selected || active ? 'h-[9px] w-[9px] bg-accent' : 'h-[6px] w-[6px] bg-ink-subtle group-hover:bg-ink',
                  selected ? 'ring-2 ring-[var(--mi-accent-soft)]' : '',
                ].join(' ')}
              />
            </button>
          );
        })}

        <Playhead
          duration={duration}
          trackWidth={width}
          videoId={videoId}
          subscribe={subscribe}
          initialTime={initialTime}
        />
      </div>

      {/*
        Labels sit outside the track so a long one cannot inflate its height,
        and the row clips. A Chrome side panel is resizable by drag, and there
        is a frame between the drag and the ResizeObserver delivering the new
        width — long enough for a label positioned against the old measurement
        to hang past the edge. Clipping makes that invisible instead of ugly.
      */}
      <div className="relative mt-1 h-3.5 overflow-hidden" aria-hidden="true">
        {labels.map((label) => {
          const highlighted = label.id === selectedEventId || label.id === activeEventId;
          return (
            <span
              key={label.id}
              className={[
                'absolute top-0 truncate text-2xs leading-[14px]',
                highlighted ? 'text-ink' : 'text-ink-subtle',
              ].join(' ')}
              style={{ left: `${label.left}px`, maxWidth: `${label.width}px` }}
            >
              {label.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Timeline labels are a glance, not a sentence: two words at most. */
function shortLabel(event: MotionEvent): string {
  return event.title.replace(/^likely\s+/i, '').split(/\s+/).slice(0, 2).join(' ');
}
