import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EcdictFile, LemmaFile } from '@/lib/dict/db';
import { createDictionary } from '@/lib/dict/import';
import { resetDictionary, setActiveDictionary } from '@/lib/dict';
import type { CollocationSpan, LearningSentence } from '@/lib/contracts';
import type { SessionApi, SessionState } from '@/features/session';
import { DictionaryPopup } from '@/features/dictionary';

const sessionMock = vi.hoisted(() => ({ api: null as unknown }));

vi.mock('@/features/session', () => ({
  useSession: () => sessionMock.api,
}));

const ecdict: EcdictFile = {
  meta: {
    schema: 1,
    version: 't12-ecdict',
    count: 2,
    sourceRows: 2,
    tagged: 1,
    withPhonetic: 2,
    withTranslation: 2,
    withPos: 2,
    withExchange: 1,
    topN: 50000,
    maxTranslationChars: 120,
  },
  entries: [
    ['run', 'rʌn', 'v. 跑\nn. 奔跑', 'v. n.', 'zk', 'p:ran/i:running/d:run/0:run'],
    ['hold', 'həʊld', 'v. 握住\nn. 控制', 'v. n.', 'gk', 'p:held/i:holding'],
  ],
};

const lemmas: LemmaFile = {
  meta: { schema: 1, version: 't12-lemma', count: 1, groups: 1 },
  map: { running: 'run', runs: 'run', ran: 'run' },
};

function makeSentence(
  id: number,
  text: string,
  cols: LearningSentence['cols'] = [],
): LearningSentence {
  return {
    id,
    start: id * 3,
    end: id * 3 + 2.5,
    text,
    cueStart: id,
    cueEnd: id,
    cols,
    status: 'done',
  };
}

function makeSession(
  sentences: LearningSentence[],
  currentIndex = 0,
): SessionApi {
  const state: SessionState = {
    videoId: 'video-1',
    meta: null,
    status: 'ready',
    sentences,
    currentIndex,
    translation: { state: 'done', done: sentences.length, total: sentences.length, failed: 0 },
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

function renderPopup() {
  return render(<DictionaryPopup />);
}

function addWord(
  surface: string,
  offset: number,
  options: { sentenceId?: number; text?: string } = {},
): HTMLSpanElement {
  const container = document.createElement('div');
  if (options.sentenceId !== undefined) {
    container.dataset.sentenceId = String(options.sentenceId);
  }
  const word = document.createElement('span');
  word.dataset.word = surface;
  word.dataset.offset = String(offset);
  word.textContent = options.text ?? surface;
  container.appendChild(word);
  document.body.appendChild(container);
  return word;
}

function popupRoot(): HTMLElement | null {
  return document.querySelector('[data-earworm-dictionary]');
}

beforeEach(() => {
  resetDictionary();
  setActiveDictionary(createDictionary(ecdict, lemmas));
});

afterEach(() => {
  resetDictionary();
  sessionMock.api = null;
});

describe('dictionary popup content', () => {
  it('opens on a word click: loading first, then headword, inflection, phonetic, POS, translations and exam tag', async () => {
    sessionMock.api = makeSession([makeSentence(0, 'I was running fast.')]);
    renderPopup();
    const word = addWord('running', 6);

    fireEvent.click(word);

    expect(popupRoot()).not.toBeNull();
    expect(document.querySelector('[data-ew-dict-loading]')).not.toBeNull();

    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('run');
    });

    expect(document.querySelector('[data-ew-dict-surface]')).toHaveTextContent('running');
    expect(document.querySelector('[data-ew-dict-phonetic]')).toHaveTextContent('/rʌn/');
    expect(document.querySelector('[data-ew-dict-pos]')).toHaveTextContent('v. n.');
    expect(document.querySelector('[data-ew-dict-translation]')).toHaveTextContent(/v\. 跑/);
    expect(document.querySelector('[data-ew-dict-translation]')).toHaveTextContent(/n\. 奔跑/);

    const tags = Array.from(document.querySelectorAll('[data-ew-dict-tag]'));
    expect(tags.map((tag) => tag.textContent)).toEqual(['中考']);
    expect(tags[0]).toHaveAttribute('data-tag', 'zk');
    // Purple means collocation only: exam tags stay neutral pills.
    expect(tags[0]?.className).toContain('bg-secondary');
    expect(tags[0]?.className).not.toMatch(/collocation|violet|purple|amber/);

    // Part of speech is a neutral 11px/600 pill too, not italic body text.
    const pos = document.querySelector('[data-ew-dict-pos]');
    expect(pos?.className).toContain('text-[11px]');
    expect(pos?.className).toContain('font-semibold');
    expect(pos?.className).toContain('bg-secondary');
    expect(pos?.className).toContain('rounded-full');
    expect(pos?.className).not.toMatch(/italic|text-\[13px\]|collocation|violet|purple|amber/);
  });

  it('renders headword, phonetic and senses at the v1.1 type scale', async () => {
    sessionMock.api = makeSession([makeSentence(0, 'I was running fast.')]);
    renderPopup();
    fireEvent.click(addWord('running', 6));

    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('run');
    });

    // headword 22px/700, phonetic 13px, senses 14px/1.6.
    const headword = document.querySelector('[data-ew-dict-headword]');
    expect(headword?.className).toContain('text-[22px]');
    expect(headword?.className).toContain('font-bold');
    const phonetic = document.querySelector('[data-ew-dict-phonetic]');
    expect(phonetic?.parentElement?.className).toContain('text-[13px]');
    const senses = document.querySelector('[data-ew-dict-translation]');
    expect(senses?.className).toContain('text-sm');
    expect(senses?.className).toContain('leading-[1.6]');
  });
});

