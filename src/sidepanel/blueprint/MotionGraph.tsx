import { formatPreciseTime } from '../../utils/time.ts';

/**
 * The velocity curve around one event.
 *
 * Drawn from the fine pass's actual samples, which were being computed and then
 * discarded. Deliberately unlabelled on the vertical axis: the underlying
 * figure is displacement per second at analysis resolution, which is a real
 * measurement but not one that means anything to a person in absolute terms.
 * The shape is the information — where movement builds, where it peaks, whether
 * it survives the cut — and a printed number would invite it to be read as
 * something it is not.
 */
export function MotionGraph({
  curve,
  boundaryTime,
}: {
  curve: Array<{ time: number; velocity: number }>;
  boundaryTime?: number;
}) {
  if (curve.length < 3) return null;

  const peak = Math.max(...curve.map((point) => point.velocity));
  if (peak <= 0) return null;

  const start = curve[0]?.time ?? 0;
  const end = curve[curve.length - 1]?.time ?? start;
  const span = Math.max(0.001, end - start);
  const peakPoint = curve.reduce((best, point) => (point.velocity > best.velocity ? point : best), curve[0]!);

  return (
    <section aria-label="Movement over time">
      <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Movement</h3>

      <div className="relative flex h-12 items-end gap-[2px]" role="img" aria-label="Relative movement speed across the event">
        {curve.map((point) => {
          const isPeak = point.time === peakPoint.time;
          return (
            <div
              key={point.time}
              className={['flex-1 rounded-t-[1px]', isPeak ? 'bg-accent' : 'bg-[var(--mi-track)]'].join(' ')}
              style={{ height: `${Math.max(4, (point.velocity / peak) * 100)}%` }}
              title={`${formatPreciseTime(point.time)}`}
            />
          );
        })}

        {/* Where the shot actually changes, against where movement peaks. The
            gap between the two is what separates a whip pan from a fast pan
            next to a cut. */}
        {boundaryTime !== undefined && boundaryTime >= start && boundaryTime <= end ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 w-px bg-critical"
            style={{ left: `${(((boundaryTime - start) / span) * 100).toFixed(2)}%` }}
          />
        ) : null}
      </div>

      <div className="mt-1 flex justify-between text-2xs tabular text-ink-subtle">
        <span>{formatPreciseTime(start)}</span>
        <span className="text-accent">peak {formatPreciseTime(peakPoint.time)}</span>
        <span>{formatPreciseTime(end)}</span>
      </div>
      <p className="mt-1 text-2xs leading-relaxed text-ink-subtle">
        Relative movement speed across the sampled window
        {boundaryTime !== undefined ? '. The red line marks where the shot changes.' : '.'}
      </p>
    </section>
  );
}
