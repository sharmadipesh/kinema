import type { FriendlyError } from '../types/domain.ts';
import { AlertIcon } from './Icons.tsx';
import { Button } from './ui/Button.tsx';

export interface ErrorStateProps {
  error: FriendlyError;
  title?: string;
  onRetry?(): void;
  onDismiss?(): void;
  /** Rendered instead of Retry for errors whose fix is elsewhere. */
  action?: { label: string; onClick(): void };
}

/**
 * Failures are explained in plain language and, wherever it makes sense, come
 * with the action that resolves them. A status code is never shown — the code
 * is carried in the payload for debugging, not for reading.
 */
export function ErrorState({ error, title = 'Analysis failed', onRetry, onDismiss, action }: ErrorStateProps) {
  return (
    <div className="rounded-md border border-line bg-surface-raised p-3" role="alert">
      <div className="flex gap-2.5">
        <AlertIcon size={15} className="mt-px shrink-0 text-critical" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">{error.message}</p>
          {error.retryAfterSeconds && error.retryAfterSeconds > 5 ? (
            <p className="mt-1.5 text-2xs text-ink-subtle">Try again in about {formatWait(error.retryAfterSeconds)}.</p>
          ) : null}
        </div>
      </div>

      {action || (error.retryable && onRetry) || onDismiss ? (
        <div className="mt-3 flex items-center gap-1.5">
          {action ? (
            <Button variant="primary" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          ) : null}
          {!action && error.retryable && onRetry ? (
            <Button variant="primary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          {onDismiss ? (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatWait(seconds: number): string {
  if (seconds < 90) return `${Math.ceil(seconds)} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes < 60 ? `${minutes} minutes` : `${Math.ceil(minutes / 60)} hours`;
}