describe('dictionary popup states', () => {
  it('shows 「未收录」 for a word missing from the dictionary without crashing', async () => {
    sessionMock.api = makeSession([makeSentence(0, 'Serendipity happens.')]);
    renderPopup();
    const word = addWord('serendipity', 0);

    fireEvent.click(word);

    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-miss]')).not.toBeNull();
    });
    expect(document.querySelector('[data-ew-dict-miss]')).toHaveTextContent('未收录');
    expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('serendipity');
    expect(document.querySelector('[data-ew-dict-translation]')).toBeNull();
  });
});

describe('dictionary popup collocations', () => {
  const offlineHold: CollocationSpan = {
    start: 10,
    end: 17,
    text: 'hold up',
    source: 'offline',
  };
  const llmHold: CollocationSpan = {
    start: 10,
    end: 17,
    text: 'hold up',
    source: 'llm',
    note: '坚持住；支撑',
  };

  it('renders the collocation card above the entry and prefers the LLM note on overlap', async () => {
    sessionMock.api = makeSession([
      makeSentence(0, 'I need to hold up.', [offlineHold, llmHold]),
    ]);
    renderPopup();

    fireEvent.click(addWord('hold', 10));

    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('hold');
    });

    const card = document.querySelector('[data-ew-dict-collocation]');
    expect(card).not.toBeNull();
    expect(card).toHaveAttribute('data-source', 'llm');
    expect(document.querySelector('[data-ew-dict-phrase]')).toHaveTextContent('hold up');
    expect(document.querySelector('[data-ew-dict-note]')).toHaveTextContent('坚持住；支撑');

    // The phrase card is rendered before the dictionary entry.
    const headword = document.querySelector('[data-ew-dict-headword]');
    expect(card?.nextElementSibling).toContainElement(headword as HTMLElement);

    // Collocation semantics use the violet text token, not an amber badge.
    expect(card?.className).toContain('text-collocation');
    expect(card?.className).not.toMatch(/amber|bg-(violet|primary|collocation)/);
    expect(document.querySelector('[data-ew-dict-phrase]')?.className).toContain(
      'text-collocation',
    );
  });

  it('pins a 13px violet collocation card above the entry', async () => {
    sessionMock.api = makeSession([makeSentence(0, 'I need to hold up.', [offlineHold])]);
    renderPopup();
    fireEvent.click(addWord('hold', 10));

    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('hold');
    });

    const card = document.querySelector('[data-ew-dict-collocation]');
    expect(card?.nextElementSibling).toContainElement(
      document.querySelector('[data-ew-dict-headword]') as HTMLElement,
    );
    const phrase = document.querySelector('[data-ew-dict-phrase]');
    expect(phrase?.className).toContain('text-[13px]');
    expect(phrase?.className).toContain('text-collocation');
    const note = document.querySelector('[data-ew-dict-note]');
    expect(note?.className).toContain('text-[13px]');
    expect(note?.className).toContain('text-collocation');
  });

  it('uses an opaque dark surface with a violet border for the popup', async () => {
    sessionMock.api = makeSession([makeSentence(0, 'I was running fast.')]);
    renderPopup();
    fireEvent.click(addWord('running', 6));

    const popup = popupRoot();
    expect(popup).not.toBeNull();
    // The surface is dark by construction: the popup carries `.dark` itself,
    // so `bg-popover` resolves to the dark card token on any video frame,
    // whether or not an ancestor portal carries the class.
    expect(popup?.className).toContain('dark');
    expect(popup?.className).toContain('bg-popover');
    expect(popup?.className).toContain('border-violet-6');
    expect(popup?.className).toContain('rounded-lg');
    expect(popup?.className).not.toMatch(/bg-(white|black| amber)/);
  });

  it('falls back to 「离线搭配」 for an offline span and resolves the clicked sidebar row', async () => {
    sessionMock.api = makeSession(
      [
        makeSentence(0, 'Something else.'),
        makeSentence(1, 'I need to hold up.', [offlineHold]),
      ],
      0,
    );
    renderPopup();
    const word = addWord('hold', 10, { sentenceId: 1 });

    const row = word.parentElement as HTMLElement;
    const seek = vi.fn();
    row.addEventListener('click', seek);

    fireEvent.click(word);

    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-collocation]')).not.toBeNull();
    });
    expect(document.querySelector('[data-ew-dict-collocation]')).toHaveAttribute(
      'data-source',
      'offline',
    );
    expect(document.querySelector('[data-ew-dict-note]')).toHaveTextContent('离线搭配');
    expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('hold');

    // The sidebar row's seek handler must not run for a word click.
    expect(seek).not.toHaveBeenCalled();
  });
});

