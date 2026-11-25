import { act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningSentence, Sentence } from '@/lib/contracts';
import type { SessionState } from '@/features/session';
import { NATIVE_CAPTION_STYLE_ID } from '@/lib/ui/page-style';
import { Overlay, OverlayView } from '@/features/overlay';
import type { OverlayViewProps } from '@/features/overlay';

const sessionMock = vi.hoisted(() => ({
  state: null as SessionState | null,
  retryAll: vi.fn(),
}));

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

function sentence(overrides: Partial<LearningSentence> = {}): LearningSentence {
  const base: Sentence = {
    id: 0,
    start: 0,
    end: 2,
    text: 'Hello world.',
    cueStart: 0,
    cueEnd: 0,
  };
  return { ...base, cols: [], status: 'done', ...overrides };
}

function readyState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    videoId: 'video-1',
    meta: null,
    status: 'ready',
    sentences: [sentence({ zh: '你好世界。' })],
    currentIndex: 0,
    translation: { state: 'done', done: 1, total: 1, failed: 0 },
    ...overrides,
  };
}

function renderView(props: Partial<OverlayViewProps> = {}) {
  return render(<OverlayView state={readyState()} {...props} />);
}

function makePlayer(className = 'html5-video-player'): HTMLDivElement {
  const player = document.createElement('div');
  player.id = 'movie_player';
  player.className = className;
  document.body.appendChild(player);
  return player;
}

beforeEach(() => {
  sessionMock.state = null;
  sessionMock.retryAll.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  document.querySelector('#movie_player')?.remove();
  window.history.replaceState({}, '', '/');
});

