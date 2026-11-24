import { defineContentScript } from 'wxt/utils/define-content-script';
import cssText from './style.css?inline';
import { mountContentApp } from '@/features/app/boot';

/**
 * Isolated-world content script.
 *
 * Mounts the single body-level shadow root and the React app. The MAIN-world
 * inject script is a separate manifest content script (`src/entrypoints/inject.ts`,
 * `world: "MAIN"`, `document_start`) and talks to the app over the validated
 * window bridge.
 */
export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    const mounted = mountContentApp({ css: cssText });
    ctx.onInvalidated(() => mounted.unmount());
  },
});
