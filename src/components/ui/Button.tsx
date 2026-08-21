import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  /** Rendered before the label, at the same optical weight. */
  icon?: ReactNode;
  fullWidth?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-surface-inverse text-ink-inverse hover:opacity-90 active:opacity-100 disabled:opacity-30',
  secondary:
    'border border-line bg-surface-raised text-ink hover:bg-[var(--mi-hover)] active:bg-[var(--mi-hover)] disabled:opacity-40',
  ghost: 'text-ink-muted hover:bg-[var(--mi-hover)] hover:text-ink disabled:opacity-40',
  danger: 'border border-line bg-surface-raised text-critical hover:bg-[var(--mi-hover)] disabled:opacity-40',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 gap-1.5 rounded-sm px-2 text-xs',
  md: 'h-8 gap-1.5 rounded-md px-2.5 text-sm',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  fullWidth = false,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-[background-color,opacity] duration-fast ease-standard disabled:pointer-events-none',
        SIZES[size],
        VARIANTS[variant],
        fullWidth ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
