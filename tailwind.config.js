/**
 * Tailwind v3, deliberately, not v4 — carried over from Visual Prompt, whose
 * config documents why: v4 registers its internal custom properties with
 * document-scoped `@property` rules, and utilities composing through `--tw-*`
 * degrade silently anywhere those do not apply.
 *
 * Every colour, radius and duration resolves to a token in
 * `src/styles/tokens.css`, so the design system has one source of truth.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./sidepanel.html', './src/**/*.{ts,tsx}'],
  darkMode: ['variant', ['&:where([data-theme="dark"], [data-theme="dark"] *)']],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'var(--mi-surface)',
          raised: 'var(--mi-surface-raised)',
          sunken: 'var(--mi-surface-sunken)',
          inverse: 'var(--mi-surface-inverse)',
        },
        line: { DEFAULT: 'var(--mi-border)', strong: 'var(--mi-border-strong)' },
        ink: {
          DEFAULT: 'var(--mi-text)',
          muted: 'var(--mi-text-muted)',
          subtle: 'var(--mi-text-subtle)',
          inverse: 'var(--mi-text-inverse)',
        },
        accent: { DEFAULT: 'var(--mi-accent)', soft: 'var(--mi-accent-soft)' },
        positive: 'var(--mi-positive)',
        critical: 'var(--mi-critical)',
        caution: 'var(--mi-caution)',
      },
      borderRadius: {
        xs: 'var(--mi-radius-xs)',
        sm: 'var(--mi-radius-sm)',
        md: 'var(--mi-radius-md)',
        lg: 'var(--mi-radius-lg)',
        pill: 'var(--mi-radius-pill)',
      },
      boxShadow: { card: 'var(--mi-shadow-card)', focus: 'var(--mi-shadow-focus)' },
      fontFamily: { sans: 'var(--mi-font-sans)', mono: 'var(--mi-font-mono)' },
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px', letterSpacing: '0.04em' }],
        xs: ['11px', { lineHeight: '16px' }],
        sm: ['12px', { lineHeight: '18px' }],
        base: ['13px', { lineHeight: '20px' }],
        md: ['14px', { lineHeight: '21px' }],
        lg: ['16px', { lineHeight: '22px' }],
      },
      transitionDuration: {
        fast: 'var(--mi-duration-fast)',
        base: 'var(--mi-duration-base)',
      },
      transitionTimingFunction: { standard: 'var(--mi-ease-standard)' },
      keyframes: {
        'mi-fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'mi-shimmer': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(100%)' } },
        'mi-spin': { to: { transform: 'rotate(360deg)' } },
        'mi-pulse-dot': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
      },
      animation: {
        'fade-in': 'mi-fade-in var(--mi-duration-fast) var(--mi-ease-standard) both',
        shimmer: 'mi-shimmer 1.6s var(--mi-ease-standard) infinite',
        spin: 'mi-spin 900ms linear infinite',
        'pulse-dot': 'mi-pulse-dot 1.4s var(--mi-ease-standard) infinite',
      },
    },
  },
  plugins: [],
};
