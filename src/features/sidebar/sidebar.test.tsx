import { act } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type LearningSentence } from '@/lib/contracts';
import { SETTINGS_STORAGE_KEY, SettingsProvider } from '@/lib/settings';
import { seedStorage } from '../../../tests/mocks/chrome';
import type { SessionApi, SessionState } from '@/features/session';
import { Sidebar } from './Sidebar';

/**
 * The sidebar consumes the session and settings context from the shared
 * contracts. The session provider is a fixed no-op in this ticket (T13 owns
 * it), so tests supply the `useSession()` result directly; settings run for
 * real through `SettingsProvider` + the chrome storage mock.
 *
 * Docked mode renders through a portal into `<earworm-sidebar-host>`, which
 * owns a nested shadow root inside YouTube's `#secondary-inner`; the query
 * helpers below search the host's shadow tree as well as the main document.
 */
const sessionMock = vi.hoisted(() => ({ api: null as unknown }));

vi.mock('@/features/session', () => ({
  useSession: () => sessionMock.api,
}));

function makeSentence(
  id: number,
  text: string,
  zh?: string,
  status: LearningSentence['status'] = 'done',
): LearningSentence {
  return {
    id,
    start: id * 3,
    end: id * 3 + 2.5,
    text,
    cueStart: id,
    cueEnd: id,
    zh,
    cols: [],
    status,
  };
}

function makeSession(
  overrides: Partial<SessionState> = {},
  api: Partial<SessionApi> = {},
): SessionApi {
  return {
    state: {
      videoId: 'video-1',
      meta: null,
      status: 'ready',
      sentences: [],
      currentIndex: 0,
      translation: { state: 'done', done: 0, total: 0, failed: 0 },
      ...overrides,
    },
    seekToSentence: vi.fn(),
    retrySentence: vi.fn(),
    retryAll: vi.fn(),
    setContinuous: vi.fn(),
    toggleSidebar: vi.fn(),
    ...api,
  };
}

async function renderSidebar(api: SessionApi) {
  sessionMock.api = api;
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(
      <SettingsProvider>
        <Sidebar />
      </SettingsProvider>,
    );
  });
  return result as ReturnType<typeof render>;
}

/** The document-flow host inserted into the recommended-videos column. */
function sidebarHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>('earworm-sidebar-host');
}

function shadowQuery<T extends Element>(selector: string): T | null {
  return sidebarHost()?.shadowRoot?.querySelector<T>(selector) ?? null;
}

/** Query inside the sidebar wherever it renders (main document or nested shadow). */
function sidebarQuery<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector) ?? shadowQuery<T>(selector);
}

function sidebarQueryAll<T extends Element>(selector: string): T[] {
  const host = sidebarHost();
  return [
    ...Array.from(document.querySelectorAll<T>(selector)),
    ...(host?.shadowRoot ? Array.from(host.shadowRoot.querySelectorAll<T>(selector)) : []),
  ];
}

function panel(): HTMLElement | null {
  return sidebarQuery('[data-earworm-sidebar]');
}

function header(): HTMLElement | null {
  return sidebarQuery('[data-sidebar-header]');
}

function sentenceList(): HTMLElement | null {
  return sidebarQuery('[data-sentence-list]');
}

function sentenceRows(): HTMLElement[] {
  return sidebarQueryAll('[data-sentence-id]');
}

function sentenceRow(id: number): HTMLElement | null {
  return sidebarQuery(`[data-sentence-id="${id}"]`);
}

beforeEach(() => {
  seedStorage(SETTINGS_STORAGE_KEY, {
    ...DEFAULT_SETTINGS,
    ui: { sidebar: true },
  });
});

