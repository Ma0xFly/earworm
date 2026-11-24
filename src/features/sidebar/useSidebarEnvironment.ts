import { useEffect, useState } from 'react';
import {
  readSidebarEnvironment,
  sameSidebarEnvironment,
  SIDEBAR_SELECTORS,
  type SidebarEnvironment,
} from './selectors';

const REFRESH_DELAYS_MS = [250, 1000, 2500] as const;

function getPlayer(doc: Document): Element | null {
  return (
    doc.querySelector(SIDEBAR_SELECTORS.player) ??
    doc.querySelector(SIDEBAR_SELECTORS.playerFallback) ??
    doc.querySelector('video')
  );
}

/**
 * Keep a measured `SidebarEnvironment` in sync with the page.
 *
 * YouTube mounts the watch-page layout asynchronously after SPA navigation, so
 * besides the immediate resize/fullscreen/navigation events we re-read the
 * environment a few times after mount. Theater mode only toggles a class on
 * the player, which is watched directly (a body-wide MutationObserver would
 * fire constantly on YouTube).
 */
export function useSidebarEnvironment(doc: Document = document): SidebarEnvironment {
  const [environment, setEnvironment] = useState<SidebarEnvironment>(() =>
    readSidebarEnvironment(doc),
  );

  useEffect(() => {
    let disposed = false;
    let observedPlayer: Element | null = null;
    let classObserver: MutationObserver | null = null;
    let refreshTimers: Array<ReturnType<typeof setTimeout>> = [];

    const update = (): void => {
      if (disposed) return;
      const next = readSidebarEnvironment(doc);
      setEnvironment((previous) =>
        sameSidebarEnvironment(previous, next) ? previous : next,
      );
    };

    const watchPlayer = (): void => {
      const player = getPlayer(doc);
      if (player === observedPlayer) return;
      observedPlayer = player;
      classObserver?.disconnect();
      classObserver =
        player && typeof MutationObserver !== 'undefined'
          ? new MutationObserver(update)
          : null;
      classObserver?.observe(player as Element, {
        attributes: true,
        attributeFilter: ['class'],
      });
    };

    const clearRefreshTimers = (): void => {
      for (const timer of refreshTimers) clearTimeout(timer);
      refreshTimers = [];
    };

    // Re-read a few times after navigation: YouTube mounts the watch-page
    // layout (and `#secondary`) asynchronously after its SPA transition.
    const scheduleRefresh = (): void => {
      clearRefreshTimers();
      refreshTimers = REFRESH_DELAYS_MS.map((delay) => setTimeout(update, delay));
    };

    const onPageChange = (): void => {
      watchPlayer();
      update();
      scheduleRefresh();
    };

    const view = doc.defaultView;
    view?.addEventListener('resize', onPageChange);
    doc.addEventListener('fullscreenchange', onPageChange);
    doc.addEventListener('yt-navigate-finish', onPageChange);
    doc.addEventListener('yt-page-data-updated', onPageChange);

    watchPlayer();
    update();
    scheduleRefresh();

    return () => {
      disposed = true;
      view?.removeEventListener('resize', onPageChange);
      doc.removeEventListener('fullscreenchange', onPageChange);
      doc.removeEventListener('yt-navigate-finish', onPageChange);
      doc.removeEventListener('yt-page-data-updated', onPageChange);
      clearRefreshTimers();
      classObserver?.disconnect();
      observedPlayer = null;
    };
  }, [doc]);

  return environment;
}
