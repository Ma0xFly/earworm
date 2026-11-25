import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { PortalContainerProvider } from '@/lib/ui/portal';
import { createShadowUi, type ShadowUi } from '@/lib/ui/shadow';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function mountPopover(): { ui: ShadowUi; root: Root } {
  const ui = createShadowUi({ css: '' });
  ui.mount();
  const root = createRoot(ui.container);
  cleanups.push(() => {
    act(() => root.unmount());
    ui.unmount();
  });

  act(() => {
    root.render(
      <PortalContainerProvider container={ui.portalContainer}>
        <Popover defaultOpen>
          <PopoverTrigger>word</PopoverTrigger>
          <PopoverContent>dictionary entry</PopoverContent>
        </Popover>
      </PortalContainerProvider>,
    );
  });
  return { ui, root };
}

describe('Radix portal inside the shadow root', () => {
  it('renders popover content in the shadow-root portal, never document.body', async () => {
    const { ui } = mountPopover();

    await waitFor(() => {
      expect(ui.portalContainer.querySelector('[data-slot="popover-content"]')).not.toBeNull();
    });

    const content = ui.portalContainer.querySelector('[data-slot="popover-content"]');
    expect(content?.textContent).toBe('dictionary entry');
    expect(ui.shadow.contains(content)).toBe(true);
    expect(document.body.querySelector('[data-slot="popover-content"]')).toBeNull();
  });
});
