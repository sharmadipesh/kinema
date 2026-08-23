import { useState, type ReactNode } from 'react';
import { copyText } from '../../utils/clipboard.ts';

/** Shared presentation for the blueprint views. */

export function Section({
  title,
  copy,
  children,
}: {
  title: string;
  /** Lines to copy. The button appears only when there is something to copy. */
  copy?: string[];
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h3 className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">{title}</h3>
        {copy?.length ? <CopyButton lines={copy} label={title} /> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Copies plain text to the clipboard.
 *
 * Rendered only where the copy actually works — a button that looks functional
 * and silently does nothing is worse than no button.
 */
export function CopyButton({ lines, label }: { lines: string[]; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void copyText(lines.join('\n')).then((ok) => {
          if (!ok) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      className="shrink-0 rounded-xs px-1 py-0.5 text-2xs text-ink-subtle transition-colors hover:bg-[var(--mi-hover)] hover:text-ink"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-1 space-y-1">
      {items.map((item) => (
        <li key={item} className="flex gap-1.5 text-xs leading-relaxed text-ink-muted">
          <span aria-hidden="true" className="mt-[7px] h-[3px] w-[3px] shrink-0 rounded-pill bg-ink-subtle" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function Numbered({ items }: { items: string[] }) {
  return (
    <ol className="mt-1 space-y-1">
      {items.map((item, index) => (
        <li key={item} className="flex gap-2 text-xs leading-relaxed text-ink-muted">
          <span className="tabular w-3.5 shrink-0 text-ink-subtle">{index + 1}.</span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}
