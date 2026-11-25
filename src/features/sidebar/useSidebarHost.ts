import { useEffect, useState } from 'react';
import {
  createSidebarHost,
  startSidebarHostLifecycle,
  type SidebarHost,
} from './host';

export type UseSidebarHostOptions = {
  /** Compiled content stylesheet injected into the nested shadow root. */
  css: string;
  /** Docked panel visible and in document flow: attach and keep the host synced. */
  enabled: boolean;
};

/**
 * Own the nested sidebar host for the lifetime of the sidebar.
 *
 * The host exists even while the panel is collapsed or a drawer (it is just
 * detached), so toggling the layout never has to rebuild the shadow root or
 * the portal target. `enabled` drives attach/detach and the SPA lifecycle
 * watcher; the returned host is the portal target for the docked panel.
 */
export function useSidebarHost({ css, enabled }: UseSidebarHostOptions): SidebarHost | null {
  const [host, setHost] = useState<SidebarHost | null>(null);

  useEffect(() => {
    const instance = createSidebarHost({ css });
    setHost(instance);
    return () => {
      instance.destroy();
      setHost((current) => (current === instance ? null : current));
    };
  }, [css]);

  useEffect(() => {
    if (!host) return;
    if (!enabled) {
      host.detach();
      return;
    }
    host.attach();
    return startSidebarHostLifecycle(host);
  }, [host, enabled]);

  return host;
}
