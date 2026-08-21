import { STORAGE } from '../config.ts';
import type { Settings, ThemePreference } from '../types/domain.ts';
import { log } from '../utils/logger.ts';

/**
 * Settings live in `chrome.storage.sync` so preferences follow the user across
 * their signed-in Chrome profiles. Nothing here is sensitive and nothing here is
 * large — sync has a hard 8KB-per-item quota.
 */

export const DEFAULT_SETTINGS: Settings = {
  saveHistory: true,
  warnBeforeScrub: true,
  samplingRate: 'balanced',
  theme: 'dark',
};

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
export const SAMPLING_RATES: readonly Settings['samplingRate'][] = ['economy', 'balanced', 'thorough'];

/**
 * Storage is user-writable and survives upgrades, so it is validated on read.
 *
 * SECURITY: the returned object is a fresh whitelist of known keys, so an
 * unknown field — a credential above all — is silently dropped on both read and
 * write. Never add a secret to `Settings`; keys belong in
 * `storage/credentials.ts`, under a different storage key. A test asserts this.
 */
export function normalizeSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const value = raw as Partial<Record<keyof Settings, unknown>>;

  const bool = (key: 'saveHistory' | 'warnBeforeScrub'): boolean =>
    typeof value[key] === 'boolean' ? (value[key] as boolean) : DEFAULT_SETTINGS[key];

  return {
    saveHistory: bool('saveHistory'),
    warnBeforeScrub: bool('warnBeforeScrub'),
    samplingRate: SAMPLING_RATES.includes(value.samplingRate as Settings['samplingRate'])
      ? (value.samplingRate as Settings['samplingRate'])
      : DEFAULT_SETTINGS.samplingRate,
    theme: THEME_PREFERENCES.includes(value.theme as ThemePreference)
      ? (value.theme as ThemePreference)
      : DEFAULT_SETTINGS.theme,
  };
}

export async function readSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.sync.get(STORAGE.settingsKey);
    return normalizeSettings(stored[STORAGE.settingsKey]);
  } catch (error) {
    log.warn('settings read failed, using defaults', { error: String(error) });
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await readSettings()), ...patch });
  await chrome.storage.sync.set({ [STORAGE.settingsKey]: next });
  return next;
}

export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area !== 'sync') return;
    const change = changes[STORAGE.settingsKey];
    if (!change) return;
    listener(normalizeSettings(change.newValue));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
