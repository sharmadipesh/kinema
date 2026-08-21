import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createManifest } from './manifest.config.mjs';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('package.json', root)), 'utf8'));
const distDir = new URL('dist/', root);

if (!existsSync(fileURLToPath(distDir))) {
  console.error('dist/ does not exist — run the Vite builds before generating the manifest.');
  process.exit(1);
}

writeFileSync(
  fileURLToPath(new URL('manifest.json', distDir)),
  `${JSON.stringify(createManifest({ version: pkg.version }), null, 2)}\n`,
  'utf8',
);

const required = ['content.js', 'background.js', 'sidepanel.html', 'offscreen.html', 'icons/icon-128.png'];
const missing = required.filter((file) => !existsSync(fileURLToPath(new URL(file, distDir))));
if (missing.length > 0) {
  console.error(`\n  Build incomplete — missing from dist/: ${missing.join(', ')}\n`);
  process.exit(1);
}

/**
 * Credential leak guard — carried over from Visual Prompt, where it earns its
 * keep for exactly the same reason.
 *
 * The user's OpenAI key is kept out of the content script architecturally:
 * `storage/credentials.ts` is simply never imported there. That is a
 * convention, and conventions decay. This turns a mis-import into a failed
 * build rather than a shipped vulnerability, which is the only version of that
 * rule worth having — `chrome.storage.local` is readable by this extension's
 * own content scripts, so the storage area itself is no barrier.
 */
const FORBIDDEN_IN_CONTENT = [
  { needle: 'mi:credentials', why: 'the credential storage key' },
  { needle: 'api.openai.com', why: 'a direct OpenAI endpoint' },
  { needle: 'Bearer ', why: 'an Authorization header' },
];

const contentBundle = readFileSync(fileURLToPath(new URL('content.js', distDir)), 'utf8');
const leaks = FORBIDDEN_IN_CONTENT.filter(({ needle }) => contentBundle.includes(needle));

if (leaks.length > 0) {
  console.error('\n  SECURITY: the content script bundle contains credential-adjacent code.');
  for (const { needle, why } of leaks) console.error(`    - ${why} ("${needle}")`);
  console.error('\n  Something under src/content/ now reaches storage/credentials.ts or the');
  console.error('  OpenAI transport. The key must never be reachable from a page context.\n');
  process.exit(1);
}

const kb = (file) => Math.round(readFileSync(fileURLToPath(new URL(file, distDir))).byteLength / 1024);

console.log(`  manifest.json written  ·  v${pkg.version}`);
console.log(`  content bundle clean   ·  no credential material  ·  ${kb('content.js')}KB`);
console.log(`  side panel             ·  ${kb('sidepanel.js')}KB`);
