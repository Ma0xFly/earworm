import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@/lib/contracts';
import { SETTINGS_STORAGE_KEY } from '@/lib/settings';
import { createShadowUi } from '@/lib/ui/shadow';
import { NATIVE_CAPTION_STYLE_ID } from '@/lib/ui/page-style';
import { AppProviders } from '@/features/app/providers';
import { ContentApp } from '@/features/app/ContentApp';
import { mountContentApp, unmountContentApp } from '@/features/app/boot';
import { seedStorage } from './mocks/chrome';

afterEach(() => {
  unmountContentApp();
});

describe('content app shell', () => {
  it('renders the root with blur attributes from persisted settings', async () => {
    seedStorage(SETTINGS_STORAGE_KEY, {
      ...DEFAULT_SETTINGS,
      blur: { en: true, zh: false },
      ui: { sidebar: true },
    });

    const ui = createShadowUi({ css: '' });
    ui.mount();
    const root = createRoot(ui.container);

    await act(async () => {
      root.render(
        <AppProviders container={ui.portalContainer}>
          <ContentApp />
        </AppProviders>,
      );
    });

    const app = ui.container.querySelector('[data-earworm-root]');
    expect(app).not.toBeNull();
    await waitFor(() => {
      expect(app).toHaveAttribute('data-blur-en', '1');
      expect(app).toHaveAttribute('data-blur-zh', '0');
    });

    act(() => root.unmount());
    ui.unmount();
  });

  it('activates native caption suppression with the overlay and cleans it up', async () => {
    let mounted: ReturnType<typeof mountContentApp> | null = null;
    await act(async () => {
      mounted = mountContentApp({ css: '/* test css */' });
    });

    expect(mounted).not.toBeNull();
    const host = document.querySelector('earworm-root');
    expect(host).not.toBeNull();
    expect(host?.shadowRoot?.querySelector('style')?.textContent).toContain('test css');

    // The T8 overlay owns activation through installNativeCaptionSuppression();
    // mounting the content app activates it and teardown must remove it.
    expect(document.documentElement.getAttribute('data-earworm-active')).toBe('1');
    expect(document.getElementById(NATIVE_CAPTION_STYLE_ID)).not.toBeNull();

    act(() => unmountContentApp());
    expect(document.querySelector('earworm-root')).toBeNull();
    expect(document.getElementById(NATIVE_CAPTION_STYLE_ID)).toBeNull();
    expect(document.documentElement.hasAttribute('data-earworm-active')).toBe(false);
  });
});
