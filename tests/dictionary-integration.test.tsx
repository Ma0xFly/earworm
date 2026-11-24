import { act } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EcdictFile, LemmaFile } from '@/lib/dict/db';
import { createDictionary } from '@/lib/dict/import';
import { resetDictionary, setActiveDictionary } from '@/lib/dict';
import type { LearningSentence } from '@/lib/contracts';
import type { SessionApi, SessionState } from '@/features/session';
import { PortalContainerProvider } from '@/lib/ui/portal';
import { createShadowUi } from '@/lib/ui/shadow';
import {
  DictionaryPopup,
  closeDictionaryPopup,
  openWord,
} from '@/features/dictionary';

const sessionMock = vi.hoisted(() => ({ api: null as unknown }));

vi.mock('@/features/session', () => ({
  useSession: () => sessionMock.api,
}));

const ecdict: EcdictFile = {
  meta: {
    schema: 1,
    version: 't12-integration-ecdict',
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
    ['run', 'rʌn', 'v. 跑', 'v.', 'zk', 'i:running/0:run'],
    ['hold', 'həʊld', 'v. 握住', 'v.', 'gk', 'p:held/i:holding'],
  ],
};

const lemmas: LemmaFile = {
  meta: { schema: 1, version: 't12-integration-lemma', count: 1, groups: 1 },
  map: { running: 'run' },
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

function addWord(
  surface: string,
  offset: number,
  options: { sentenceId?: number; parent?: HTMLElement } = {},
): HTMLSpanElement {
  const container = document.createElement('div');
  if (options.sentenceId !== undefined) {
    container.dataset.sentenceId = String(options.sentenceId);
  }
  const word = document.createElement('span');
  word.dataset.word = surface;
  word.dataset.offset = String(offset);
  word.textContent = surface;
  container.appendChild(word);
  (options.parent ?? document.body).appendChild(container);
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

describe('dictionary popup shadow portal', () => {
  it('renders the card inside the shadow-root portal, never document.body', async () => {
    sessionMock.api = makeSession([makeSentence(0, 'I was running fast.')]);
    const ui = createShadowUi({ css: '' });
    ui.mount();

    const view = render(
      <PortalContainerProvider container={ui.portalContainer}>
        <DictionaryPopup />
      </PortalContainerProvider>,
      { container: ui.container },
    );

    const word = document.createElement('span');
    word.dataset.word = 'running';
    word.dataset.offset = '6';
    word.textContent = 'running';
    ui.container.appendChild(word);

    fireEvent.click(word);

    await waitFor(() => {
      expect(ui.portalContainer.querySelector('[data-earworm-dictionary]')).not.toBeNull();
    });

    const card = ui.portalContainer.querySelector('[data-earworm-dictionary]');
    expect(ui.shadow.contains(card)).toBe(true);
    expect(document.body.querySelector('[data-earworm-dictionary]')).toBeNull();

    view.unmount();
    ui.unmount();
  });
});

describe('programmatic openWord', () => {
  it('opens with the current session sentence and anchors to the given element', async () => {
    sessionMock.api = makeSession([makeSentence(0, 'I was running fast.')]);
    render(<DictionaryPopup />);
    const word = addWord('running', 6);

    act(() => {
      openWord('running', word);
    });

    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('run');
    });
    expect(popupRoot()).not.toBeNull();

    act(() => {
      closeDictionaryPopup();
    });
    expect(popupRoot()).toBeNull();
  });

  it('flushes an open requested before the popup mounted', async () => {
    sessionMock.api = makeSession([makeSentence(0, 'I was running fast.')]);
    const sentence = makeSentence(0, 'I was running fast.');
    const word = addWord('running', 6);

    // Mounted popup is not needed: openWord queues the latest request.
    openWord('running', word, sentence);
    render(<DictionaryPopup />);

    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-headword]')).toHaveTextContent('run');
    });
  });

  it('resolves the clicked sidebar row for the collocation lookup', async () => {
    const offlineHold = {
      start: 10,
      end: 17,
      text: 'hold up',
      source: 'offline' as const,
    };
    sessionMock.api = makeSession(
      [makeSentence(0, 'Something else.'), makeSentence(1, 'I need to hold up.', [offlineHold])],
      0,
    );
    render(<DictionaryPopup />);
    const word = addWord('hold', 10, { sentenceId: 1 });

    act(() => {
      openWord('hold', word);
    });

    await waitFor(() => {
      expect(document.querySelector('[data-ew-dict-collocation]')).not.toBeNull();
    });
    expect(document.querySelector('[data-ew-dict-collocation]')).toHaveAttribute(
      'data-source',
      'offline',
    );
    expect(document.querySelector('[data-ew-dict-note]')).toHaveTextContent('离线搭配');
  });
});
