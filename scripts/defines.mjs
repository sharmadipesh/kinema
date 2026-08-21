import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Compile-time constants.
 *
 * SECURITY: only non-secret values may appear here — everything defined in this
 * file is inlined verbatim into a publicly distributed bundle. Motion Inspector
 * has no application-owned API key by design; the user brings their own and it
 * lives in `chrome.storage.local`, never in a build artifact.
 */

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));

export function buildDefines(mode) {
  const isDevelopment = mode === 'development' || mode === 'test';
  return {
    __EXTENSION_VERSION__: JSON.stringify(pkg.version),
    // Verbose logging is compiled out of production bundles entirely.
    __DEBUG__: JSON.stringify(process.env.MI_DEBUG === 'true' || isDevelopment),
    __BUILD_MODE__: JSON.stringify(mode),
  };
}