describe('sidebar sentence list', () => {
  it('renders every sentence with English + Chinese and marks the current row with aria-current', async () => {
    await renderSidebar(
      makeSession({
        sentences: [
          makeSentence(0, 'Hello there.', '你好。'),
          makeSentence(1, 'How are you?', '你好吗？'),
          makeSentence(2, 'I am fine.', '我很好。'),
        ],
        currentIndex: 1,
      }),
    );

    const rows = sentenceRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('Hello there.');
    expect(rows[0]?.textContent).toContain('你好。');
    expect(rows[1]).toHaveAttribute('aria-current', 'true');
    expect(rows[0]).not.toHaveAttribute('aria-current');
    expect(rows[2]).not.toHaveAttribute('aria-current');
  });

  it('seeks to a sentence on row click and on Enter/Space', async () => {
    const api = makeSession({
      sentences: [makeSentence(0, 'One.'), makeSentence(1, 'Two.'), makeSentence(2, 'Three.')],
      currentIndex: 0,
    });
    await renderSidebar(api);

    const rowOne = sentenceRow(1);
    const rowTwo = sentenceRow(2);
    expect(rowOne).not.toBeNull();
    expect(rowTwo).not.toBeNull();

    fireEvent.click(rowOne as HTMLElement);
    expect(api.seekToSentence).toHaveBeenCalledWith(1);

    fireEvent.keyDown(rowTwo as HTMLElement, { key: 'Enter' });
    expect(api.seekToSentence).toHaveBeenLastCalledWith(2);

    fireEvent.keyDown(rowTwo as HTMLElement, { key: ' ' });
    expect(api.seekToSentence).toHaveBeenLastCalledWith(2);
    expect(api.seekToSentence).toHaveBeenCalledTimes(3);
  });

  it('only retries a failed sentence from its retry control, without seeking', async () => {
    const api = makeSession({
      sentences: [
        makeSentence(0, 'One.'),
        makeSentence(1, 'Two.', undefined, 'failed'),
        makeSentence(2, 'Three.'),
      ],
      currentIndex: 0,
    });
    await renderSidebar(api);

    const failedRow = sentenceRow(1);
    expect(failedRow?.textContent).toContain('翻译失败');

    const retry = within(failedRow as HTMLElement).getByRole('button', { name: /重试/ });
    fireEvent.click(retry);

    expect(api.retrySentence).toHaveBeenCalledWith(1);
    expect(api.seekToSentence).not.toHaveBeenCalled();
  });

  it('shows a pending placeholder for untranslated sentences', async () => {
    await renderSidebar(
      makeSession({
        sentences: [makeSentence(0, 'One.', undefined, 'pending')],
      }),
    );

    const row = sentenceRow(0);
    expect(row?.textContent).toContain('翻译中');
  });
});

describe('sidebar header', () => {
  it('shows translation progress with failures and retries all failed sentences', async () => {
    const api = makeSession({
      sentences: [makeSentence(0, 'One.')],
      translation: { state: 'partial', done: 12, total: 40, failed: 3 },
    });
    await renderSidebar(api);

    const panelHeader = header();
    expect(panelHeader).not.toBeNull();
    expect(panelHeader?.textContent).toContain('12/40');
    expect(panelHeader?.textContent).toContain('失败 3');

    fireEvent.click(
      within(panelHeader as HTMLElement).getByRole('button', { name: '全部重试' }),
    );
    expect(api.retryAll).toHaveBeenCalledTimes(1);
  });

  it('hides the retry-all action when nothing failed', async () => {
    await renderSidebar(makeSession({ sentences: [makeSentence(0, 'One.')] }));
    const panelHeader = header();
    expect(
      within(panelHeader as HTMLElement).queryByRole('button', { name: '全部重试' }),
    ).toBeNull();
  });
});

