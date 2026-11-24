import path from 'node:path';
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// WXT config. `srcDir` keeps every source file under `src/` (entrypoints,
// shared contracts, features) instead of the repository root.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Earworm',
    description: 'YouTube 双语字幕英语学习扩展：双语字幕、逐句复听、点词查词',
    version: '0.1.0',
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    permissions: ['storage'],
    host_permissions: ['http://127.0.0.1/*', 'http://localhost/*'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    web_accessible_resources: [
      {
        resources: ['data/*'],
        matches: ['https://www.youtube.com/*'],
      },
    ],
    // `inject.ts` is built as an unlisted script (WXT naming rules) and
    // registered here as a MAIN-world content script at document_start so it
    // can observe the player's own timedtext requests before they fire.
    content_scripts: [
      {
        matches: ['https://www.youtube.com/*'],
        js: ['inject.js'],
        run_at: 'document_start',
        world: 'MAIN',
        all_frames: false,
      },
    ],
  },
  // WXT copies only `public/` into the unpacked extension. MIT/CC-BY
  // attribution must travel with the distributed copy, so ship the repository
  // LICENSE + NOTICE at the extension root as additional public assets.
  hooks: {
    'build:publicAssets'(_wxt, files) {
      for (const name of ['LICENSE', 'NOTICE']) {
        files.push({
          relativeDest: name,
          absoluteSrc: path.resolve(process.cwd(), name),
        });
      }
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
