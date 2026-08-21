import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-line px-4 py-7 text-center">
      <div className="mx-auto mb-2.5 flex h-8 w-8 items-center justify-center rounded-md bg-surface-sunken text-ink-subtle">
        {icon}
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[34ch] text-xs leading-relaxed text-ink-muted">{body}</p>
      {children ? <div className="mt-3.5 flex justify-center">{children}</div> : null}
    </div>
  );
}
