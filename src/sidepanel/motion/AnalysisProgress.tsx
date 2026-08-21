import { CheckIcon, SpinnerIcon } from '../../components/Icons.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { PROGRESS_STAGES, STAGE_LABELS, type AnalysisSession } from '../../types/motion.ts';

/**
 * Real stages, not a fake percentage.
 *
 * Every line here is a position the orchestrator actually occupies. There is no
 * timer advancing a bar toward a number nobody can compute — the pipeline's
 * duration genuinely is not knowable in advance, and pretending otherwise is
 * the specific dishonesty this component exists to avoid.
 */
export function AnalysisProgress({ session, onCancel }: { session: AnalysisSession; onCancel(): void }) {
  const currentIndex = PROGRESS_STAGES.indexOf(session.status as (typeof PROGRESS_STAGES)[number]);

  return (
    <section aria-label="Analysis progress" aria-live="polite">
      <h2 className="text-sm font-medium text-ink">Analysing video</h2>
      <p className="mt-0.5 truncate text-xs text-ink-subtle">{session.label}</p>

      <ol className="mt-3 space-y-1.5">
        {PROGRESS_STAGES.map((stage, index) => {
          const done = session.completedStages.includes(stage) || (currentIndex >= 0 && index < currentIndex);
          const active = stage === session.status;

          return (
            <li key={stage} className="flex items-center gap-2 text-xs">
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {done ? (
                  <CheckIcon size={11} className="text-accent" />
                ) : active ? (
                  <SpinnerIcon size={11} className="text-accent" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-pill bg-[var(--mi-track)]" />
                )}
              </span>
              <span className={done ? 'text-ink-muted' : active ? 'font-medium text-ink' : 'text-ink-subtle'}>
                {STAGE_LABELS[stage]}
              </span>
              {active && session.detail ? (
                <span className="tabular ml-auto text-2xs text-ink-subtle">{session.detail}</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="mt-3.5">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel analysis
        </Button>
      </div>
    </section>
  );
}
