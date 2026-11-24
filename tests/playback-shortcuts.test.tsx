import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningSentence } from '@/lib/contracts';
import { playerController } from '@/features/playback/controller';
import { FakeVideo } from './mocks/video';

const session = vi.hoisted(() => ({
  state: {
    videoId: 'video-1',
    meta: null,
    status: 'ready',
    sentences: [] as unknown[],
    currentIndex: 0,
    translation: { state: 'done', done: 0, total: 0, failed: 0 },
  },
  seekToSentence: vi.fn(),
  retrySentence: vi.fn(),
  retryAll: vi.fn(),
  setContinuous: vi.fn(),
  toggleSidebar: vi.fn(),
}));

vi.mock('@/features/session', () => ({
  useSession: () => session,
  idleSessionApi: session,
  SessionProvider: ({ children }: { children?: unknown }) => children,
}));

// Imported after the mock so the component sees the fake session hook.
const { PlaybackShortcuts } = await import('@/features/playback/PlaybackShortcuts');

function sentence(id: number, start: number, end: number): LearningSentence {
  return {
    id,
    start,
    end,
    text: `Sentence ${id}`,
    cueStart: id,
    cueEnd: id,
    cols: [],
    status: 'done',
  };
}

function setSentences(sentences: LearningSentence[], currentIndex = 0): void {
  session.state = {
    ...session.state,
    sentences,
    currentIndex,
    status: sentences.length > 0 ? 'ready' : 'idle',
    translation: { state: 'done', done: sentences.length, total: sentences.length, failed: 0 },
  };
}

function press(
  target: EventTarget = document.body,
  init: KeyboardEventInit = {},
  keyCode?: number,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'a',
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  if (keyCode !== undefined) {
    Object.defineProperty(event, 'keyCode', { value: keyCode });
  }
  target.dispatchEvent(event);
  return event;
}

