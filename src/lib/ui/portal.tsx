import { createContext, useContext, type ReactNode } from 'react';

/**
 * Radix portals default to `document.body`, which would escape our shadow
 * root and lose the isolated styles. `PortalContainerProvider` publishes the
 * shadow-root container; every shadcn Popover/Dialog wrapper reads it via
 * `usePortalContainer()` and passes it to Radix's `Portal`.
 */
export type PortalContainer = HTMLElement | DocumentFragment | null;

const PortalContainerContext = createContext<PortalContainer>(null);

export function PortalContainerProvider({
  container,
  children,
}: {
  container: PortalContainer;
  children?: ReactNode;
}) {
  return (
    <PortalContainerContext.Provider value={container}>
      {children}
    </PortalContainerContext.Provider>
  );
}

export function usePortalContainer(): PortalContainer {
  return useContext(PortalContainerContext);
}