describe('dictionary popup dismissal', () => {
  async function openRunning() {
    sessionMock.api = makeSession([makeSentence(0, 'I was running fast.')]);
    renderPopup();
    fireEvent.click(addWord('running', 6));
    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('run');
    });
  }

  it('closes on an outside click', async () => {
    await openRunning();
    fireEvent.click(document.body);
    expect(popupRoot()).toBeNull();
  });

  it('closes on Escape', async () => {
    await openRunning();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(popupRoot()).toBeNull();
  });

  it('closes on page scroll, resize and YouTube SPA navigation', async () => {
    sessionMock.api = makeSession([makeSentence(0, 'I was running fast.')]);
    renderPopup();
    const word = addWord('running', 6);
    const reopen = async (): Promise<void> => {
      fireEvent.click(word);
      await waitFor(() => {
        expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('run');
      });
    };

    await reopen();
    fireEvent.scroll(window);
    expect(popupRoot()).toBeNull();

    await reopen();
    fireEvent.resize(window);
    expect(popupRoot()).toBeNull();

    await reopen();
    fireEvent(document, new Event('yt-navigate-finish'));
    expect(popupRoot()).toBeNull();
  });

  it('keeps only one popup open and swaps its content to the latest word', async () => {
    sessionMock.api = makeSession([makeSentence(0, 'I was running and will hold.')]);
    renderPopup();

    fireEvent.click(addWord('running', 6));
    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('run');
    });

    fireEvent.click(addWord('hold', 22));
    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('hold');
    });

    expect(document.querySelectorAll('[data-earworm-dictionary]')).toHaveLength(1);
  });

  it('does not close when the click lands inside the popup and stops it reaching the page', async () => {
    await openRunning();
    const pageClick = vi.fn();
    document.addEventListener('click', pageClick);
    try {
      fireEvent.click(document.querySelector('[data-ew-dict-phonetic]') as HTMLElement);
      expect(popupRoot()).not.toBeNull();
      expect(pageClick).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('click', pageClick);
    }
  });

  it('removes its document listeners on unmount', async () => {
    sessionMock.api = makeSession([makeSentence(0, 'I was running fast.')]);
    const { unmount } = renderPopup();
    fireEvent.click(addWord('running', 6));
    await waitFor(() => {
      expect(popupRoot()).not.toBeNull();
    });

    unmount();
    expect(popupRoot()).toBeNull();

    // No listener left behind: a later document click must not throw.
    expect(() => fireEvent.click(document.body)).not.toThrow();
  });
});

describe('dictionary popup API surface', () => {
  it('keeps the DictionaryPopup export a function', () => {
    expect(typeof DictionaryPopup).toBe('function');
  });
});
