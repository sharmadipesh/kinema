import { useState } from 'react';
import { ErrorState } from '../../components/ErrorState.tsx';
import { SpinnerIcon } from '../../components/Icons.tsx';
import { Button } from '../../components/ui/Button.tsx';
import type { FriendlyError } from '../../types/domain.ts';
import {
  RECREATE_PLATFORMS,
  RECREATE_PLATFORM_LABELS,
  type RecreateGuide,
  type RecreatePlatform,
} from '../../types/motion.ts';
import { copyText } from '../../utils/clipboard.ts';

/**
 * How to recreate this specific moment.
 *
 * The request carries the measured evidence — duration, direction, magnitude,
 * the observed effects — so the answer is about this whip pan rather than whip
 * pans in general. Guides are cached per platform for the session, because
 * asking the same question twice is the user paying twice.
 */
export function RecreatePanel({
  onRequest,
  hint,
}: {
  onRequest(platform: RecreatePlatform): Promise<RecreateGuide>;
  /** One line from the analysis naming the essential thing to reproduce. */
  hint?: string;
}) {
  const [platform, setPlatform] = useState<RecreatePlatform | null>(null);
  const [cache, setCache] = useState<Partial<Record<RecreatePlatform, RecreateGuide>>>({});
  const [loading, setLoading] = useState<RecreatePlatform | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [copied, setCopied] = useState(false);

  const guide = platform ? cache[platform] : undefined;

  const select = async (next: RecreatePlatform): Promise<void> => {
    setPlatform(next);
    setError(null);
    if (cache[next]) return;

    setLoading(next);
    try {
      const result = await onRequest(next);
      setCache((current) => ({ ...current, [next]: result }));
    } catch (caught) {
      setError(caught as FriendlyError);
    } finally {
      setLoading(null);
    }
  };

  const copy = async (): Promise<void> => {
    if (!guide) return;
    const text = guide.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
    if (!(await copyText(text))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section aria-label="Recreate">
      <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
        How to recreate this
      </h3>
      {hint ? <p className="mb-2 text-xs leading-relaxed text-ink-muted">{hint}</p> : null}

      <div className="flex flex-wrap gap-1">
        {RECREATE_PLATFORMS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => void select(value)}
            aria-pressed={platform === value}
            className={[
              'rounded-sm border px-2 py-1 text-2xs font-medium transition-colors duration-fast',
              platform === value
                ? 'border-[var(--mi-accent)] bg-[var(--mi-accent-soft)] text-accent'
                : 'border-line bg-surface-raised text-ink-muted hover:text-ink',
            ].join(' ')}
          >
            {RECREATE_PLATFORM_LABELS[value]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-2.5 flex items-center gap-2 text-xs text-ink-muted">
          <SpinnerIcon size={12} />
          Writing steps for {RECREATE_PLATFORM_LABELS[loading]}…
        </p>
      ) : null}

      {error && platform ? (
        <div className="mt-2.5">
          <ErrorState
            error={error}
            title="Couldn't write the steps"
            onRetry={() => void select(platform)}
            onDismiss={() => setError(null)}
          />
        </div>
      ) : null}

      {guide && !loading ? (
        <div className="mt-2.5 rounded-md border border-line bg-surface-raised p-2.5">
          {guide.technique ? (
            <p className="mb-2 text-xs font-medium text-ink">{guide.technique}</p>
          ) : null}

          {/* Timing first: the numbers are what make these steps about THIS
              video rather than about the technique in the abstract. */}
          {guide.timing.length > 0 ? (
            <dl className="mb-2.5 space-y-0.5 border-b border-line pb-2.5">
              {guide.timing.map((entry) => (
                <div key={entry.label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-2xs text-ink-subtle">{entry.label}</dt>
                  <dd className="tabular text-2xs text-ink">{entry.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <ol className="space-y-1.5">
            {guide.steps.map((step, index) => (
              <li key={step} className="flex gap-2 text-xs leading-relaxed text-ink">
                <span className="tabular w-3.5 shrink-0 text-ink-subtle">{index + 1}.</span>
                <span className="min-w-0">{step}</span>
              </li>
            ))}
          </ol>

          {guide.whyThisMatches ? (
            <div className="mt-2.5 border-t border-line pt-2">
              <h4 className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Why this matches</h4>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{guide.whyThisMatches}</p>
            </div>
          ) : null}

          {guide.caveat ? (
            <p className="mt-2.5 border-t border-line pt-2 text-2xs leading-relaxed text-ink-subtle">
              {guide.caveat}
            </p>
          ) : null}

          {/* Said plainly, every time. The timings are inferred from a sampler
              that resolves to tens of milliseconds, not counted from frames. */}
          <p className="mt-2 text-2xs leading-relaxed text-ink-subtle">
            Values are approximate — KINEMA inferred them from the video.
          </p>

          <div className="mt-2.5">
            <Button variant="ghost" size="sm" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy steps'}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
