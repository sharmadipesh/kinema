import type { ReactNode } from 'react';

export function Chip({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'accent' | 'caution' }) {
  const tones = {
    default: 'bg-surface-sunken text-ink-muted',
    accent: 'bg-[var(--mi-accent-soft)] text-accent',
    caution: 'bg-surface-sunken text-caution',
  } as const;

  return (
    <span className={`inline-flex items-center rounded-xs px-1.5 py-0.5 text-2xs ${tones[tone]}`}>{children}</span>
  );
}