describe('sidebar states', () => {
  it('shows the loading state while captions are acquired', async () => {
    await renderSidebar(makeSession({ status: 'acquiring' }));
    expect(panel()?.textContent).toContain('字幕载入中');
  });

  it('shows the no-captions state without rendering a list', async () => {
    await renderSidebar(makeSession({ status: 'no-captions', sentences: [] }));
    expect(panel()?.textContent).toContain('无字幕');
    expect(sentenceRows()).toHaveLength(0);
  });

  it('shows the error state', async () => {
    await renderSidebar(makeSession({ status: 'error', error: 'boom' }));
    expect(panel()?.textContent).toContain('字幕获取失败');
    expect(sentenceRows()).toHaveLength(0);
  });

  it('shows a Chinese hint instead of the raw acquisition failure code', async () => {
    await renderSidebar(makeSession({ status: 'error', error: 'nudge-failed' }));

    const notice = panel();
    expect(notice?.textContent).toContain('字幕获取失败');
    expect(notice?.textContent).toContain('播放器未能加载所选字幕轨，请重试');
    expect(notice?.textContent).not.toContain('nudge-failed');
  });

  it('falls back to a generic retry hint for an unknown failure reason', async () => {
    await renderSidebar(makeSession({ status: 'error', error: 'boom' }));

    expect(panel()?.textContent).toContain('请稍后重试');
    expect(panel()?.textContent).not.toContain('boom');
  });

  it('offers a retry that re-acquires captions in the error state', async () => {
    const api = makeSession({ status: 'error', error: 'timeout' });
    await renderSidebar(api);

    const retry = within(panel() as HTMLElement).getByRole('button', { name: '重试' });
    fireEvent.click(retry);

    expect(api.retryAll).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when ready but no sentences exist', async () => {
    await renderSidebar(makeSession({ status: 'ready', sentences: [] }));
    expect(panel()?.textContent).toContain('暂无字幕');
    expect(sentenceRows()).toHaveLength(0);
  });

  it('renders nothing before a session starts', async () => {
    await renderSidebar(makeSession({ status: 'idle', sentences: [] }));
    expect(panel()).toBeNull();
  });
});

describe('sidebar visibility', () => {
  it('hides the panel when the sidebar setting is off', async () => {
    seedStorage(SETTINGS_STORAGE_KEY, {
      ...DEFAULT_SETTINGS,
      ui: { sidebar: false },
    });
    await renderSidebar(makeSession({ sentences: [makeSentence(0, 'One.')] }));

    await waitFor(() => expect(panel()).toBeNull());
  });

  it('offers a persistent reopen control while the sidebar is hidden', async () => {
    seedStorage(SETTINGS_STORAGE_KEY, {
      ...DEFAULT_SETTINGS,
      ui: { sidebar: false },
    });
    await renderSidebar(makeSession({ sentences: [makeSentence(0, 'One.')] }));

    await waitFor(() => expect(panel()).toBeNull());
    const reopen = document.querySelector<HTMLElement>('[data-earworm-sidebar-reopen]');
    expect(reopen).not.toBeNull();
    expect(reopen).toHaveAccessibleName('显示字幕侧栏');
    expect(reopen?.className).toContain('pointer-events-auto');

    fireEvent.click(reopen as HTMLElement);
    await waitFor(() => expect(panel()).not.toBeNull());
  });

  it('closes the panel through the header toggle', async () => {
    await renderSidebar(makeSession({ sentences: [makeSentence(0, 'One.')] }));

    fireEvent.click(screen.getByRole('button', { name: '收起字幕侧栏' }));

    await waitFor(() => expect(panel()).toBeNull());
  });
});

