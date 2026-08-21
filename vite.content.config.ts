import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { buildDefines } from './scripts/defines.mjs';

/**
 * Build 2 of 2 — the content script.
 *
 * IIFE output, because a classic content script has no module loader and must
 * be one self-contained file. No React at all: this bundle renders nothing. It
 * discovers videos, probes frame access, seeks, and captures — everything
 * visual happens in the side panel.
 */
export default defineConfig(({ mode }) => ({
  define: buildDefines(mode),
  resolve: { alias: [{ find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) }] },
  build: {
    outDir: 'dist',
    // The page build runs first and owns `emptyOutDir`.
    emptyOutDir: false,
    target: 'chrome116',
    minify: mode !== 'development',
    sourcemap: mode === 'development' ? 'inline' : false,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('./src/content/index.ts', import.meta.url)),
      formats: ['iife'],
      name: 'MotionInspectorContent',
      fileName: () => 'content.js',
    },
    rollupOptions: { output: { assetFileNames: 'assets/content-[name][extname]', extend: true } },
  },
}));
