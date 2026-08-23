import { deriveReadiness, readinessSummary } from '../../analysis/readiness.ts';
import { CheckIcon } from '../../components/Icons.tsx';
import type { MotionAnalysis } from '../../types/motion.ts';

/**
 * Whether there is enough here to go and make something.
 *
 * A row ticks only when the thing it names actually exists. A reassuring tick
 * next to "Camera plan" when no camera plan was produced is the sort of thing
 * that wastes an afternoon, so an unmet row says so plainly and offers the jump
 * to the section that would hold it.
 */
export function ReadinessCheck({
  analysis,
  onJump,
}: {
  analysis: MotionAnalysis;
  onJump(tab: 'overview' | 'story' | 'create' | 'edit'): void;
}) {
  const items = deriveReadiness(analysis);
  const { ready, total } = readinessSummary(items);

  return (
    <details className="rounded-md border border-line bg-surface-raised">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-2 text-2xs font-semibold uppercase tracking-wide text-ink-subtle marker:hidden">
        Ready to recreate this?
        <span className={['tabular ml-auto', ready === total ? 'text-accent' : 'text-ink-subtle'].join(' ')}>
          {ready}/{total}
        </span>
        <span aria-hidden="true" className="text-ink-subtle">
          ▾
        </span>
      </summary>

      <ul className="space-y-0.5 border-t border-line px-2 py-2">
        {items.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              onClick={() => item.tab && onJump(item.tab)}
              disabled={!item.tab}
              className="flex w-full items-baseline gap-2 rounded-xs px-1.5 py-1 text-left transition-colors hover:bg-[var(--mi-hover)] disabled:pointer-events-none"
            >
              <span className="mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center">
                {item.ready ? (
                  <CheckIcon size={11} className="text-accent" />
                ) : (
                  <span className="h-[7px] w-[7px] rounded-pill border border-line-strong" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={['block text-xs', item.ready ? 'text-ink' : 'text-ink-muted'].join(' ')}>
                  {item.label}
                </span>
                <span className="block text-2xs text-ink-subtle">{item.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
