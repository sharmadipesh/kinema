/**
 * A ten-segment bar.
 *
 * Segments rather than a smooth fill, because these values are estimates from a
 * derived rate, and a continuous bar implies a precision the number does not
 * have. Ten blocks says "roughly seven out of ten" — which is exactly what is
 * being claimed.
 */
export function Meter({ label, value, caption }: { label: string; value: number; caption: string }) {
  const filled = Math.round(Math.min(1, Math.max(0, value)) * 10);

  return (
    <div className="flex items-center gap-2 py-[3px]">
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
            className={[
              'h-[9px] w-[6px] rounded-[1px]',
              index < filled ? 'bg-accent' : 'bg-[var(--mi-track)]',
            ].join(' ')}
          />
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate text-right text-xs text-ink">{caption}</span>
    </div>
  );
}
