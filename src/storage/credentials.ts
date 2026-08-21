/**
 * The user's own OpenAI API key.
 *
 * **Storage area.** `chrome.storage.local`, never `sync` — sync replicates to
 * Google's servers and to every signed-in profile, and it is also where
 * `Settings` lives, which is precisely the object this key must never be part
 * of. `session` was rejected too: it clears on browser restart, and re-pasting
 * a long secret every morning is not a product.
 *
 * **The honest caveat.** `chrome.storage.local` *is* readable by this
 * extension's own content scripts. The storage area is therefore not the
 * protection. The protection is architectural, and enforced mechanically:
 *
 *   1. This module is never imported by the content bundle. Nothing in
 *      `src/content/` may reach it, directly or transitively.
 *   2. The key lives under its own storage key, outside `Settings`, so no
 *      settings read can surface it.
 *   3. The key is never returned across a message or a port.
 *   4. `scripts/build-manifest.mjs` greps the built `dist/content.js` and fails
 *      the build if any of this leaks into it. A mis-import becomes a broken
 *      build rather than a shipped vulnerability.
 *
 * Only `maskKey()` output may ever be logged. Never the key itself.
 */

/**
 * Defined here rather than in `config.ts`: that module is imported by the
 * content script, so a constant there lands in the page bundle and trips the
 * build's leak guard.
 */
const CREDENTIALS_KEY = 'mi:credentials';

export interface StoredCredential {
  key: string;
  savedAt: number;
  /** When the key last proved itself against a real API call. */
  verifiedAt: number | null;
}

/** Non-secret summary, safe to render or pass to any extension page. */
export interface CredentialMeta {
  present: boolean;
  masked: string | null;
  savedAt: number | null;
  verifiedAt: number | null;
}

export type KeyValidation = { ok: true; key: string } | { ok: false; reason: string };

/**
 * Format validation, deliberately loose — the live probe is the real test. This
 * only catches the mistakes that would otherwise produce a baffling error much
 * later.
 */
export function validateKeyFormat(raw: string): KeyValidation {
  // A key pasted from a terminal often arrives wrapped in quotes and with a
  // trailing newline. Left alone, that newline makes `Bearer sk-…\n` an illegal
  // header value and `fetch` throws a bare TypeError, which the error mapper
  // would report as "check your connection" — a maddening way to fail.
  const key = raw.trim().replace(/^['"]|['"]$/g, '').replace(/\s+/g, '');

  if (!key) return { ok: false, reason: 'Paste your key from platform.openai.com → API keys.' };
  if (key.startsWith('sess-')) {
    return { ok: false, reason: "That's a session token, not an API key. Create a key under API keys." };
  }
  if (!key.startsWith('sk-')) return { ok: false, reason: 'An OpenAI API key starts with "sk-".' };
  if (key.length < 40) return { ok: false, reason: 'That key looks too short — check you copied all of it.' };
  if (key.length > 300) return { ok: false, reason: 'That key looks too long — check you copied only the key.' };
  if (!/^sk-[A-Za-z0-9_-]+$/.test(key)) {
    return { ok: false, reason: 'That key contains characters an OpenAI key never has.' };
  }
  return { ok: true, key };
}

export function maskKey(key: string): string {
  return key.length <= 8 ? 'sk-…' : `sk-…${key.slice(-4)}`;
}

/**
 * Refuses to run in a page context.
 *
 * A content script has a `document` and an http(s) origin; a service worker has
 * no `document`; an extension page has the `chrome-extension:` protocol. This
 * throws per-call rather than at module scope, so a mis-import cannot take down
 * an entire content script in production — the build guard is what actually
 * prevents shipping that mistake.
 */
function assertPrivilegedContext(): void {
  const isServiceWorker = typeof document === 'undefined';
  const isExtensionPage = typeof location !== 'undefined' && location.protocol === 'chrome-extension:';
  if (!isServiceWorker && !isExtensionPage) {
    throw new Error('Motion Inspector: credentials are not available in a page context.');
  }
}

async function readRecord(): Promise<StoredCredential | null> {
  const stored = await chrome.storage.local.get(CREDENTIALS_KEY);
  const raw = stored[CREDENTIALS_KEY] as Partial<StoredCredential> | undefined;
  if (!raw || typeof raw.key !== 'string' || !raw.key) return null;
  return {
    key: raw.key,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
    verifiedAt: typeof raw.verifiedAt === 'number' ? raw.verifiedAt : null,
  };
}

export async function readApiKey(): Promise<string | null> {
  assertPrivilegedContext();
  return (await readRecord())?.key ?? null;
}

export async function writeApiKey(key: string, verifiedAt: number | null = null): Promise<void> {
  assertPrivilegedContext();
  await chrome.storage.local.set({ [CREDENTIALS_KEY]: { key, savedAt: Date.now(), verifiedAt } });
}

export async function clearApiKey(): Promise<void> {
  assertPrivilegedContext();
  await chrome.storage.local.remove(CREDENTIALS_KEY);
}

export async function hasApiKey(): Promise<boolean> {
  assertPrivilegedContext();
  return (await readRecord()) !== null;
}

/** Safe anywhere: contains no secret material. */
export async function readCredentialMeta(): Promise<CredentialMeta> {
  const record = await readRecord().catch(() => null);
  if (!record) return { present: false, masked: null, savedAt: null, verifiedAt: null };
  return { present: true, masked: maskKey(record.key), savedAt: record.savedAt, verifiedAt: record.verifiedAt };
}

export function onCredentialsChanged(listener: () => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area === 'local' && changes[CREDENTIALS_KEY]) listener();
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
