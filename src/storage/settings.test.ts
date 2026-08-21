import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings.ts';

describe('normalizeSettings', () => {
  it('falls back to defaults for junk input', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings([])).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and replaces invalid ones', () => {
    const result = normalizeSettings({ saveHistory: false, samplingRate: 'thorough', theme: 'banana' });
    expect(result.saveHistory).toBe(false);
    expect(result.samplingRate).toBe('thorough');
    expect(result.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it('drops unknown keys, so a credential can never survive a settings round-trip', () => {
    // This is the assertion that keeps `Settings` safe to store in
    // chrome.storage.sync, which replicates to Google's servers.
    const dirty = normalizeSettings({ ...DEFAULT_SETTINGS, apiKey: 'sk-should-never-persist' });
    expect(dirty).not.toHaveProperty('apiKey');
    expect(Object.keys(dirty).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
});