describe('PlaybackShortcuts', () => {
  beforeEach(() => {
    session.seekToSentence.mockReset();
    setSentences([
      sentence(0, 1, 3),
      sentence(1, 3, 5),
      sentence(2, 11, 13),
    ]);
    playerController.detach();
  });

  afterEach(() => {
    cleanup();
    playerController.detach();
    document.body.innerHTML = '';
  });

  it('d plays the next sentence', () => {
    setSentences(session.state.sentences as LearningSentence[], 1);
    render(<PlaybackShortcuts />);

    press(document.body, { key: 'd' });

    expect(session.seekToSentence).toHaveBeenCalledWith(2);
  });

  it('a plays the previous sentence', () => {
    setSentences(session.state.sentences as LearningSentence[], 1);
    render(<PlaybackShortcuts />);

    press(document.body, { key: 'a' });

    expect(session.seekToSentence).toHaveBeenCalledWith(0);
  });

  it('s repeats the current sentence', () => {
    setSentences(session.state.sentences as LearningSentence[], 1);
    render(<PlaybackShortcuts />);

    press(document.body, { key: 's' });

    expect(session.seekToSentence).toHaveBeenCalledWith(1);
  });

  it('resolves the current sentence from player time before the session index', () => {
    const video = new FakeVideo();
    video.duration = 60;
    video.advance(4);
    playerController.attach(video.asVideo());
    setSentences(session.state.sentences as LearningSentence[], 0);
    render(<PlaybackShortcuts />);

    press(document.body, { key: 's' });

    expect(session.seekToSentence).toHaveBeenCalledWith(1);
  });

  it('treats an exact A.end == B.start boundary as the next sentence', () => {
    const video = new FakeVideo();
    video.duration = 60;
    video.advance(3);
    playerController.attach(video.asVideo());
    render(<PlaybackShortcuts />);

    press(document.body, { key: 's' });

    expect(session.seekToSentence).toHaveBeenCalledWith(1);
  });

  it('clamps a on the first sentence', () => {
    setSentences(session.state.sentences as LearningSentence[], 0);
    render(<PlaybackShortcuts />);

    press(document.body, { key: 'a' });

    expect(session.seekToSentence).toHaveBeenCalledWith(0);
  });

  it('clamps d on the last sentence', () => {
    setSentences(session.state.sentences as LearningSentence[], 2);
    render(<PlaybackShortcuts />);

    press(document.body, { key: 'd' });

    expect(session.seekToSentence).toHaveBeenCalledWith(2);
  });

  it('is case-insensitive and accepts shift', () => {
    setSentences(session.state.sentences as LearningSentence[], 1);
    render(<PlaybackShortcuts />);

    press(document.body, { key: 'D', shiftKey: true });
    press(document.body, { key: 'A' });

    expect(session.seekToSentence).toHaveBeenNthCalledWith(1, 2);
    expect(session.seekToSentence).toHaveBeenNthCalledWith(2, 0);
  });

  it('ignores keyup and handles a keydown exactly once', () => {
    render(<PlaybackShortcuts />);

    const keyup = new KeyboardEvent('keyup', { key: 'd', bubbles: true, composed: true });
    document.body.dispatchEvent(keyup);
    expect(session.seekToSentence).not.toHaveBeenCalled();

    press(document.body, { key: 'd' });
    expect(session.seekToSentence).toHaveBeenCalledTimes(1);
  });

  it('ignores key repeat', () => {
    render(<PlaybackShortcuts />);

    press(document.body, { key: 'd', repeat: true });

    expect(session.seekToSentence).not.toHaveBeenCalled();
  });

  it('ignores ctrl/meta/alt but not shift', () => {
    render(<PlaybackShortcuts />);

    press(document.body, { key: 'd', ctrlKey: true });
    press(document.body, { key: 'd', metaKey: true });
    press(document.body, { key: 'd', altKey: true });
    expect(session.seekToSentence).not.toHaveBeenCalled();

    press(document.body, { key: 'd', shiftKey: true });
    expect(session.seekToSentence).toHaveBeenCalledTimes(1);
  });

  it('ignores IME composition events', () => {
    render(<PlaybackShortcuts />);

    press(document.body, { key: 'd', isComposing: true });
    press(document.body, { key: 'd' }, 229);

    expect(session.seekToSentence).not.toHaveBeenCalled();
  });

  it.each(['input', 'textarea', 'select'])('ignores keys in a focused %s', (tag) => {
    render(<PlaybackShortcuts />);
    const element = document.createElement(tag);
    document.body.appendChild(element);

    const event = press(element, { key: 'd' });

    expect(session.seekToSentence).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores keys in a contenteditable subtree', () => {
    render(<PlaybackShortcuts />);
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editable.appendChild(child);
    document.body.appendChild(editable);

    press(child, { key: 's' });

    expect(session.seekToSentence).not.toHaveBeenCalled();
  });

  it('ignores keys in role=textbox', () => {
    render(<PlaybackShortcuts />);
    const textbox = document.createElement('div');
    textbox.setAttribute('role', 'textbox');
    document.body.appendChild(textbox);

    press(textbox, { key: 'a' });

    expect(session.seekToSentence).not.toHaveBeenCalled();
  });

  it('checks the focused element even when the event is dispatched at window level', () => {
    render(<PlaybackShortcuts />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = press(document.body, { key: 'd' });

    expect(session.seekToSentence).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('detects editable targets through composedPath inside a shadow root', () => {
    render(<PlaybackShortcuts />);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    shadow.appendChild(input);

    press(input, { key: 'd' });

    expect(session.seekToSentence).not.toHaveBeenCalled();
  });

  it('does nothing when there are no sentences', () => {
    setSentences([]);
    render(<PlaybackShortcuts />);

    const event = press(document.body, { key: 'd' });

    expect(session.seekToSentence).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not prevent default for keys it does not handle', () => {
    render(<PlaybackShortcuts />);

    const event = press(document.body, { key: 'b' });

    expect(session.seekToSentence).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('prevents the site shortcut only when it handles the key', () => {
    render(<PlaybackShortcuts />);

    const handled = press(document.body, { key: 'd' });

    expect(handled.defaultPrevented).toBe(true);
    expect(session.seekToSentence).toHaveBeenCalledTimes(1);
  });

  it('does not add a second listener on re-render and removes it on unmount', () => {
    const view = render(<PlaybackShortcuts />);
    view.rerender(<PlaybackShortcuts />);
    act(() => {
      setSentences(session.state.sentences as LearningSentence[], 1);
    });
    view.rerender(<PlaybackShortcuts />);

    press(document.body, { key: 'd' });
    expect(session.seekToSentence).toHaveBeenCalledTimes(1);

    view.unmount();
    press(document.body, { key: 'd' });
    expect(session.seekToSentence).toHaveBeenCalledTimes(1);
  });
});
