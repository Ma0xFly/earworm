import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningSentence, WordEntry } from '@/lib/contracts';
import type { SessionApi, SessionState } from '@/features/session';
import { DictionaryPopup } from '@/features/dictionary';

const sessionMock = vi.hoisted(() => ({ api: null as unknown }));
const dictMock = vi.hoisted(() => ({ lookupWord: vi.fn() }));

vi.mock('@/features/session', () => ({
  useSession: () => sessionMock.api,
}));

vi.mock('@/lib/dict', () => ({
  lookupWord: dictMock.lookupWord,
}));

const runningEntry: WordEntry = {
  word: 'run',
  phonetic: 'rʌn',
  translation: 'v. 跑',
  pos: 'v.',
  tags: ['zk'],
  matchedForm: 'running',
};

function makeSentence(text: string): LearningSentence {
  return {
    id: 0,
    start: 0,
    end: 3,
    text,
    cueStart: 0,
    cueEnd: 0,
    cols: [],
    status: 'done',
  };
}

function makeSession(sentence: LearningSentence): SessionApi {
  const state: SessionState = {
    videoId: 'video-1',
    meta: null,
    status: 'ready',
    sentences: [sentence],
    currentIndex: 0,
    translation: { state: 'done', done: 1, total: 1, failed: 0 },
  };
  return {
    state,
    seekToSentence: vi.fn(),
    retrySentence: vi.fn(),
    retryAll: vi.fn(),
    setContinuous: vi.fn(),
    toggleSidebar: vi.fn(),
  };
}

function addWord(surface: string, offset: number, text = surface): HTMLSpanElement {
  const word = document.createElement('span');
  word.dataset.word = surface;
  word.dataset.offset = String(offset);
  word.textContent = text;
  document.body.appendChild(word);
  return word;
}

function popupRoot(): HTMLElement | null {
  return document.querySelector('[data-earworm-dictionary]');
}

beforeEach(() => {
  dictMock.lookupWord.mockReset();
  dictMock.lookupWord.mockResolvedValue(runningEntry);
});

describe('dictionary popup lookup lifecycle and cache', () => {
  it('shows loading until the asynchronous lookup resolves', async () => {
    sessionMock.api = makeSession(makeSentence('I was running fast.'));
    let resolveLookup: (entry: WordEntry | null) => void = () => {};
    dictMock.lookupWord.mockReturnValue(
      new Promise<WordEntry | null>((resolve) => {
        resolveLookup = resolve;
      }),
    );

    render(<DictionaryPopup />);
    fireEvent.click(addWord('running', 6));

    expect(popupRoot()).not.toBeNull();
    expect(document.querySelector('[data-ew-dict-loading]')).not.toBeNull();
    expect(document.querySelector('[data-ew-dict-headword]')).toBeNull();

    await act(async () => {
      resolveLookup(runningEntry);
    });

    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('run');
    });
    expect(document.querySelector('[data-ew-dict-loading]')).toBeNull();
  });

  it('memoizes a surface: clicking the same word twice performs one lookup', async () => {
    sessionMock.api = makeSession(makeSentence('I was running fast.'));
    render(<DictionaryPopup />);
    const word = addWord('running', 6);

    fireEvent.click(word);
    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('run');
    });

    fireEvent.click(word);
    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('run');
    });

    expect(dictMock.lookupWord).toHaveBeenCalledTimes(1);
    expect(dictMock.lookupWord).toHaveBeenCalledWith('running');
  });

  it('caches a miss too, and looks up a different surface separately', async () => {
    sessionMock.api = makeSession(makeSentence('Nope and running.'));
    dictMock.lookupWord.mockImplementation((surface: string) =>
      Promise.resolve(surface === 'running' ? runningEntry : null),
    );
    render(<DictionaryPopup />);

    const nope = addWord('nope', 0);
    fireEvent.click(nope);
    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-miss]')).not.toBeNull();
    });
    fireEvent.click(nope);
    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-miss]')).not.toBeNull();
    });
    expect(dictMock.lookupWord).toHaveBeenCalledTimes(1);

    fireEvent.click(addWord('running', 9));
    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('run');
    });
    expect(dictMock.lookupWord).toHaveBeenCalledTimes(2);
  });

  it('drops the cache and pending work when the popup unmounts', async () => {
    sessionMock.api = makeSession(makeSentence('I was running fast.'));
    const first = render(<DictionaryPopup />);

    fireEvent.click(addWord('running', 6));
    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('run');
    });
    first.unmount();

    render(<DictionaryPopup />);
    fireEvent.click(addWord('running', 6));
    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('run');
    });

    expect(dictMock.lookupWord).toHaveBeenCalledTimes(2);
  });
});
