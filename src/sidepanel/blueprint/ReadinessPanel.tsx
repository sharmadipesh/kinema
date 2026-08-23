import { useMemo, useState } from 'react';
import { CheckIcon } from '../../components/Icons.tsx';
import {
  PHASE_LABELS,
  VERDICT_LABELS,
  type ReadinessAction,
  type ReadinessPhase,
  type ReadinessState,
  type RecreationReadiness,
  type RecreationReadinessItem,
} from '../../types/readiness.ts';

/**
 * Can this actually be recreated, and what is the one thing to do next.
 *
 * Deliberately *not* an accordion in the technical stack at the bottom of
 * Overview, which is where the old counter lived. The most product-shaped
 * decision in the panel was two clicks below a list of frame statistics, and
 * the verdict it showed — `9/9` — was reassuring and wrong. This sits directly
 * under the tabs, stays visible on every one of them, and shows the verdict and
 * the next action without being opened.
 *
 * Status is never carried by colour alone: every row has a glyph, a word, and a
 * sentence. At 320px in a dark panel, hue is the first thing to go.
 */

const STATE_LABELS: Record<ReadinessState, string> = {
  ready: 'Ready',
  needs_input: 'Needs input',
  warning: 'Warning',
  blocked: 'Blocked',
  optional: 'Optional',
  unavailable: 'Unavailable',
};

/** Glyph carries the state for anyone who cannot use the colour. */
const STATE_GLYPHS: Record<ReadinessState, string> = {
  ready: '✓',
  needs_input: '?',
  warning: '!',
  blocked: '×',
  optional: '·',
  unavailable: '–',
};

const STATE_TONE: Record<ReadinessState, string> = {
  ready: 'text-accent',
  needs_input: 'text-ink',
  warning: 'text-caution',
  blocked: 'text-critical',
  optional: 'text-ink-subtle',
  unavailable: 'text-ink-subtle',
};

const PHASE_ORDER: ReadinessPhase[] = ['analysis', 'story', 'production', 'footage', 'edit', 'audio', 'delivery'];

export function ReadinessPanel({
  readiness,
  onAction,
}: {
  readiness: RecreationReadiness;
  onAction(action: ReadinessAction): void;
}) {
  const [open, setOpen] = useState(false);
  const { summary, items } = readiness;

  const grouped = useMemo(() => {
    const map = new Map<ReadinessPhase, RecreationReadinessItem[]>();
    for (const phase of PHASE_ORDER) {
      const rows = items.filter((entry) => entry.phase === phase);
      if (rows.length > 0) map.set(phase, rows);
    }
    return map;
  }, [items]);

  const tone =
    summary.verdict === 'blocked'
      ? 'border-[var(--mi-critical)]'
      : summary.verdict === 'needs_decisions'
        ? 'border-line-strong'
        : 'border-[var(--mi-accent)]';

  return (
    <section aria-label="Recreation readiness" className={`rounded-md border bg-surface-raised ${tone}`}>
      <div className="px-2.5 pb-2 pt-2">
        <div className="flex items-baseline gap-1.5">
          <h2 className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Recreation readiness</h2>
          <span
            className={`text-2xs font-semibold ${summary.verdict === 'blocked' ? 'text-critical' : summary.verdict === 'needs_decisions' ? 'text-ink' : 'text-accent'}`}
          >
            {VERDICT_LABELS[summary.verdict]}
          </span>
        </div>

        {/* The sentence, not the score. `8/9` hides the one item that matters. */}
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">{summary.headline}</p>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {summary.nextAction ? (
            <button
              type="button"
              onClick={() => onAction(summary.nextAction!)}
              className="rounded-sm bg-surface-inverse px-2 py-1 text-2xs font-medium text-ink-inverse transition-opacity hover:opacity-90"
            >
              Next: {summary.nextAction.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            className="rounded-sm border border-line px-2 py-1 text-2xs text-ink-muted transition-colors hover:bg-[var(--mi-hover)] hover:text-ink"
          >
            {open ? 'Hide detail' : `Review ${countLabel(summary)}`}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-line px-2 py-2">
          {[...grouped].map(([phase, rows]) => (
            <div key={phase} className="mb-2 last:mb-0">
              <h3 className="px-1.5 pb-1 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                {PHASE_LABELS[phase]}
              </h3>
              <ul className="space-y-0.5">
                {rows.map((row) => (
                  <Row key={row.id} item={row} onAction={onAction} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Row({ item, onAction }: { item: RecreationReadinessItem; onAction(action: ReadinessAction): void }) {
  return (
    <li className="rounded-xs px-1.5 py-1">
      <div className="flex items-baseline gap-1.5">
        <span aria-hidden="true" className={`w-3 shrink-0 text-center text-2xs font-semibold ${STATE_TONE[item.state]}`}>
          {STATE_GLYPHS[item.state]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-xs font-medium text-ink">{item.title}</span>
            {/* The word, so the glyph and the colour are never the only signal. */}
            <span className={`text-2xs ${STATE_TONE[item.state]}`}>{STATE_LABELS[item.state]}</span>
            {!item.automaticallyEvaluated ? (
              <span className="text-2xs text-ink-subtle" title="Answered by you, not measured">
                · you
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-2xs leading-relaxed text-ink-muted">{item.summary}</span>
          {item.reason ? (
            <span className="mt-0.5 block text-2xs leading-relaxed text-ink-subtle">{item.reason}</span>
          ) : null}
          {item.evidence?.length ? (
            <span className="mt-0.5 block text-2xs leading-relaxed text-ink-subtle">
              {item.evidence.slice(0, 3).join(' · ')}
            </span>
          ) : null}
        </span>
      </div>
      {item.action ? (
        <div className="mt-1 pl-[18px]">
          <button
            type="button"
            onClick={() => onAction(item.action!)}
            className="rounded-xs border border-line px-1.5 py-0.5 text-2xs text-ink-muted transition-colors hover:bg-[var(--mi-hover)] hover:text-ink"
          >
            {item.action.label}
          </button>
        </div>
      ) : null}
    </li>
  );
}

/** "2 blockers" beats "9 items" — the count that matters is the one in the way. */
function countLabel(summary: RecreationReadiness['summary']): string {
  if (summary.blockers.length > 0) {
    return `${summary.blockers.length} blocker${summary.blockers.length === 1 ? '' : 's'}`;
  }
  if (summary.decisions.length > 0) {
    return `${summary.decisions.length} decision${summary.decisions.length === 1 ? '' : 's'}`;
  }
  if (summary.warnings.length > 0) {
    return `${summary.warnings.length} warning${summary.warnings.length === 1 ? '' : 's'}`;
  }
  return 'checks';
}

/** Small tick used where a row is purely informational. */
export function ReadyTick() {
  return <CheckIcon size={11} className="text-accent" />;
}
