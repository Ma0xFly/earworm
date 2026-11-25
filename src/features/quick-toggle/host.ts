/**
 * Control-bar host for the quick toggle (F2).
 *
 * The body-level shadow root is `position:fixed` and cannot live inside
 * YouTube's player controls, so the button lives in a second custom element
 * with its own open shadow root, inserted immediately before the CC button in
 * `.ytp-right-controls`. Keeping it out of the fullscreen button's hot zone is
 * deliberate (spec §3, Trancy misclick lesson).
 *
 * YouTube rebuilds the player/control bar on SPA navigation and fullscreen.
 * The lifecycle watcher re-attaches the SAME host (and therefore the same
 * shadow root and React portal target) on those events, on delayed retries and
 * on shallow childList mutations of the current control bar. It never observes
 * `document.body`.
 */
import { findSubtitlesButton, PAGE_SELECTORS } from '@/lib/ui/selectors';

export const QUICK_TOGGLE_HOST_TAG = 'earworm-quick-toggle-host';

const HOST_STYLE = [
  'display: inline-flex',
  'align-items: center',
  'justify-content: center',
  'position: relative',
  'box-sizing: border-box',
  'height: 100%',
  'margin: 0 2px',
  'padding: 0',
  'border: 0',
  'background: transparent',
  'color: inherit',
  'font: inherit',
  'pointer-events: auto',
  'overflow: visible',
].join('; ');

const LIFECYCLE_RETRY_DELAYS_MS = [250, 1000, 2500] as const;

export type QuickToggleHost = {
  host: HTMLElement;
  /** Portal/mount target inside the nested shadow root. */
  container: HTMLElement;
  /** Insert before the CC button; false when the player has no control bar. */
  attach: () => boolean;
  detach: () => void;
  destroy: () => void;
};

export type CreateQuickToggleHostOptions = {
  /** Compiled content stylesheet (`style.css?inline`). */
  css: string;
  doc?: Document;
};

export function createQuickToggleHost({
  css,
  doc = document,
}: CreateQuickToggleHostOptions): QuickToggleHost {
  const host = doc.createElement(QUICK_TOGGLE_HOST_TAG);
  host.setAttribute('data-earworm-quick-toggle-host', '');
  host.style.cssText = HOST_STYLE;

  const shadow = host.attachShadow({ mode: 'open' });

  const styleElement = doc.createElement('style');
  styleElement.setAttribute('data-earworm-style', '');
  styleElement.setAttribute('data-earworm-quick-toggle-style', '');
  styleElement.textContent = css;
  shadow.appendChild(styleElement);

  const container = doc.createElement('div');
  container.setAttribute('data-earworm-quick-toggle-container', '');
  container.style.cssText =
    'display:inline-flex; align-items:center; gap:2px; pointer-events:auto; overflow:visible;';
  shadow.appendChild(container);

  const attach = (): boolean => {
    const bar = doc.querySelector(PAGE_SELECTORS.controlBar);
    if (!bar) {
      host.remove();
      return false;
    }

    const cc = findSubtitlesButton(doc);
    const beforeCc = cc !== null && bar.contains(cc) && cc.parentElement !== null;
    // Without a CC button, prepend to the bar: never append next to fullscreen.
    const anchor = beforeCc ? cc! : bar.firstElementChild;
    const parent = beforeCc ? cc!.parentElement! : bar;

    if (anchor === host) return true;
    if (host.parentElement !== parent || host.nextElementSibling !== anchor) {
      parent.insertBefore(host, anchor);
    }
    return true;
  };

  return {
    host,
    container,
    attach,
    detach() {
      host.remove();
    },
    destroy() {
      host.remove();
    },
  };
}

/** Re-attach the host after the control bar is replaced by YouTube. */
export function startQuickToggleHostLifecycle(
  toggle: QuickToggleHost,
  doc: Document = document,
): () => void {
  let disposed = false;
  let timers: Array<ReturnType<typeof setTimeout>> = [];
  let observer: MutationObserver | null = null;
  let observed: Element[] = [];

  const refresh = (): void => {
    if (disposed) return;
    toggle.attach();
    watchControlBar();
  };

  const watchControlBar = (): void => {
    if (typeof MutationObserver === 'undefined') return;
    const bar = doc.querySelector(PAGE_SELECTORS.controlBar);
    const buttons = doc.querySelector(PAGE_SELECTORS.controlButtons);
    const cc = findSubtitlesButton(doc);
    const targets: Element[] = [];
    for (const target of [
      bar?.parentElement ?? null,
      bar,
      buttons ?? cc?.parentElement ?? null,
    ]) {
      if (target && !targets.includes(target)) targets.push(target);
    }
    if (
      targets.length === observed.length &&
      targets.every((target, index) => target === observed[index])
    ) {
      return;
    }
    observer?.disconnect();
    observed = targets;
    observer = new MutationObserver(() => refresh());
    for (const target of targets) observer.observe(target, { childList: true });
  };

  const onPageChange = (): void => {
    refresh();
    for (const timer of timers) clearTimeout(timer);
    timers = LIFECYCLE_RETRY_DELAYS_MS.map((delay) => setTimeout(refresh, delay));
  };

  const view = doc.defaultView;
  doc.addEventListener('yt-navigate-finish', onPageChange);
  doc.addEventListener('yt-page-data-updated', onPageChange);
  doc.addEventListener('fullscreenchange', onPageChange);
  view?.addEventListener('resize', onPageChange);

  refresh();
  timers = LIFECYCLE_RETRY_DELAYS_MS.map((delay) =>
    setTimeout(() => {
      if (!disposed) toggle.attach();
    }, delay),
  );

  return () => {
    disposed = true;
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    observer?.disconnect();
    observer = null;
    observed = [];
    doc.removeEventListener('yt-navigate-finish', onPageChange);
    doc.removeEventListener('yt-page-data-updated', onPageChange);
    doc.removeEventListener('fullscreenchange', onPageChange);
    view?.removeEventListener('resize', onPageChange);
  };
}
