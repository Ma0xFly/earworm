import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Vitest uses the same Vite pipeline as the extension build, so `?inline`
// CSS imports are compiled by Tailwind v4 exactly like in `pnpm build`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    // Process CSS (instead of the default empty module) so the ?inline
    // shadow stylesheet is compiled by Tailwind exactly like in the build.
    css: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    reporters: ['default'],
  },
});
