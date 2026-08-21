import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { buildDefines } from './scripts/defines.mjs';

/**
 * Build 1 of 2 — extension pages, the offscreen document, its worker, and the
 * service worker.
 *
 * The content script is built separately (`vite.content.config.ts`): it must be
 * a classic IIFE with no module loader, and it is parsed on every page the user
 * grants access to, so it is size-sensitive in a way none of these are.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: buildDefines(mode),
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    minify: mode !== 'development',
    sourcemap: mode === 'development' ? 'inline' : false,
    rollupOptions: {
      input: {
        sidepanel: fileURLToPath(new URL('./sidepanel.html', import.meta.url)),
        offscreen: fileURLToPath(new URL('./offscreen.html', import.meta.url)),
        background: fileURLToPath(new URL('./src/background/service-worker.ts', import.meta.url)),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
}));
