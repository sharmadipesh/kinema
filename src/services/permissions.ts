import { log } from '../utils/logger.ts';

/**
 * Optional host permissions.
 *
 * The manifest grants no host access at install time at all. `api.openai.com`
 * is requested when the user connects a key; a site origin is requested only
 * when the user wants detection to keep working there after the `activeTab`
 * grant lapses. An install therefore grants nothing it does not yet need,
 * which is both the honest position and the one a store reviewer can approve.
 */

export function originPattern(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.protocol}//${url.host}/*`;
  } catch {
    return null;
  }
}

export async function hasHostPermission(rawUrl: string): Promise<boolean> {
  const origin = originPattern(rawUrl);
  if (!origin) return false;
  try {
    return await chrome.permissions.contains({ origins: [origin] });
  } catch (error) {
    log.warn('permission check failed', { error: String(error) });
    return false;
  }
}

/**
 * Must be called from a user gesture, or Chrome rejects it.
 *
 * `chrome.permissions.request` is deliberately the FIRST async call at every
 * call site: an intervening `await` breaks the gesture chain. A pre-check with
 * `contains` would be both risky and redundant — `request` resolves `true`
 * straight away when the permission is already held.
 */
export async function requestHostPermission(rawUrl: string): Promise<boolean> {
  const origin = originPattern(rawUrl);
  if (!origin) return false;
  try {
    return await chrome.permissions.request({ origins: [origin] });
  } catch (error) {
    log.warn('permission request failed', { error: String(error) });
    return false;
  }
}
