import { useEffect, useState } from 'react';
import type { EvidenceFrame } from '../../types/analysis.ts';
import type { MotionAnalysis } from '../../types/motion.ts';
import type { ProjectRecord } from '../../types/project.ts';
import { dateStamp, downloadFile, safeName } from '../../utils/download.ts';
import { copyText } from '../../utils/clipboard.ts';
import {
  boardMarkdownWithEdits,
  briefMarkdown,
  contactSheetHtml,
  cutListCsv,
  footageCsv,
  handoffJson,
  type HandoffContext,
} from './handoff.ts';

/**
 * The handoff pack.
 *
 * Clipboard only gets a workflow so far — a cut list belongs in a spreadsheet
 * and a contact sheet belongs on a printer, and neither survives being pasted.
 * Files are written with an object URL and an anchor rather than the
 * `downloads` permission, which would be a new install-time capability on an
 * extension that currently asks for none.
 *
 * Every export reports its outcome. `navigator.clipboard` and a synthetic
 * anchor click both fail silently more often than they fail loudly, and a
 * button that looks identical either way is worse than no button.
 */

type Outcome = { id: string; ok: boolean } | null;

interface ExportEntry {
  id: string;
  label: string;
  hint: string;
  run(context: HandoffContext): boolean | Promise<boolean>;
}

const ENTRIES: ExportEntry[] = [
  {
    id: 'board-md',
    label: 'Story board',
    hint: 'Markdown',
    run: (context) =>
      downloadFile(fileName(context, 'board', 'md'), 'text/markdown', boardMarkdownWithEdits(context)),
  },
  {
    id: 'sheet-html',
    label: 'Contact sheet',
    hint: 'Printable HTML',
    run: (context) => downloadFile(fileName(context, 'contact-sheet', 'html'), 'text/html', contactSheetHtml(context)),
  },
  {
    id: 'cuts-csv',
    label: 'Cut list',
    hint: 'CSV',
    run: (context) => downloadFile(fileName(context, 'cuts', 'csv'), 'text/csv', cutListCsv(context)),
  },
  {
    id: 'footage-csv',
    label: 'Footage checklist',
    hint: 'CSV with your status',
    run: (context) => downloadFile(fileName(context, 'footage', 'csv'), 'text/csv', footageCsv(context)),
  },
  {
    id: 'brief-md',
    label: 'Recreation brief',
    hint: 'Markdown',
    run: (context) => downloadFile(fileName(context, 'brief', 'md'), 'text/markdown', briefMarkdown(context)),
  },
  {
    id: 'json',
    label: 'Everything',
    hint: 'JSON, for backup',
    run: (context) => downloadFile(fileName(context, 'kinema', 'json'), 'application/json', handoffJson(context)),
  },
  {
    id: 'board-copy',
    label: 'Copy board',
    hint: 'To the clipboard',
    run: (context) => copyText(boardMarkdownWithEdits(context)),
  },
];

export function ExportMenu({
  analysis,
  project,
  frames,
  title,
}: {
  analysis: MotionAnalysis;
  project: ProjectRecord;
  frames: EvidenceFrame[];
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  useEffect(() => {
    if (!outcome) return undefined;
    const timer = setTimeout(() => setOutcome(null), 3000);
    return () => clearTimeout(timer);
  }, [outcome]);

  const run = (entry: ExportEntry): void => {
    // Stamped once here rather than inside each format, so a pack exported
    // together carries one consistent generation time.
    const context: HandoffContext = { analysis, project, frames, title, generatedAt: Date.now() };
    void Promise.resolve(entry.run(context))
      .then((ok) => setOutcome({ id: entry.id, ok }))
      .catch(() => setOutcome({ id: entry.id, ok: false }));
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="rounded-xs border border-line px-1.5 py-0.5 text-2xs text-ink-muted transition-colors hover:bg-[var(--mi-hover)] hover:text-ink"
      >
        Export
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-[228px] rounded-md border border-line-strong bg-surface-raised p-1 shadow-lg">
          <ul>
            {ENTRIES.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => run(entry)}
                  className="w-full rounded-xs px-1.5 py-1 text-left transition-colors hover:bg-[var(--mi-hover)]"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-ink">{entry.label}</span>
                    <span className="text-2xs text-ink-subtle">{entry.hint}</span>
                  </span>
                  {outcome?.id === entry.id ? (
                    <span
                      aria-live="polite"
                      className={`mt-0.5 block text-2xs ${outcome.ok ? 'text-accent' : 'text-critical'}`}
                    >
                      {outcome.ok ? 'Saved' : 'Could not save'}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-1.5 pb-0.5 pt-1 text-2xs leading-relaxed text-ink-subtle">
            Exports carry measured timings, your edits, and anything the analysis could not produce.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** `reel-board-2026-08-24.md` — readable, sortable, and safe on any filesystem. */
function fileName(context: HandoffContext, kind: string, extension: string): string {
  return `${safeName(`${context.title}-${kind}-${dateStamp(context.generatedAt)}`)}.${extension}`;
}
