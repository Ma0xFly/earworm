import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vite config for the offline playground (T14).
 *
 * The playground is a *separate* dev/build target from the WXT extension:
 * `scripts/playground.mjs` points Vite at this directory when the file exists.
 * It reuses the repository root as the static asset directory so
 * `chrome.runtime.getURL('data/*')` can be mocked with the real, committed
 * ECDICT / lemma / collocation artifacts served from `public/data/`.
 *
 * The extension's Tailwind stylesheet is imported by `main.tsx` through
 * `src/entrypoints/content/style.css?inline`; the Tailwind plugin here compiles
 * it exactly like the extension build (preflight stays disabled).
 */
const playgroundDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: playgroundDir,
  // Serve the repository `public/` (committed ECDICT data) at `/data/*`.
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    // `src/` uses the WXT/TS `@/*` path alias; Vite needs it spelled out.
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  server: {
    // Keep a stable URL for the README; fall back to the next free port.
    port: 5183,
    strictPort: false,
    fs: {
      // The playground imports real components from `../src`, which lives
      // outside this Vite root; allow the whole checkout.
      allow: [repoRoot],
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
});
