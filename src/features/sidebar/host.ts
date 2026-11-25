import { NESTED_BLUR_CSS } from '@/features/blur/blurCss';
import { findSecondarySlot, PAGE_SELECTORS } from '@/lib/ui/selectors';

/**
 * Sidebar document-flow host.
 *
 * The body-level shadow root cannot be moved inside YouTube's `#secondary`
 * column: React nodes rendered there would escape the shadow tree. The docked
 * sidebar therefore lives in a second custom element
 * (`<earworm-sidebar-host>`) that is prepended to `#secondary-inner`: the host
 * owns its own open shadow root, the compiled stylesheet is injected there,
 * and React renders the panel into the host's container through a portal.
 *
 * The host is document flow (`display:block; width:100%`), so recommended
 * videos are pushed below it and the whole panel scrolls away with the page.
 * The panel itself owns the fixed height and the scrolling sentence list
 * (layout constants live in `./selectors`).
 *
 * YouTube replaces `#secondary-inner` (and occasionally the whole
 * `#secondary` column) on SPA navigation, so the lifecycle watcher re-prepends
 * the host after navigation events and on childList mutations of the current
 * column. It never observes the whole body.
 */

export const SIDEBAR_HOST_TAG = 'earworm-sidebar-host';

/**
 * Inline host styles. Geometry lives here, not in the shadow sheet: the
 * compiled sheet's `:host` rule (`src/entrypoints/content/style.css`) only
 * resets inheritance and sets the theme variables/font.
 */
const HOST_STYLE = [
  'display: block',
  'width: 100%',
  'margin: 0 0 12px 0',
  'padding: 0',
  'border: 0',
  'box-sizing: border-box',
].join('; ');

/** YouTube mounts the column asynchronously after a SPA transition. */
const LIFECYCLE_RETRY_DELAYS_MS = [250, 1000, 2500] as const;

export type SidebarHost = {
  host: HTMLElement;
  /** Portal target for the docked panel. */
  container: HTMLElement;
  /** Prepend the host to the current column; false when no column exists. */
  attach: () => boolean;
  /** Take the host out of the page (collapsed, fullscreen, drawer mode). */
  detach: () => void;
  destroy: () => void;
};

export type CreateSidebarHostOptions = {
  /** Compiled content stylesheet (`style.css?inline`). */
  css: string;
  doc?: Document;
};

export function createSidebarHost({
  css,
  doc = document,
}: CreateSidebarHostOptions): SidebarHost {
  const host = doc.createElement(SIDEBAR_HOST_TAG);
  host.setAttribute('data-earworm-sidebar-host', '');
  host.style.cssText = HOST_STYLE;

  const shadow = host.attachShadow({ mode: 'open' });

  const styleElement = doc.createElement('style');
  styleElement.setAttribute('data-earworm-style', '');
  styleElement.setAttribute('data-earworm-sidebar-style', '');
  // The nested root needs the host-scoped blur selectors because the blur
  // flags are mirrored onto the host element, outside the shadow tree.
  styleElement.textContent = `${css}\n${NESTED_BLUR_CSS}`;
  shadow.appendChild(styleElement);

  const container = doc.createElement('div');
  container.setAttribute('data-earworm-sidebar-container', '');
  container.style.cssText = 'display: block; width: 100%;';
  shadow.appendChild(container);

  const attach = (): boolean => {
    const slot = findSecondarySlot(doc);
    if (!slot) {
      host.remove();
      return false;
    }
    if (host.parentNode !== slot || slot.firstElementChild !== host) {
      slot.prepend(host);
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

/**
 * Keep the host inside the current recommended-videos column.
 *
 * Re-attaches on `yt-navigate-finish` / `yt-page-data-updated` / resize /
 * fullscreen changes (plus a few delayed retries, because YouTube mounts the
 * column asynchronously), and on scoped childList mutations: the column's
 * parent catches a replaced `#secondary`, the column catches a replaced
 * `#secondary-inner`. Each observed node is a single shallow childList target,
 * never a body-wide subtree.
 */
export function startSidebarHostLifecycle(
  sidebar: SidebarHost,
  doc: Document = document,
): () => void {
  let disposed = false;
  let timers: Array<ReturnType<typeof setTimeout>> = [];
  let observer: MutationObserver | null = null;
  let observed: Element[] = [];

  const attach = (): void => {
    if (disposed) return;
    // Fullscreen is the drawer's turn: never insert the column host there.
    if (doc.fullscreenElement) return;
    sidebar.attach();
  };

  /** Attach and (re)arm the mutation observer after YouTube swaps columns. */
  const refresh = (): void => {
    attach();
    watchColumn();
  };

  const clearTimers = (): void => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  };

  const watchColumn = (): void => {
    if (typeof MutationObserver === 'undefined') return;
    const column = doc.querySelector(PAGE_SELECTORS.secondary);
    const slot = findSecondarySlot(doc);
    const targets: Element[] = [];
    for (const target of [column?.parentElement ?? null, column, slot]) {
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
    observer = new MutationObserver(() => {
      refresh();
    });
    for (const target of targets) observer.observe(target, { childList: true });
  };

  const onPageChange = (): void => {
    refresh();
    clearTimers();
    timers = LIFECYCLE_RETRY_DELAYS_MS.map((delay) =>
      setTimeout(refresh, delay),
    );
  };

  const view = doc.defaultView;
  doc.addEventListener('yt-navigate-finish', onPageChange);
  doc.addEventListener('yt-page-data-updated', onPageChange);
  doc.addEventListener('fullscreenchange', onPageChange);
  view?.addEventListener('resize', onPageChange);

  attach();
  watchColumn();
  timers = LIFECYCLE_RETRY_DELAYS_MS.map((delay) => setTimeout(attach, delay));

  return () => {
    disposed = true;
    clearTimers();
    observer?.disconnect();
    observer = null;
    observed = [];
    doc.removeEventListener('yt-navigate-finish', onPageChange);
    doc.removeEventListener('yt-page-data-updated', onPageChange);
    doc.removeEventListener('fullscreenchange', onPageChange);
    view?.removeEventListener('resize', onPageChange);
  };
}
