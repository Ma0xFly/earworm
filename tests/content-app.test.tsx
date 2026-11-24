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

  it('does not hide native captions before captions are ready, and mounts cleanly', async () => {
    let mounted: ReturnType<typeof mountContentApp> | null = null;
    await act(async () => {
      mounted = mountContentApp({ css: '/* test css */' });
    });

    expect(mounted).not.toBeNull();
    const host = document.querySelector('earworm-root');
    expect(host).not.toBeNull();
    expect(host?.shadowRoot?.querySelector('style')?.textContent).toContain('test css');

    // Real sessions start in acquiring; native captions must stay visible
    // until the overlay has a ready track (see overlay lifecycle tests).
    expect(document.documentElement.getAttribute('data-earworm-active')).toBeNull();
    expect(document.getElementById(NATIVE_CAPTION_STYLE_ID)).toBeNull();

    act(() => unmountContentApp());
    expect(document.querySelector('earworm-root')).toBeNull();
    expect(document.getElementById(NATIVE_CAPTION_STYLE_ID)).toBeNull();
  });
});
