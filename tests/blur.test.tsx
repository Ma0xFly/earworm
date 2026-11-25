import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/contracts';
import { SETTINGS_STORAGE_KEY, SettingsProvider } from '@/lib/settings';
import { createShadowUi } from '@/lib/ui/shadow';
import { BlurStyles, BlurSwitches } from '@/features/blur';
import { AppProviders } from '@/features/app/providers';
import { ContentApp } from '@/features/app/ContentApp';
import { readStorage, seedStorage } from './mocks/chrome';

type Mounted = {
  ui: ReturnType<typeof createShadowUi>;
  root: ReturnType<typeof createRoot>;
};

const mounted: Mounted[] = [];

function mountShadow(): Mounted {
  const ui = createShadowUi({ css: '' });
  ui.mount();
  const root = createRoot(ui.container);
  mounted.push({ ui, root });
  return { ui, root };
}

async function render(node: ReactNode): Promise<Mounted> {
  const instance = mountShadow();
  await act(async () => {
    instance.root.render(node);
  });
  return instance;
}

function seeded(blur: Settings['blur']): void {
  seedStorage(SETTINGS_STORAGE_KEY, { ...DEFAULT_SETTINGS, blur });
}

afterEach(() => {
  for (const instance of mounted.splice(0)) {
    act(() => instance.root.unmount());
    instance.ui.unmount();
  }
});

