import type { EventObservation } from '../../types/motion.ts';

/**
 * Before → build → peak → after, as prose.
 *
 * Laid out as a vertical progression rather than four labelled fields, because
 * the thing being communicated is a sequence in time and the shape of the
 * component should say so before any of the words are read. Phases the model
 * could not describe are absent rather than empty — silence is information.
 */
export function Progression({ observation }: { observation: EventObservation }) {
  const phases: Array<[string, string]> = (
    [
      ['Before', observation.before],
      ['Build', observation.build],
      ['Peak', observation.peak],
      ['After', observation.after],
    ] as Array<[string, string | undefined]>
  ).flatMap(([label, body]) => (body ? [[label, body] as [string, string]] : []));

  if (phases.length === 0) return null;

  return (
    <section aria-label="What happens">
      <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">What happens</h3>
      <ol className="space-y-2">
        {phases.map(([label, body], index) => (
          <li key={label} className="relative pl-4">
            {index < phases.length - 1 ? (
              <span aria-hidden="true" className="absolute left-[3px] top-3 h-full w-px bg-[var(--mi-track)]" />
            ) : null}
            <span
              aria-hidden="true"
              className={[
                'absolute left-0 top-[5px] h-[7px] w-[7px] rounded-pill',
                label === 'Peak' ? 'bg-accent' : 'bg-[var(--mi-track)]',
              ].join(' ')}
            />
            <span className="block text-2xs font-semibold uppercase tracking-wide text-ink-subtle">{label}</span>
            <p className="mt-0.5 text-xs leading-relaxed text-ink">{body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
