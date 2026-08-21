import { CATEGORY_LABELS, type MotionEvent } from '../../types/motion.ts';
import { formatPreciseTime } from '../../utils/time.ts';
import { ChevronIcon, PlayIcon } from '../../components/Icons.tsx';

/**
 * One event, compact enough that four fit above the fold at 320px.
 *
 * The whole card is the button — clicking anywhere opens the detail — with the
 * jump control nested as its own control, because "show me more about this" and
 * "take the video there" are different intents and both are common.
 */
export function EventCard({
  event,
  active,
  onOpen,
  onJump,
}: {
  event: MotionEvent;
  active: boolean;
  onOpen(): void;
  onJump(): void;
}) {
  return (
    <li>
      <div
        className={[
          'rounded-md border transition-colors duration-fast',
          active ? 'border-[var(--mi-accent)] bg-[var(--mi-accent-soft)]' : 'border-line bg-surface-raised',
        ].join(' ')}
      >
        <button
          type="button"
          onClick={onOpen}
          className="w-full rounded-md px-2.5 py-2 text-left hover:bg-[var(--mi-hover)]"
        >
          <span className="flex items-center gap-1.5">
            <span className="tabular text-2xs font-medium text-accent">{formatPreciseTime(event.startTime)}</span>
            <span className="text-2xs text-ink-subtle">{CATEGORY_LABELS[event.category]}</span>
            {event.certainty === 'likely' ? (
              <span className="text-2xs text-ink-subtle" title="Inferred from weaker evidence">
                · inferred
              </span>
            ) : null}
            <span className="ml-auto tabular text-2xs text-ink-subtle">{Math.round(event.confidence * 100)}%</span>
            <ChevronIcon size={11} className="shrink-0 text-ink-subtle" />
          </span>

          <span className="mt-1 block text-sm font-medium leading-snug text-ink">{event.title}</span>
          <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-ink-muted">{event.description}</span>

          {event.effects?.length ? (
            <span className="mt-1.5 block truncate text-2xs text-ink-subtle">{event.effects.join(' · ')}</span>
          ) : null}
        </button>

        <div className="border-t border-line px-2.5 py-1">
          <button
            type="button"
            onClick={onJump}
            className="inline-flex items-center gap-1.5 rounded-xs px-1 py-0.5 text-2xs font-medium text-ink-muted transition-colors hover:bg-[var(--mi-hover)] hover:text-ink"
          >
            <PlayIcon size={9} />
            Jump to timestamp
          </button>
        </div>
      </div>
    </li>
  );
}
