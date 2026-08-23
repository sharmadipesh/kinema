import { useState } from 'react';

/**
 * A ten-segment bar that can explain itself.
 *
 * Segments rather than a smooth fill, because these values are derived rates
 * and a continuous bar implies a precision the number does not have. Ten blocks
 * says "roughly seven out of ten" — which is exactly what is being claimed.
 *
 * The `why` is behind a click rather than always visible: six explanations
 * stacked in a 380px panel drowns the bars they exist to support. But it is
 * one interaction away, because a bar nobody can interrogate is a bar nobody
 * should trust.
 */
export function Meter({
  label,
  value,
  caption,
  why,
}: {
  label: string;
  value: number;
  caption: string;
  why?: string;
}) {
  const [open, setOpen] = useState(false);
  const filled = Math.round(Math.min(1, Math.max(0, value)) * 10);

  const bar = (
    <>
      <span className="w-[68px] shrink-0 text-xs text-ink-muted">{label}</span>
      <span
        className="flex shrink-0 gap-[2px]"
        role="meter"
        aria-valuenow={filled}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-label={`${label}: ${caption}`}
      >
        {Array.from({ length: 10 }, (_, index) => (
          <span
            key={index}
            className={['h-[9px] w-[6px] rounded-[1px]', index < filled ? 'bg-accent' : 'bg-[var(--mi-track)]'].join(' ')}
          />
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate text-right text-xs text-ink">{caption}</span>
    </>
  );

  if (!why) return <div className="flex items-center gap-2 py-[3px]">{bar}</div>;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xs py-[3px] text-left transition-colors hover:bg-[var(--mi-hover)]"
      >
        {bar}
      </button>
      {open ? <p className="pb-1 pl-[70px] text-2xs leading-relaxed text-ink-subtle">{why}</p> : null}
    </div>
  );
}
