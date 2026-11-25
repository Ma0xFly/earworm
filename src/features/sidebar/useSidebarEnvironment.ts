import { useEffect, useState } from 'react';
import {
  readSidebarEnvironment,
  sameSidebarEnvironment,
  type SidebarEnvironment,
} from './selectors';

const REFRESH_DELAYS_MS = [250, 1000, 2500] as const;

/**
 * Keep a measured `SidebarEnvironment` in sync with the page.
 *
 * YouTube mounts the watch-page layout asynchronously after SPA navigation, so
 * besides the immediate resize/fullscreen/navigation events we re-read the
 * environment a few times after mount. The mode only depends on `#secondary`
 * availability and fullscreen, so no DOM mutation observer is needed (and a
 * body-wide one would fire constantly on YouTube).
 */
export function useSidebarEnvironment(doc: Document = document): SidebarEnvironment {
  const [environment, setEnvironment] = useState<SidebarEnvironment>(() =>
    readSidebarEnvironment(doc),
  );

  useEffect(() => {
    let disposed = false;
    let refreshTimers: Array<ReturnType<typeof setTimeout>> = [];

    const update = (): void => {
      if (disposed) return;
      const next = readSidebarEnvironment(doc);
      setEnvironment((previous) =>
        sameSidebarEnvironment(previous, next) ? previous : next,
      );
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
      update();
      scheduleRefresh();
    };

    const view = doc.defaultView;
    view?.addEventListener('resize', onPageChange);
    doc.addEventListener('fullscreenchange', onPageChange);
    doc.addEventListener('yt-navigate-finish', onPageChange);
    doc.addEventListener('yt-page-data-updated', onPageChange);

    update();
    scheduleRefresh();

    return () => {
      disposed = true;
      view?.removeEventListener('resize', onPageChange);
      doc.removeEventListener('fullscreenchange', onPageChange);
      doc.removeEventListener('yt-navigate-finish', onPageChange);
      doc.removeEventListener('yt-page-data-updated', onPageChange);
      clearRefreshTimers();
    };
  }, [doc]);

  return environment;
}