describe('sidebar placement', () => {
  function setViewportWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  }

  function addSecondary(width = 400): HTMLElement {
    const secondary = document.createElement('div');
    secondary.id = 'secondary';
    secondary.getBoundingClientRect = () =>
      ({ x: 1016, y: 120, top: 120, left: 1016, right: 1416, bottom: 900, width, height: 780 }) as DOMRect;
    document.body.appendChild(secondary);
    return secondary;
  }

  /** Recommended-videos column as YouTube builds it: #secondary > #secondary-inner. */
  function addSecondaryWithInner(width = 400): {
    secondary: HTMLElement;
    inner: HTMLElement;
    recommended: HTMLElement;
  } {
    const secondary = addSecondary(width);
    const inner = document.createElement('div');
    inner.id = 'secondary-inner';
    const recommended = document.createElement('div');
    recommended.setAttribute('data-recommended', '');
    recommended.textContent = '推荐视频';
    inner.appendChild(recommended);
    secondary.appendChild(inner);
    return { secondary, inner, recommended };
  }

  it('prepends a nested host to #secondary-inner and docks the panel in the document flow', async () => {
    setViewportWidth(1440);
    const { inner, recommended } = addSecondaryWithInner();
    await renderSidebar(makeSession({ sentences: [makeSentence(0, 'One.')] }));

    const host = sidebarHost();
    expect(host).not.toBeNull();
    expect(host?.parentElement).toBe(inner);
    expect(inner.firstElementChild).toBe(host);
    expect(inner.children[1]).toBe(recommended);
    expect(host?.style.display).toBe('block');
    expect(host?.style.width).toBe('100%');

    const docked = panel();
    expect(docked).not.toBeNull();
    expect(docked).toHaveAttribute('data-mode', 'docked');
    expect(docked?.style.position).toBe('');
    expect(docked?.style.width).toBe('100%');
    expect(docked?.style.height).toBe('56vh');
    expect(docked?.style.minHeight).toBe('320px');
    expect(docked?.style.maxHeight).toBe('560px');
    expect(within(docked as HTMLElement).queryByRole('button', { name: '关闭字幕侧栏' })).toBeNull();

    // The same compiled stylesheet is injected into the nested shadow root,
    // including the host-attribute variant of the blur rules.
    const style = host?.shadowRoot?.querySelector('style[data-earworm-style]');
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain(':host([data-blur-en="1"]) [data-lang="en"]');
  });

  it('prepends to #secondary itself when the inner column is absent', async () => {
    setViewportWidth(1440);
    const secondary = addSecondary();
    const recommended = document.createElement('div');
    recommended.setAttribute('data-recommended', '');
    secondary.appendChild(recommended);

    await renderSidebar(makeSession({ sentences: [makeSentence(0, 'One.')] }));

    const host = sidebarHost();
    expect(host).not.toBeNull();
    expect(host?.parentElement).toBe(secondary);
    expect(secondary.firstElementChild).toBe(host);
    expect(secondary.children[1]).toBe(recommended);
    expect(panel()).toHaveAttribute('data-mode', 'docked');
  });

  it('gives the docked panel a fixed height with its own scrolling list', async () => {
    setViewportWidth(1440);
    addSecondaryWithInner();
    await renderSidebar(
      makeSession({
        sentences: [makeSentence(0, 'One.'), makeSentence(1, 'Two.')],
      }),
    );

    const docked = panel();
    expect(docked?.className).toContain('overflow-hidden');
    const list = sentenceList();
    expect(list).not.toBeNull();
    expect(list?.className).toContain('overflow-y-auto');
    expect(list?.className).toContain('overscroll-contain');
    expect(docked?.contains(list as Node)).toBe(true);
  });

  it('falls back to a fixed drawer when #secondary does not exist', async () => {
    setViewportWidth(1440);
    await renderSidebar(makeSession({ sentences: [makeSentence(0, 'One.')] }));

    expect(sidebarHost()).toBeNull();
    const drawer = panel();
    expect(drawer).not.toBeNull();
    expect(drawer).toHaveAttribute('data-mode', 'drawer');
    expect(drawer?.style.position).toBe('fixed');
    expect(drawer?.style.right).toBe('24px');
    expect(screen.getByRole('button', { name: '关闭字幕侧栏' })).toBeInTheDocument();
  });

  it('ignores the theater player class and stays docked when #secondary is available', async () => {
    setViewportWidth(1440);
    addSecondaryWithInner();
    const player = document.createElement('div');
    player.id = 'movie_player';
    player.classList.add('ytp-large-width-mode');
    document.body.appendChild(player);

    await renderSidebar(makeSession({ sentences: [makeSentence(0, 'One.')] }));

    expect(panel()).toHaveAttribute('data-mode', 'docked');
    expect(sidebarHost()?.parentElement).toBe(document.querySelector('#secondary-inner'));
  });

  it('recomputes placement after SPA navigation', async () => {
    setViewportWidth(1440);
    const { secondary } = addSecondaryWithInner();
    await renderSidebar(makeSession({ sentences: [makeSentence(0, 'One.')] }));
    expect(panel()).toHaveAttribute('data-mode', 'docked');

    secondary.remove();
    await act(async () => {
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });

    expect(panel()).toHaveAttribute('data-mode', 'drawer');
    expect(sidebarHost()).toBeNull();
  });

  it('docks when YouTube mounts the recommended column after mount', async () => {
    setViewportWidth(1440);
    await renderSidebar(makeSession({ sentences: [makeSentence(0, 'One.')] }));
    expect(panel()).toHaveAttribute('data-mode', 'drawer');

    const { inner } = addSecondaryWithInner();
    await act(async () => {
      document.dispatchEvent(new Event('yt-page-data-updated'));
    });
    await waitFor(() => expect(panel()).toHaveAttribute('data-mode', 'docked'));
    expect(sidebarHost()?.parentElement).toBe(inner);
  });

  it('switches to a drawer in fullscreen and closes it', async () => {
    setViewportWidth(1440);
    addSecondaryWithInner();
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => document.body,
    });
    try {
      await renderSidebar(makeSession({ sentences: [makeSentence(0, 'One.')] }));
      expect(panel()).toHaveAttribute('data-mode', 'drawer');
      expect(sidebarHost()).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: '关闭字幕侧栏' }));
      await waitFor(() => expect(panel()).toBeNull());
    } finally {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => null,
      });
    }
  });

  it('re-inserts the host after YouTube replaces #secondary-inner', async () => {
    setViewportWidth(1440);
    const { secondary, inner } = addSecondaryWithInner();
    await renderSidebar(makeSession({ sentences: [makeSentence(0, 'One.')] }));

    const host = sidebarHost();
    expect(inner.firstElementChild).toBe(host);

    const newInner = document.createElement('div');
    newInner.id = 'secondary-inner';
    const newRecommended = document.createElement('div');
    newRecommended.setAttribute('data-recommended', '');
    newInner.appendChild(newRecommended);
    secondary.replaceChildren(newInner);

    await act(async () => {
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });

    expect(sidebarHost()).toBe(host);
    expect(host?.parentElement).toBe(newInner);
    expect(newInner.firstElementChild).toBe(host);
    expect(newInner.children[1]).toBe(newRecommended);
    expect(panel()).not.toBeNull();
  });

  it('re-inserts the host into a replacement #secondary column', async () => {
    setViewportWidth(1440);
    const { secondary } = addSecondaryWithInner();
    await renderSidebar(makeSession({ sentences: [makeSentence(0, 'One.')] }));

    const host = sidebarHost();
    expect(host).not.toBeNull();

    const newSecondary = addSecondary(400);
    const newInner = document.createElement('div');
    newInner.id = 'secondary-inner';
    newSecondary.appendChild(newInner);
    secondary.remove();

    await act(async () => {
      document.dispatchEvent(new Event('yt-page-data-updated'));
    });

    expect(sidebarHost()).toBe(host);
    expect(host?.parentElement).toBe(newInner);
    expect(newInner.firstElementChild).toBe(host);
  });

  it('removes the host when collapsed so recommendations move up', async () => {
    setViewportWidth(1440);
    const { inner, recommended } = addSecondaryWithInner();
    await renderSidebar(makeSession({ sentences: [makeSentence(0, 'One.')] }));

    expect(inner.firstElementChild).toBe(sidebarHost());

    fireEvent.click(within(panel() as HTMLElement).getByRole('button', { name: '收起字幕侧栏' }));

    await waitFor(() => expect(sidebarHost()).toBeNull());
    expect(inner.firstElementChild).toBe(recommended);
    expect(panel()).toBeNull();

    const reopen = document.querySelector<HTMLElement>('[data-earworm-sidebar-reopen]');
    fireEvent.click(reopen as HTMLElement);
    await waitFor(() => expect(sidebarHost()?.parentElement).toBe(inner));
    expect(panel()).toHaveAttribute('data-mode', 'docked');
  });

  it('mirrors the blur settings onto the nested host element', async () => {
    seedStorage(SETTINGS_STORAGE_KEY, {
      ...DEFAULT_SETTINGS,
      blur: { en: true, zh: false },
      ui: { sidebar: true },
    });
    setViewportWidth(1440);
    addSecondaryWithInner();
    await renderSidebar(makeSession({ sentences: [makeSentence(0, 'One.')] }));

    const host = sidebarHost();
    expect(host).not.toBeNull();
    await waitFor(() => expect(host).toHaveAttribute('data-blur-en', '1'));
    expect(host).toHaveAttribute('data-blur-zh', '0');
  });
});

