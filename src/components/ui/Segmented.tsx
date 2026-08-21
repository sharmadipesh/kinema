export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Announced to screen readers when the visible label is an abbreviation. */
  description?: string;
  count?: number;
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange(value: T): void;
  disabled?: boolean;
  /** Lets a long option list scroll sideways inside a 320px panel. */
  scrollable?: boolean;
}

/**
 * A radio group that looks like a segmented control.
 *
 * Radios rather than a row of buttons, so arrow keys move between options and
 * the selected state is actually announced — neither of which a row of
 * `<button>`s gives you.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  scrollable = false,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={[
        'inline-flex items-center gap-0.5 rounded-md bg-surface-sunken p-0.5',
        scrollable ? 'mi-scroll-x max-w-full' : '',
      ].join(' ')}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.description ?? option.label}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={[
              'shrink-0 rounded-xs px-2 py-1 text-xs font-medium transition-colors duration-fast ease-standard',
              'disabled:pointer-events-none disabled:opacity-40',
              selected ? 'bg-surface-raised text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
            ].join(' ')}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className="ml-1 tabular text-2xs text-ink-subtle">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
