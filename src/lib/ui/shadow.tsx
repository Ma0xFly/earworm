/**
 * Body-level shadow DOM host for the whole Earworm UI.
 *
 * Contract layout (one body-level shadow host):
 * - ONE `<earworm-root>` host appended to `<body>` with
 *   `position:fixed; inset:0; pointer-events:none; z-index:2147483000`, so
 *   YouTube player ancestors can never clip it.
 * - CSS is injected into the shadow root only (callers pass the compiled
 *   `?inline` stylesheet). Nothing is added to the host document's `<head>`,
 *   and Tailwind preflight is not part of that stylesheet.
 * - On `fullscreenchange` the host is re-parented into
 *   `document.fullscreenElement` and moved back to `<body>` afterwards.
 * - The player rect is published as CSS variables on the host:
 *   `--ew-player-left/top/width/height` (+ bottom/right conveniences) so the
 *   overlay and sidebar can align without JS layout branches.
 */

import { findPlayerElement } from './selectors';

export type PlayerRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ShadowUiOptions = {
  /** Compiled CSS text, normally `import css from './style.css?inline'`. */
  css: string;
  /** Custom element name; must be kebab-case. */
  hostName?: string;
};

export type ShadowUi = {
  host: HTMLElement;
  shadow: ShadowRoot;
  /** Mount point for the React application. */
  container: HTMLElement;
  /** Radix portal target; lives inside the same shadow root. */
  portalContainer: HTMLElement;
  styleElement: HTMLStyleElement;
  mount: () => void;
  unmount: () => void;
  isMounted: () => boolean;
};

const DEFAULT_HOST_NAME = 'earworm-root';

/** Inline host styles are authoritative even when shadow CSS is missing. */
const HOST_STYLE = [
  'position: fixed',
  'inset: 0px',
  'width: 100%',
  'height: 100%',
  'pointer-events: none',
  'z-index: 2147483000',
  'display: block',
  'overflow: visible',
  'contain: layout style',
  '--ew-player-left: 0px',
  '--ew-player-top: 0px',
  '--ew-player-width: 0px',
  '--ew-player-height: 0px',
].join('; ');

export function createShadowUi(options: ShadowUiOptions): ShadowUi {
  const host = document.createElement(options.hostName ?? DEFAULT_HOST_NAME);
  host.setAttribute('data-earworm-host', '');
  host.style.cssText = HOST_STYLE;

  const shadow = host.attachShadow({ mode: 'open' });

  const styleElement = document.createElement('style');
  styleElement.setAttribute('data-earworm-style', '');
  styleElement.textContent = options.css;
  shadow.appendChild(styleElement);

  const container = document.createElement('div');
  container.setAttribute('data-earworm-container', '');
  container.style.cssText =
    'position:absolute; inset:0; display:block; pointer-events:none; overflow:visible;';
  shadow.appendChild(container);

  const portalContainer = document.createElement('div');
  portalContainer.setAttribute('data-earworm-portal', '');
  portalContainer.style.cssText =
    'position:absolute; inset:0; display:block; pointer-events:none; overflow:visible;';
  shadow.appendChild(portalContainer);

  let mounted = false;

  const placeHost = (): void => {
    const fullscreenElement = document.fullscreenElement;
    if (fullscreenElement && fullscreenElement !== host && !host.contains(fullscreenElement)) {
      if (host.parentElement !== fullscreenElement) {
        fullscreenElement.appendChild(host);
      }
      return;
    }
    if (host.parentElement !== document.body) {
      document.body.appendChild(host);
    }
  };

  const onFullscreenChange = (): void => {
    placeHost();
  };

  return {
    host,
    shadow,
    container,
    portalContainer,
    styleElement,
    mount() {
      if (mounted) return;
      mounted = true;
      placeHost();
      document.addEventListener('fullscreenchange', onFullscreenChange);
    },
    unmount() {
      mounted = false;
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      host.remove();
    },
    isMounted() {
      return mounted && host.isConnected;
    },
  };
}

/** Read a player rect; returns `null` when the element is gone. */
export function readPlayerRect(element: Element | null): PlayerRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

const RECT_VARIABLES: Record<keyof PlayerRect, string> = {
  left: '--ew-player-left',
  top: '--ew-player-top',
  width: '--ew-player-width',
  height: '--ew-player-height',
};

/** Publish a player rect as CSS variables on the shadow host. */
export function publishPlayerRect(host: HTMLElement, rect: PlayerRect | null): void {
  const value = rect ?? { left: 0, top: 0, width: 0, height: 0 };
  for (const [key, variable] of Object.entries(RECT_VARIABLES) as [
    keyof PlayerRect,
    string,
  ][]) {
    host.style.setProperty(variable, `${value[key]}px`);
  }
  host.style.setProperty('--ew-player-right', `${value.left + value.width}px`);
  host.style.setProperty('--ew-player-bottom', `${value.top + value.height}px`);
}

/** Locate the YouTube player element, falling back to the raw video element. */
export function getPlayerElement(): Element | null {
  // Shorts renders a separate vertical player instead of #movie_player; the
  // overlay/sidebar geometry must follow it on /shorts/<id> pages.
  return findPlayerElement(document);
}

function addListener(
  target: EventTarget,
  type: string,
  listener: EventListener,
  options?: AddEventListenerOptions,
): () => void {
  target.addEventListener(type, listener, options);
  return () => target.removeEventListener(type, listener, options);
}

/**
 * Keep the player rect CSS variables in sync. Event driven and rAF-throttled:
 * window resize/scroll, fullscreen, YouTube SPA navigation, and ResizeObserver
 * on the player are coalesced into at most one update per animation frame.
 * Returns a cleanup function.
 */
export function startPlayerRectSync(
  host: HTMLElement,
  getPlayer: () => Element | null = getPlayerElement,
): () => void {
  let disposed = false;
  let frame = 0;
  let waitFrame = 0;
  let waitAttempts = 0;
  let observed: Element | null = null;
  const MAX_WAIT_ATTEMPTS = 600; // ~10s at 60fps, enough for a slow watch page.

  const resizeObserver =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());

  const syncNow = (): void => {
    if (disposed) return;
    const player = getPlayer();
    if (player !== observed) {
      observed = player;
      resizeObserver?.disconnect();
      if (player) resizeObserver?.observe(player);
    }
    publishPlayerRect(host, readPlayerRect(player));
  };

  const schedule = (): void => {
    if (disposed || frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      syncNow();
    });
  };

  const waitForPlayer = (): void => {
    if (disposed) return;
    if (getPlayer() || waitAttempts >= MAX_WAIT_ATTEMPTS) {
      syncNow();
      return;
    }
    waitAttempts += 1;
    waitFrame = requestAnimationFrame(waitForPlayer);
  };

  const cleanups: Array<() => void> = [
    addListener(window, 'resize', schedule),
    addListener(window, 'scroll', schedule, { capture: true, passive: true }),
    addListener(document, 'fullscreenchange', schedule),
    addListener(document, 'yt-navigate-finish', schedule),
    addListener(document, 'yt-page-data-updated', schedule),
  ];

  syncNow();
  waitFrame = requestAnimationFrame(waitForPlayer);

  return () => {
    disposed = true;
    resizeObserver?.disconnect();
    if (frame !== 0) cancelAnimationFrame(frame);
    if (waitFrame !== 0) cancelAnimationFrame(waitFrame);
    for (const cleanup of cleanups) cleanup();
  };
}
