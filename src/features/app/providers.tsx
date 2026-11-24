import type { ReactNode } from 'react';
import { PortalContainerProvider, type PortalContainer } from '@/lib/ui/portal';
import { SettingsProvider } from '@/lib/settings';
import { SessionProvider } from '@/features/session';

/**
 * Provider composition for the content app. `container` is the shadow-root
 * portal target created by `createShadowUi` so Radix popups stay isolated.
 */
export function AppProviders({
  container,
  children,
}: {
  container: PortalContainer;
  children?: ReactNode;
}) {
  return (
    <PortalContainerProvider container={container}>
      <SettingsProvider>
        <SessionProvider>{children}</SessionProvider>
      </SettingsProvider>
    </PortalContainerProvider>
  );
}