describe('blur switches (quick-menu controls)', () => {
  it('renders two independent switches with accessible names from persisted blur settings', async () => {
    seeded({ en: true, zh: false });
    const { ui } = await render(
      createElement(SettingsProvider, null, createElement(BlurSwitches)),
    );

    const en = await waitFor(() =>
      within(ui.container).getByRole('switch', { name: '模糊英文' }),
    );
    const zh = within(ui.container).getByRole('switch', { name: '模糊中文' });

    expect(within(ui.container).getAllByRole('switch')).toHaveLength(2);
    expect(en).toHaveAttribute('aria-checked', 'true');
    expect(zh).toHaveAttribute('aria-checked', 'false');
    expect(within(ui.container).getByText('英')).toBeInTheDocument();
    expect(within(ui.container).getByText('中')).toBeInTheDocument();

    // v1.1: the old floating glass pill is gone; the switches live in the menu.
    expect(ui.container.querySelector('[data-earworm-blur-controls]')).toBeNull();
  });

  it('persists each blur toggle independently without resetting its sibling', async () => {
    seeded({ en: false, zh: false });
    const { ui } = await render(
      createElement(SettingsProvider, null, createElement(BlurSwitches)),
    );

    const en = await waitFor(() =>
      within(ui.container).getByRole('switch', { name: '模糊英文' }),
    );
    const zh = within(ui.container).getByRole('switch', { name: '模糊中文' });

    act(() => {
      fireEvent.click(zh);
    });
    await waitFor(() => {
      expect(zh).toHaveAttribute('aria-checked', 'true');
    });
    expect(en).toHaveAttribute('aria-checked', 'false');
    await waitFor(() => {
      expect((readStorage(SETTINGS_STORAGE_KEY) as Settings).blur).toEqual({
        en: false,
        zh: true,
      });
    });

    act(() => {
      fireEvent.click(en);
    });
    await waitFor(() => {
      expect(en).toHaveAttribute('aria-checked', 'true');
      expect((readStorage(SETTINGS_STORAGE_KEY) as Settings).blur).toEqual({
        en: true,
        zh: true,
      });
    });
  });

  it('injects shadow-root CSS that blurs each language independently', async () => {
    seeded({ en: true, zh: true });
    const { ui } = await render(
      <SettingsProvider>
        <div data-earworm-root data-blur-en="1" data-blur-zh="0">
          <p data-lang="en">Hello</p>
          <p data-lang="zh">你好</p>
          <p data-no-lang>no language marker</p>
        </div>
        <BlurStyles />
      </SettingsProvider>,
    );

    const style = ui.shadow.querySelector('style[data-earworm-blur-css]');
    expect(style).not.toBeNull();
    expect(ui.shadow.contains(style)).toBe(true);
    expect(document.head.querySelector('style[data-earworm-blur-css]')).toBeNull();

    const en = ui.container.querySelector('[data-lang="en"]');
    const zh = ui.container.querySelector('[data-lang="zh"]');
    const unmarked = ui.container.querySelector('[data-no-lang]');
    expect(en).not.toBeNull();
    expect(zh).not.toBeNull();
    expect(unmarked).not.toBeNull();

    // English is enabled on this fixture, Chinese is off: independent rules.
    expect(getComputedStyle(en as Element).filter).toBe('blur(5px)');
    expect(getComputedStyle(zh as Element).filter).not.toContain('blur');
    expect(getComputedStyle(unmarked as Element).filter).not.toContain('blur');

    // Filter-only rules never participate in layout.
    expect(getComputedStyle(en as Element).transition).toContain('120ms');

    // happy-dom cannot evaluate :hover / :focus-within, so assert the rules
    // exist in the injected shadow stylesheet (the only place a browser reads
    // them from).
    const css = style?.textContent ?? '';
    expect(css).toContain('[data-blur-en="1"] [data-lang="en"]:hover');
    expect(css).toContain('[data-blur-en="1"] [data-lang="en"]:focus-within');
    expect(css).toContain('[data-blur-zh="1"] [data-lang="zh"]:hover');
    expect(css).toContain('[data-blur-zh="1"] [data-lang="zh"]:focus-within');
    expect(css).toMatch(/:hover[^{]*\{[^}]*filter:\s*none/);
    expect(css).toMatch(/:focus-within[^{]*\{[^}]*filter:\s*none/);
  });

  it('applies the blur end to end from a menu switch through ContentApp attributes', async () => {
    seeded({ en: false, zh: false });

    const player = document.createElement('div');
    player.id = 'movie_player';
    const bar = document.createElement('div');
    bar.className = 'ytp-chrome-bottom';
    const cc = document.createElement('button');
    cc.className = 'ytp-subtitles-button';
    bar.appendChild(cc);
    player.appendChild(bar);
    document.body.appendChild(player);

    const { ui, root } = mountShadow();
    await act(async () => {
      root.render(
        <AppProviders container={ui.portalContainer}>
          <ContentApp />
        </AppProviders>,
      );
    });

    const host = document.querySelector('earworm-quick-toggle-host');
    const arrow = host?.shadowRoot?.querySelector<HTMLElement>(
      '[data-earworm-quick-menu-trigger]',
    );
    expect(arrow).not.toBeNull();
    await act(async () => {
      fireEvent.click(arrow!);
    });
    const menu = await waitFor(() => {
      const found = ui.portalContainer.querySelector('[data-earworm-quick-menu]');
      expect(found).not.toBeNull();
      return found!;
    });
    const en = await waitFor(() =>
      within(menu as HTMLElement).getByRole('switch', { name: '模糊英文' }),
    );
    const appRoot = await waitFor(() => {
      const element = ui.container.querySelector('[data-earworm-root]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });

    await waitFor(() => {
      expect(appRoot).toHaveAttribute('data-blur-en', '0');
      expect(appRoot).toHaveAttribute('data-blur-zh', '0');
    });

    act(() => {
      fireEvent.click(en);
    });

    await waitFor(() => {
      expect(appRoot).toHaveAttribute('data-blur-en', '1');
      expect(appRoot).toHaveAttribute('data-blur-zh', '0');
    });

    // Any node a feature renders with `data-lang` inside the shadow root is
    // picked up by the same sheet, with no per-feature wiring.
    const caption = ui.container.ownerDocument.createElement('p');
    caption.setAttribute('data-lang', 'en');
    caption.textContent = 'Hello';
    appRoot.appendChild(caption);
    expect(getComputedStyle(caption).filter).toBe('blur(5px)');

    caption.setAttribute('data-lang', 'zh');
    expect(getComputedStyle(caption).filter).not.toContain('blur');
  });
});