describe('bilingual overlay content', () => {
  it('renders the current sentence with English above Chinese', () => {
    const { container } = renderView();
    const en = container.querySelector('[data-lang="en"]');
    const zh = container.querySelector('[data-lang="zh"]');

    expect(en).not.toBeNull();
    expect(zh).not.toBeNull();
    expect(en?.textContent).toBe('Hello world.');
    expect(zh?.textContent).toBe('你好世界。');
    expect(zh?.getAttribute('lang')).toBe('zh-CN');
    // English line precedes the Chinese line in document order.
    expect(
      en!.compareDocumentPosition(zh!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders only English while the translation is missing', () => {
    const { container } = renderView({
      state: readyState({ sentences: [sentence({ zh: undefined })] }),
    });

    expect(container.querySelector('[data-lang="en"]')?.textContent).toBe(
      'Hello world.',
    );
    expect(container.querySelector('[data-lang="zh"]')).toBeNull();
  });

  it('makes word tokens the only pointer-event targets', () => {
    const { container } = renderView();

    const root = container.querySelector<HTMLElement>('[data-ew-overlay]');
    expect(root?.style.pointerEvents).toBe('none');

    const word = container.querySelector<HTMLElement>('[data-word="hello"]');
    expect(word).not.toBeNull();
    expect(word?.textContent).toBe('Hello');
    expect(word?.getAttribute('data-offset')).toBe('0');

    const css = container.querySelector('[data-ew-overlay] style')?.textContent ?? '';
    expect(css).toContain('[data-word]');
    expect(css).toContain('pointer-events: auto');
  });

  it('shows a light loading state while captions are acquired', () => {
    renderView({ state: readyState({ status: 'acquiring', sentences: [] }) });
    expect(screen.getByRole('status').textContent).toContain('字幕');
    expect(screen.queryByText('Hello world.')).toBeNull();
  });

  it('shows the no-captions notice and fades it out without blocking playback', async () => {
    vi.useFakeTimers();
    const { container } = renderView({
      state: readyState({ status: 'no-captions', sentences: [] }),
    });

    const notice = screen.getByText('无字幕');
    expect(notice.closest('[data-ew-status="no-captions"]')).not.toBeNull();
    expect(notice.closest<HTMLElement>('[data-ew-overlay]')?.style.pointerEvents).toBe(
      'none',
    );
    expect(notice.closest<HTMLElement>('[data-ew-status="no-captions"]')?.dataset.faded).toBe(
      undefined,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(
      container.querySelector('[data-ew-status="no-captions"]')?.getAttribute('data-faded'),
    ).toBe('1');
  });

  it('offers a retry action when caption loading fails', () => {
    const onRetry = vi.fn();
    renderView({ state: readyState({ status: 'error', sentences: [] }), onRetry });

    const retry = screen.getByRole('button', { name: '重试' });
    retry.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('clears the overlay while an ad is playing', () => {
    const { container } = renderView({ adPlaying: true });
    expect(container.querySelector('[data-ew-overlay]')).toBeNull();
    expect(screen.queryByText('Hello world.')).toBeNull();
  });
});

describe('overlay lifecycle', () => {
  it('installs native caption suppression only for a ready session and removes it on teardown', () => {
    sessionMock.state = readyState();
    const { unmount } = render(<Overlay />);

    expect(document.documentElement.getAttribute('data-earworm-active')).toBe('1');
    expect(document.getElementById(NATIVE_CAPTION_STYLE_ID)).not.toBeNull();

    unmount();
    expect(document.getElementById(NATIVE_CAPTION_STYLE_ID)).toBeNull();
    expect(document.documentElement.hasAttribute('data-earworm-active')).toBe(false);
  });

  it('keeps native captions visible when acquisition fails', () => {
    const { rerender } = render(<Overlay />);
    sessionMock.state = readyState({
      status: 'no-captions',
      sentences: [],
      translation: { state: 'idle', done: 0, total: 0, failed: 0 },
    });
    rerender(<Overlay />);
    expect(document.getElementById(NATIVE_CAPTION_STYLE_ID)).toBeNull();
    expect(document.documentElement.hasAttribute('data-earworm-active')).toBe(false);

    sessionMock.state = readyState({
      status: 'error',
      sentences: [],
      error: 'timeout',
      translation: { state: 'idle', done: 0, total: 0, failed: 0 },
    });
    rerender(<Overlay />);
    expect(document.getElementById(NATIVE_CAPTION_STYLE_ID)).toBeNull();
    expect(document.documentElement.hasAttribute('data-earworm-active')).toBe(false);
  });

  it('clears the sentence during an ad and restores it afterwards', async () => {
    const player = makePlayer('html5-video-player');
    sessionMock.state = readyState();

    const { container } = render(<Overlay />);
    expect(container.querySelector('[data-lang="en"]')?.textContent).toBe(
      'Hello world.',
    );

    await act(async () => {
      player.classList.add('ad-showing');
    });
    await waitFor(() => {
      expect(container.querySelector('[data-lang="en"]')).toBeNull();
    });

    await act(async () => {
      player.classList.remove('ad-showing');
      player.classList.add('ad-interrupting');
    });
    await waitFor(() => {
      expect(container.querySelector('[data-lang="en"]')).toBeNull();
    });

    await act(async () => {
      player.classList.remove('ad-interrupting');
    });
    await waitFor(() => {
      expect(container.querySelector('[data-lang="en"]')?.textContent).toBe(
        'Hello world.',
      );
    });
  });

  it('resets stale subtitle state on YouTube SPA navigation', async () => {
    sessionMock.state = readyState();

    const { container, rerender } = render(<Overlay />);
    expect(container.querySelector('[data-lang="en"]')?.textContent).toBe(
      'Hello world.',
    );

    await act(async () => {
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await waitFor(() => {
      expect(container.querySelector('[data-lang="en"]')).toBeNull();
    });

    sessionMock.state = readyState({
      videoId: 'video-2',
      sentences: [sentence({ id: 1, text: 'Next video sentence.' })],
    });
    await act(async () => {
      rerender(<Overlay />);
    });
    await waitFor(() => {
      expect(container.querySelector('[data-lang="en"]')?.textContent).toBe(
        'Next video sentence.',
      );
    });
  });

  it('wires the error retry action to session.retryAll', async () => {
    sessionMock.state = readyState({ status: 'error', sentences: [] });
    render(<Overlay />);

    screen.getByRole('button', { name: '重试' }).click();
    expect(sessionMock.retryAll).toHaveBeenCalledTimes(1);
  });

});
