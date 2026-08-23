import type { EvidenceFrame } from '../../types/analysis.ts';
import { formatPreciseTime } from '../../utils/time.ts';

/**
 * The temporal evidence strip.
 *
 * Three frames could show that something changed. They could not show how it
 * developed, where it peaked, or whether movement survived the cut — which is
 * why the product could previously say "a whip pan happened" and never "the cut
 * lands just after maximum movement". This is that sequence, and it is the part
 * of the detail view a sceptical editor can actually check.
 *
 * Scrolls inside its own box: the panel is 320px and a five-frame strip is not.
 */
export function Filmstrip({
  frames,
  peakTime,
  onSeek,
}: {
  frames: EvidenceFrame[];
  peakTime?: number;
  onSeek(time: number): void;
}) {
  if (frames.length === 0) return null;

  const ordered = [...frames].sort((a, b) => a.order - b.order);
  // Nearest sampled frame to the measured peak, rather than whichever frame
  // happens to carry the 'peak' role — the strip is planned around a predicted
  // peak and the seek may have landed elsewhere.
  const peakFrame =
    peakTime === undefined
      ? ordered.find((frame) => frame.role === 'peak')
      : ordered.reduce((best, frame) =>
          Math.abs(frame.time - peakTime) < Math.abs(best.time - peakTime) ? frame : best,
        );

  return (
    <section aria-label="Frame progression">
      <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Frame progression</h3>
      <div className="mi-scroll-x -mx-0.5 flex gap-1 px-0.5 pb-1">
        {ordered.map((frame) => {
          const isPeak = frame.id === peakFrame?.id;
          return (
            <button
              key={frame.id}
              type="button"
              onClick={() => onSeek(frame.time)}
              className="group w-[86px] shrink-0 text-left"
              aria-label={`Jump to ${formatPreciseTime(frame.time)}`}
            >
              <img
                src={frame.dataUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className={[
                  'aspect-video w-full rounded-xs border object-cover transition-colors',
                  isPeak ? 'border-[var(--mi-accent)]' : 'border-line group-hover:border-line-strong',
                ].join(' ')}
              />
              <span className="mt-1 block truncate text-2xs tabular text-ink-subtle">
                {formatPreciseTime(frame.time)}
              </span>
              <span
                className={[
                  'block truncate text-2xs capitalize',
                  isPeak ? 'text-accent' : 'text-ink-subtle/70',
                ].join(' ')}
              >
                {isPeak ? 'peak' : frame.role}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
