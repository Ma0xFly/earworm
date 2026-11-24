import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createShadowUi,
  startPlayerRectSync,
  type ShadowUi,
} from '@/lib/ui/shadow';
import { AppProviders } from './providers';
import { ContentApp } from './ContentApp';

export type MountContentAppOptions = {
  /** Compiled content-entry stylesheet (`style.css?inline`). */
  css: string;
};

export type MountedContentApp = {
  ui: ShadowUi;
  reactRoot: Root;
  unmount: () => void;
};

let mountedApp: MountedContentApp | null = null;

/**
 * Mount the Earworm shadow-root UI once per page. Returns the existing mount
 * when called twice (e.g. hot reload or duplicate content script invocation).
 */
export function mountContentApp(options: MountContentAppOptions): MountedContentApp {
  if (mountedApp) return mountedApp;

  const ui = createShadowUi({ css: options.css });
  ui.mount();

  const reactRoot = createRoot(ui.container);
  reactRoot.render(
    createElement(AppProviders, { container: ui.portalContainer }, createElement(ContentApp)),
  );

  const stopRectSync = startPlayerRectSync(ui.host);

  const mounted: MountedContentApp = {
    ui,
    reactRoot,
    unmount() {
      stopRectSync();
      reactRoot.unmount();
      ui.unmount();
      mountedApp = null;
    },
  };
  mountedApp = mounted;
  return mounted;
}

/** Tear down a previously mounted app, if any. */
export function unmountContentApp(): void {
  mountedApp?.unmount();
}
