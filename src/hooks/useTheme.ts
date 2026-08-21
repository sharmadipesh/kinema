import { useEffect } from 'react';
import type { ThemePreference } from '../types/domain.ts';

/**
 * Theme resolution for the side panel.
 *
 * An extension page has no host page to sample, so the system preference is the
 * only meaningful signal — and only when the user asked for 'system'. Someone
 * who chose Light means Light, even at sunset.
 */
export function useTheme(preference: ThemePreference | undefined): void {
  useEffect(() => {
    if (!preference) return undefined;

    const apply = (theme: 'light' | 'dark'): void => {
      document.documentElement.setAttribute('data-theme', theme);
    };

    if (preference !== 'system') {
      apply(preference);
      return undefined;
    }

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = (): void => apply(query.matches ? 'dark' : 'light');
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, [preference]);
}
