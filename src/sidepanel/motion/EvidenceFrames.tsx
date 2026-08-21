import type { EvidenceFrame } from '../../types/analysis.ts';
import { formatPreciseTime } from '../../utils/time.ts';

/**
 * Before / during / after.
 *
 * This is the part that makes the analysis checkable rather than merely
 * plausible: three frames the user can look at and decide for themselves
 * whether the label is right. Frames are lazy-decoded and come straight from
 * IndexedDB, so a long history does not pin megabytes in memory.
 */
export function EvidenceFrames({ frames }: { frames: EvidenceFrame[] }) {
  const ordered = (['before', 'during', 'after'] as const)
    .map((role) => frames.find((frame) => frame.role === role))
    .filter((frame): frame is EvidenceFrame => Boolean(frame));

  if (ordered.length === 0) return null;

  return (
    <section aria-label="Evidence frames">
      <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Visual change</h3>
      <div className="grid grid-cols-3 gap-1">
        {ordered.map((frame) => (
          <figure key={frame.id} className="min-w-0">
            <img
              src={frame.dataUrl}
              alt={`Frame at ${formatPreciseTime(frame.time)}`}
              loading="lazy"
              decoding="async"
              className="aspect-video w-full rounded-xs border border-line object-cover"
            />
            <figcaption className="mt-1 truncate text-2xs capitalize text-ink-subtle">
              {frame.role}
              <span className="ml-1 tabular text-ink-subtle/70">{formatPreciseTime(frame.time)}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
