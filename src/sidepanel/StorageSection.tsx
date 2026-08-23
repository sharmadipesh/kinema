import { useCallback, useEffect, useState } from 'react';
import { clearFrames } from '../storage/frame-store.ts';
import { clearHistory, readHistory } from '../storage/history.ts';
import { projectStorageBytes, sweepOrphanedProjects } from '../storage/project.ts';
import { APP_NAME } from '../config.ts';

/**
 * What is stored, and how to get rid of it.
 *
 * A product that asks people to keep analysing their own work owes them a
 * legible answer to "what have you kept". Three stores hold pieces of one
 * analysis — the entry in `storage.local`, its frames in IndexedDB, and the
 * user's own edits under a project key — and until now only two of them could
 * be cleared from here, so hand edits outlived everything they belonged to.
 *
 * The orphan sweep is separate from the clear-everything button on purpose:
 * eviction is silent (the library is capped at 40 while frames hold 24), so
 * records can be orphaned without the user deleting anything.
 */
export function StorageSection() {
  const [summary, setSummary] = useState<{ analyses: number; projectBytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void Promise.all([readHistory(), projectStorageBytes()]).then(([history, projectBytes]) =>
      setSummary({ analyses: history.length, projectBytes }),
    );
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    if (!note) return undefined;
    const timer = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(timer);
  }, [note]);

  const sweep = useCallback(() => {
    setBusy(true);
    void readHistory()
      .then((history) => sweepOrphanedProjects(history.map((entry) => entry.id)))
      .then((removed) => {
        setNote(removed === 0 ? 'Nothing orphaned — everything stored belongs to an analysis.' : `Removed ${removed} orphaned record${removed === 1 ? '' : 's'}.`);
        refresh();
      })
      .finally(() => setBusy(false));
  }, [refresh]);

  const clearAll = useCallback(() => {
    setBusy(true);
    void Promise.all([clearHistory(), clearFrames()])
      .then(() => sweepOrphanedProjects([]))
      .then(() => {
        setNote('History, frames and your edits were deleted.');
        refresh();
      })
      .finally(() => setBusy(false));
  }, [refresh]);

  return (
    <div className="space-y-2">
      {summary ? (
        <dl className="space-y-0.5">
          <Row label="Saved analyses" value={`${summary.analyses}`} />
          <Row label="Your edits and briefs" value={formatBytes(summary.projectBytes)} />
          <Row label="Evidence frames" value="IndexedDB, 24 analyses kept" />
        </dl>
      ) : null}

      <p className="text-2xs leading-relaxed text-ink-subtle">
        Analyses, frames and your edits are stored on this device and never synced. During an analysis a small number of
        sampled frames are sent to OpenAI with your own key — the video file itself never is. Your key is stored
        separately and is never included in an export.
      </p>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={sweep}
          className="rounded-sm border border-line bg-surface-raised px-2 py-1 text-xs text-ink transition-colors hover:bg-[var(--mi-hover)] disabled:opacity-40"
        >
          Remove orphaned data
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={clearAll}
          className="rounded-sm border border-line bg-surface-raised px-2 py-1 text-xs text-critical transition-colors hover:bg-[var(--mi-hover)] disabled:opacity-40"
        >
          Delete everything
        </button>
      </div>

      {/*
        Said before the button is pressed, not after. Export lives on the Story
        board, and someone about to clear the library should know that is where
        to save it from.
      */}
      <p className="text-2xs leading-relaxed text-ink-subtle">
        Deleting is immediate and cannot be undone. To keep a board first, use Export on the Story tab.
      </p>

      {note ? (
        <p aria-live="polite" className="text-2xs text-accent">
          {note}
        </p>
      ) : null}

      <p className="text-2xs leading-relaxed text-ink-subtle">
        {APP_NAME} keeps the 40 most recent analyses. Frames for the 24 most recent are retained; older boards show a
        stated reason where a frame used to be rather than a blank space.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="tabular text-xs text-ink">{value}</dd>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
