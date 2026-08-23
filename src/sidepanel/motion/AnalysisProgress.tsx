import { CheckIcon, SpinnerIcon } from '../../components/Icons.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { PROGRESS_STAGES, STAGE_LABELS, type AnalysisSession } from '../../types/motion.ts';
import { formatElapsed, type AnalysisHealth } from '../../hooks/useAnalysisHealth.ts';

/**
 * Real stages, not a fake percentage.
 *
 * Every line here is a position the orchestrator actually occupies. There is no
 * timer advancing a bar toward a number nobody can compute — the pipeline's
 * duration genuinely is not knowable in advance, and pretending otherwise is
 * the specific dishonesty this component exists to avoid.
 */
export function AnalysisProgress({
  session,
  health,
  onCancel,
  onRetryStage,
}: {
  session: AnalysisSession;
  health: AnalysisHealth;
  onCancel(): void;
  onRetryStage(): void;
}) {
  const currentIndex = PROGRESS_STAGES.indexOf(session.status as (typeof PROGRESS_STAGES)[number]);
  const done = session.completedStages.length;

  return (
    <section aria-label="Analysis progress" aria-live="polite">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-ink">Analysing video</h2>
        {/* Elapsed only. A "time remaining" would have to be invented: the
            pipeline's cost depends on how many candidates the video turns out
            to contain, which is not known until it contains them. */}
        <span className="tabular shrink-0 text-2xs text-ink-subtle">{formatElapsed(health.elapsedMs)} elapsed</span>
      </div>
      <p className="mt-0.5 truncate text-xs text-ink-subtle">{session.label}</p>
      {done > 0 ? (
        <p className="tabular mt-0.5 text-2xs text-ink-subtle">
          {done} of {PROGRESS_STAGES.length} stages complete
        </p>
      ) : null}

      {health.state === 'stalled' ? (
        <div className="mt-2.5 rounded-md border border-line bg-surface-raised p-2.5" role="status">
          <p className="text-sm font-medium text-ink">Analysis paused unexpectedly</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            KINEMA has not heard from the analysis process for a while. This usually means Chrome suspended the
            extension in the background.
            {session.resumable ? ' Your completed local analysis is safe.' : ''}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {session.resumable ? (
              <Button variant="primary" size="sm" onClick={onRetryStage}>
                Resume analysis
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Stop
            </Button>
          </div>
        </div>
      ) : health.state === 'slow' ? (
        <p className="mt-2 rounded-sm bg-surface-sunken px-2 py-1.5 text-2xs leading-relaxed text-ink-muted">
          Still analysing. This stage is taking longer than usual — complex sequences mean more frames to inspect.
        </p>
      ) : null}

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

      <div className="mt-3.5 flex items-center gap-1.5">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel analysis
        </Button>
        {session.retries > 0 ? (
          <span className="text-2xs text-ink-subtle">retry {session.retries}</span>
        ) : null}
      </div>
    </section>
  );
}
