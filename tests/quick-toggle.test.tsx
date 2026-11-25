/**
 * Quick toggle (F2 / ticket #31): the control-bar button, global switch and
 * the shadow-root quick menu. Only the session state (wall-clock/background
 * channel) is mocked; settings, blur, overlay and the Radix portal are real.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type LearningSentence, type Settings } from '@/lib/contracts';
import type { SessionState } from '@/features/session';
import { SETTINGS_STORAGE_KEY } from '@/lib/settings';
import { createShadowUi, type ShadowUi } from '@/lib/ui/shadow';
import { NATIVE_CAPTION_STYLE_ID } from '@/lib/ui/page-style';
import { AppProviders } from '@/features/app/providers';
import { ContentApp } from '@/features/app/ContentApp';
import { chromeMock, readStorage, seedStorage } from './mocks/chrome';

const sessionMock = vi.hoisted(() => ({
  state: null as SessionState | null,
  retryAll: vi.fn(),
}));

// Shipped data files are not fetchable under chrome-extension:// in happy-dom.
const seams = vi.hoisted(() => ({
  loadCollocationTable: vi.fn(),
  preloadDictionary: vi.fn(),
}));

vi.mock('@/lib/collocations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/collocations')>();
  return { ...actual, loadCollocationTable: seams.loadCollocationTable };
});

vi.mock('@/lib/dict', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dict')>();
  return { ...actual, preloadDictionary: seams.preloadDictionary };
});

vi.mock('@/features/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/session')>();
  return {
    ...actual,
    useSession: () => ({
      ...actual.idleSessionApi,
      state: sessionMock.state ?? actual.idleSessionApi.state,
      retryAll: sessionMock.retryAll,
    }),
  };
});

function readyState(overrides: Partial<SessionState> = {}): SessionState {
  const sentence: LearningSentence = {
    id: 0,
    start: 0,
    end: 2,
    text: 'Hello world.',
    cueStart: 0,
    cueEnd: 0,
    cols: [],
    status: 'done',
  };
  return {
    videoId: 'video-1',
    meta: null,
    status: 'ready',
    sentences: [sentence],
    currentIndex: 0,
    translation: { state: 'done', done: 1, total: 1, failed: 0 },
    ...overrides,
  };
}

function buildPlayer(): { bar: HTMLElement; cc: HTMLButtonElement } {
  const player = document.createElement('div');
  player.id = 'movie_player';
  const bar = document.createElement('div');
  bar.className = 'ytp-chrome-bottom';
  const right = document.createElement('div');
  right.className = 'ytp-right-controls';
  const cc = document.createElement('button');
  cc.className = 'ytp-subtitles-button';
  const fullscreen = document.createElement('button');
  fullscreen.className = 'ytp-fullscreen-button';
  right.append(cc, fullscreen);
  bar.appendChild(right);
  player.appendChild(bar);
  document.body.appendChild(player);
  return { bar, cc };
}

type Mounted = { ui: ShadowUi; root: Root };
const mounted: Mounted[] = [];

async function mountApp(): Promise<Mounted> {
  const ui = createShadowUi({ css: '' });
  ui.mount();
  const root = createRoot(ui.container);
  mounted.push({ ui, root });
  await act(async () => {
    root.render(
      <AppProviders container={ui.portalContainer}>
        <ContentApp />
      </AppProviders>,
    );
  });
  return { ui, root };
}

function quickHost(): HTMLElement {
  const host = document.querySelector<HTMLElement>('earworm-quick-toggle-host');
  expect(host).not.toBeNull();
  return host!;
}

function inHost<T extends Element>(selector: string): T {
  const element = quickHost().shadowRoot?.querySelector<T>(selector) ?? null;
  expect(element).not.toBeNull();
  return element!;
}

async function openMenu(ui: ShadowUi): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(inHost<HTMLElement>('[data-earworm-quick-menu-trigger]'));
  });
  const menu = await waitFor(() => {
    const found = ui.portalContainer.querySelector<HTMLElement>('[data-earworm-quick-menu]');
    expect(found).not.toBeNull();
    return found!;
  });
  return menu;
}

beforeEach(() => {
  sessionMock.state = readyState();
  sessionMock.retryAll.mockReset();
  seams.loadCollocationTable.mockReset().mockResolvedValue([]);
  seams.preloadDictionary.mockReset().mockResolvedValue(null);
  seedStorage(SETTINGS_STORAGE_KEY, { ...DEFAULT_SETTINGS });
  buildPlayer();
});

afterEach(() => {
  for (const instance of mounted.splice(0)) {
    act(() => instance.root.unmount());
    instance.ui.unmount();
  }
  document.body.innerHTML = '';
});

describe('quick toggle button', () => {
  it('injects the logo button left of the CC button and toggles the persisted master switch', async () => {
    await mountApp();
    const cc = document.querySelector<HTMLElement>('.ytp-subtitles-button');
    expect(cc?.previousElementSibling).toBe(quickHost());

    const icon = inHost<HTMLImageElement>('[data-earworm-quick-toggle] img');
    expect(icon.getAttribute('src')).toContain('brand/earworm-icon-32.png');
    expect(inHost('[data-earworm-quick-toggle]')).toHaveAttribute('aria-pressed', 'true');

    await act(async () => {
      fireEvent.click(inHost<HTMLElement>('[data-earworm-quick-toggle]'));
    });
    await waitFor(() => {
      expect((readStorage(SETTINGS_STORAGE_KEY) as Settings).ui.enabled).toBe(false);
    });
    await waitFor(() =>
      expect(quickHost().shadowRoot?.querySelector('[data-earworm-quick-toggle]')).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );
  });

  it('hides the overlay and restores native captions when switched off', async () => {
    const { ui } = await mountApp();
    await waitFor(() => expect(ui.container.querySelector('[data-ew-overlay]')).not.toBeNull());
    expect(document.documentElement.getAttribute('data-earworm-active')).toBe('1');
    expect(document.getElementById(NATIVE_CAPTION_STYLE_ID)).not.toBeNull();

    await act(async () => {
      fireEvent.click(inHost<HTMLElement>('[data-earworm-quick-toggle]'));
    });

    await waitFor(() => {
      expect(ui.container.querySelector('[data-ew-overlay]')).toBeNull();
      expect(document.documentElement.hasAttribute('data-earworm-active')).toBe(false);
      expect(document.getElementById(NATIVE_CAPTION_STYLE_ID)).toBeNull();
    });
  });

  it('keeps the same control-bar host across a SPA player rebuild', async () => {
    const { ui } = await mountApp();
    const host = quickHost();

    document.querySelector('#movie_player')?.remove();
    const { cc } = buildPlayer();
    await act(async () => {
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });

    await waitFor(() => expect(cc.previousElementSibling).toBe(host));
    await openMenu(ui);
    expect(ui.portalContainer.querySelector('[data-earworm-quick-menu]')).not.toBeNull();
  });
});

describe('quick menu', () => {
  it('renders in the shadow portal with blur, translation status/retry, settings and export', async () => {
    sessionMock.state = readyState({
      translation: { state: 'partial', done: 1, total: 2, failed: 1 },
    });
    const { ui } = await mountApp();
    const menu = await openMenu(ui);

    expect(menu.classList.contains('dark')).toBe(true);
    expect(document.body.querySelector('[data-earworm-quick-menu]')).toBeNull();
    expect(ui.shadow.contains(menu)).toBe(true);

    expect(within(menu).getByRole('switch', { name: '模糊英文' })).toBeInTheDocument();
    expect(within(menu).getByRole('switch', { name: '模糊中文' })).toBeInTheDocument();
    expect(menu.textContent).toContain('翻译 1/2');
    expect(menu.textContent).toContain('失败 1');

    await act(async () => {
      fireEvent.click(within(menu).getByRole('button', { name: '全部重试' }));
    });
    expect(sessionMock.retryAll).toHaveBeenCalledTimes(1);

    expect(menu.querySelector('[data-earworm-export]')).not.toBeNull();
    await act(async () => {
      fireEvent.click(within(menu).getByRole('button', { name: '设置' }));
    });
    expect(chromeMock.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it('replaces the floating blur layer with switches that persist independently', async () => {
    const { ui } = await mountApp();
    expect(document.querySelector('[data-earworm-blur-controls]')).toBeNull();

    const menu = await openMenu(ui);
    const en = within(menu).getByRole('switch', { name: '模糊英文' });
    const zh = within(menu).getByRole('switch', { name: '模糊中文' });

    await act(async () => {
      fireEvent.click(en);
    });
    await waitFor(() => {
      expect((readStorage(SETTINGS_STORAGE_KEY) as Settings).blur).toEqual({
        en: true,
        zh: false,
      });
      expect(ui.container.querySelector('[data-earworm-root]')).toHaveAttribute(
        'data-blur-en',
        '1',
      );
    });
    expect(zh).toHaveAttribute('aria-checked', 'false');
  });
});