describe('sidebar auto-scroll', () => {
  const scrollSpy = vi.fn();
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    vi.useFakeTimers();
    scrollSpy.mockClear();
    HTMLElement.prototype.scrollIntoView = scrollSpy;
  });

  afterEach(() => {
    vi.useRealTimers();
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  function makeSentences(count: number): LearningSentence[] {
    return Array.from({ length: count }, (_, id) =>
      makeSentence(id, `Sentence number ${id}.`, `第 ${id} 句。`),
    );
  }

  function mockRect(element: Element, rect: Partial<DOMRect>): void {
    element.getBoundingClientRect = () => {
      const merged = {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        ...rect,
      };
      return {
        ...merged,
        bottom: rect.bottom ?? merged.top + merged.height,
        right: rect.right ?? merged.left + merged.width,
      } as DOMRect;
    };
  }

  async function rerenderSidebar(view: ReturnType<typeof render>): Promise<void> {
    await act(async () => {
      view.rerender(
        <SettingsProvider>
          <Sidebar />
        </SettingsProvider>,
      );
    });
  }

  it('centers the current sentence with scrollIntoView block:center', async () => {
    const sentences = makeSentences(30);
    await renderSidebar(makeSession({ sentences, currentIndex: 10 }));

    const currentRow = sentenceRow(10);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy.mock.calls[0]?.[0]).toEqual({ block: 'center' });
    expect(scrollSpy.mock.contexts[0]).toBe(currentRow);
  });

  it('pauses following for 5s after a manual scroll, then centers the current row again', async () => {
    const sentences = makeSentences(30);
    const api = makeSession({ sentences, currentIndex: 10 });
    const view = await renderSidebar(api);

    const list = sentenceList();
    const row = sentenceRow(10);
    expect(list).not.toBeNull();
    expect(row).not.toBeNull();
    mockRect(list as HTMLElement, { top: 0, height: 600 });
    mockRect(row as HTMLElement, { top: 3000, height: 40 });

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.scroll(list as HTMLElement);
    scrollSpy.mockClear();

    sessionMock.api = makeSession({ sentences, currentIndex: 11 });
    await rerenderSidebar(view);
    expect(scrollSpy).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(4999);
    });
    expect(scrollSpy).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy.mock.calls[0]?.[0]).toEqual({ block: 'center' });
    expect(scrollSpy.mock.contexts[0]).toBe(sentenceRow(11));
  });

  it('resumes immediately when a manual scroll leaves the current row in view', async () => {
    const sentences = makeSentences(30);
    const api = makeSession({ sentences, currentIndex: 10 });
    const view = await renderSidebar(api);

    const list = sentenceList();
    const row = sentenceRow(10);
    mockRect(list as HTMLElement, { top: 0, height: 600 });
    mockRect(row as HTMLElement, { top: 280, height: 40 });

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.scroll(list as HTMLElement);
    scrollSpy.mockClear();

    sessionMock.api = makeSession({ sentences, currentIndex: 11 });
    await rerenderSidebar(view);

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy.mock.contexts[0]).toBe(sentenceRow(11));
  });
});
