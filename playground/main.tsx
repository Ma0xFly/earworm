/**
 * Offline playground entry (T14).
 *
 * Boot order matters:
 * 1. make the URL a valid mock watch page (`?scene=…&v=…`);
 * 2. install `chrome.*` (settings/dictionary/collocation loaders need it);
 * 3. install the mock `<video>` clock (T10 attaches to the element on mount);
 * 4. mount the toolbar and the *real* content app inside T1's shadow root;
 * 5. warm the real offline data, then let the captured `earworm:produce`
 *    request be answered by the mock inject script with T3-protocol cues.
 */

import contentCss from '../src/entrypoints/content/style.css?inline';
import { createRoot } from 'react-dom/client';
import './playground.css';
import { mountContentApp } from '../src/features/app/boot';
import { loadCollocationTable } from '../src/lib/collocations';
import { preloadDictionary } from '../src/lib/dict';
import { MockBackend } from './mock/background';
import { installChromeMock } from './mock/chrome';
import { installMockInject } from './mock/inject';
import {
  bindMockPlayerControls,
  bindPlayerSurfaceClick,
  installMockVideo,
  type MockVideoHandle,
} from './mock/video';
import { FIXTURE_DURATION } from './fixture';
import {
  CACHE_HIT_SCENE,
  ensureSceneUrl,
  navigateToScene,
  sceneById,
  sceneFromLocation,
  type SceneDefinition,
  type SceneId,
} from './scene';
import { Toolbar, type ToolbarProps } from './toolbar';

export type PlaygroundDebug = {
  backend: MockBackend;
  player: MockVideoHandle;
  scene: () => SceneDefinition;
  switchScene: (id: SceneId) => void;
  dispose: () => void;
};

let disposePlayground: (() => void) | null = null;

/**
 * Kept in the entry module (not `toolbar.tsx`) so the toolbar file exports only
 * the component and stays a React Fast Refresh boundary during HMR.
 */
function mountToolbar(container: HTMLElement, props: ToolbarProps): () => void {
  const root = createRoot(container);
  root.render(<Toolbar {...props} />);
  return () => root.unmount();
}

function showFatalError(error: unknown): void {
  console.error('[playground] bootstrap failed:', error);
  const banner = document.createElement('pre');
  banner.className = 'playground-error';
  banner.textContent = `Playground 启动失败：\n${
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  }`;
  document.body.prepend(banner);
}

async function bootstrap(): Promise<void> {
  ensureSceneUrl();

  const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
  if (!video) throw new Error('mock <video class="html5-main-video"> is missing');
  const playerShell = document.querySelector('#movie_player');
  if (!playerShell) throw new Error('mock #movie_player is missing');
  const toolbarHost = document.getElementById('dev-toolbar');
  if (!toolbarHost) throw new Error('mock #dev-toolbar is missing');

  const backend = new MockBackend({ getScene: () => sceneFromLocation().id });
  const chromeMock = installChromeMock(backend);
  const player = installMockVideo(video, { duration: FIXTURE_DURATION });

  const cleanups: Array<() => void> = [
    bindMockPlayerControls(player),
    bindPlayerSurfaceClick(player, playerShell),
    installMockInject({ getScene: () => sceneFromLocation().id }),
    () => chromeMock.dispose(),
  ];

  const selectScene = (next: SceneDefinition): void => {
    // Each scene behaves like a fresh watch page: stop at 0 and reset scroll.
    player.pause();
    player.seek(0);
    navigateToScene(next, { push: true });
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const stopToolbar = mountToolbar(toolbarHost, { backend, onSceneSelected: selectScene });
  cleanups.push(stopToolbar);

  const onPopState = (): void => {
    const next = ensureSceneUrl();
    player.pause();
    player.seek(0);
    window.scrollTo({ top: 0, behavior: 'auto' });
    document.dispatchEvent(new Event('yt-navigate-finish', { bubbles: true }));
    window.dispatchEvent(new CustomEvent<SceneId>('earworm-playground:scene', { detail: next.id }));
  };
  window.addEventListener('popstate', onPopState);
  cleanups.push(() => window.removeEventListener('popstate', onPopState));

  // Prepopulate the cache-hit scene with the exact cue hash the session will
  // compute, then load the real ECDICT / collocation artifacts. The dictionary
  // is loaded without the IndexedDB import: the in-memory map is enough for a
  // dev page and the 50k-row import would only add background work.
  try {
    await backend.seedFixtureCache(CACHE_HIT_SCENE.videoId);
  } catch (error) {
    console.warn('[playground] could not prepopulate the mock translation cache:', error);
  }
  await Promise.all([preloadDictionary({ importToIdb: false }), loadCollocationTable()]);

  const mounted = mountContentApp({ css: contentCss });

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    try {
      mounted.unmount();
    } catch (error) {
      console.warn('[playground] content app unmount failed:', error);
    }
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.warn('[playground] cleanup failed:', error);
      }
    }
    player.dispose();
  };

  const debug: PlaygroundDebug = {
    backend,
    player,
    scene: () => sceneFromLocation(),
    switchScene: (id: SceneId) => selectScene(sceneById(id)),
    dispose,
  };
  Object.defineProperty(window, '__earwormPlayground', {
    configurable: true,
    value: debug,
  });

  disposePlayground = dispose;

  console.info(
    '[playground] ready — use the toolbar to switch scenes; a/s/d navigate sentences.',
  );
}

void bootstrap().catch(showFatalError);

// When this module itself is hot-replaced, tear the old app down first.
import.meta.hot?.dispose(() => {
  disposePlayground?.();
  disposePlayground = null;
});
