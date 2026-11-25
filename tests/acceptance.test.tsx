/**
 * End-to-end acceptance tests for the integrated content app (T16 / spec §7).
 *
 * These mount the REAL `ContentApp` (session engine, overlay, blur, dictionary,
 * keyboard shortcuts, quick menu) in a shadow root and drive it through the
 * real window bridge with mocked `chrome.runtime` + offline data. Only the
 * expensive/network boundaries are mocked:
 *
 * - `chrome.runtime.sendMessage`: the background translation channel;
 * - `loadCollocationTable` / `preloadDictionary`: shipped data files fetched
 *   through `chrome-extension://` URLs (not fetchable in happy-dom);
 * - `lookupWord`: the ECDICT IndexedDB lookup (unit-tested separately).
 *
 * The transcript bridge (`inject → content`), sentence merging, offline span
 * computation, session orchestration, translation batching/caching, playback
 * shortcuts and popup rendering are all the production implementations.
 */
import { act } from 'react';
import { fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type CachedTranslation,
  type Cue,
  type LlmSentenceResult,
  type WordEntry,
} from '@/lib/contracts';
import { resetCollocationTable, setCollocationTable } from '@/lib/collocations';
import { saveSettings, SETTINGS_STORAGE_KEY } from '@/lib/settings';
import {
  INJECT_MESSAGE,
  type CommitRequest,
  type CuesFailedPayload,
  type CuesReadyPayload,
  type GetCachedResponse,
  type InjectEnvelope,
  type RuntimeRequest,
  type TranslateBatchRequest,
  type TranslateBatchResponse,
} from '@/lib/messages';
import { postCuesFailed, postCuesReady } from '@/lib/transcript';
import { playerController } from '@/features/playback';
import {
  mountContentApp,
  unmountContentApp,
  type MountedContentApp,
} from '@/features/app/boot';
import { seedStorage } from './mocks/chrome';
import { FakeVideo } from './mocks/video';

/* -------------------------------------------------------------------------- */
/* data-loader seams                                                          */
/* -------------------------------------------------------------------------- */

const seams = vi.hoisted(() => ({
  loadCollocationTable: vi.fn(),
  preloadDictionary: vi.fn(),
  lookupWord: vi.fn(),
}));

vi.mock('@/lib/collocations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/collocations')>();
  return { ...actual, loadCollocationTable: seams.loadCollocationTable };
});

vi.mock('@/lib/dict', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dict')>();
  return {
    ...actual,
    preloadDictionary: seams.preloadDictionary,
    lookupWord: seams.lookupWord,
  };
});

/* -------------------------------------------------------------------------- */
/* fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** Two merged sentences: "Hello" + "there." merge; "I give up." stands alone. */
const CUES: Cue[] = [
  { start: 0, end: 2, text: 'Hello' },
  { start: 2, end: 3, text: 'there.' },
  { start: 3.5, end: 5, text: 'I give up.' },
];

const HEADER = `
  <div id="movie_player"><div class="ytp-chrome-bottom"></div></div>
  <div id="secondary"><div id="secondary-inner"><div data-recommended></div></div></div>
`;

function translationFor(index: number, text: string): LlmSentenceResult {
  if (text.includes('give up')) {
    return {
      i: index,
      zh: '我放弃。',
      cols: [{ text: 'give up', note: '放弃' }],
    };
  }
  return { i: index, zh: '你好。' };
}

function wordEntry(surface: string): WordEntry {
  return {
    word: surface,
    phonetic: 'ɡɪv',
    translation: 'v. 给；放弃',
    pos: 'v.',
    tags: ['cet4'],
  };
}

type RuntimeHarness = {
  send: ReturnType<typeof vi.fn>;
  cache: Map<string, CachedTranslation>;
  translateCalls: TranslateBatchRequest[];
  commitCalls: CommitRequest[];
  /** Global sentence indexes whose result is omitted (simulated failure). */
  missing: Set<number>;
};

function cacheKey(videoId: string, cuesHash: string): string {
  return `${videoId}:${cuesHash}`;
}

/** In-memory stand-in for the background worker + its IDB cache. */
function installRuntime(): RuntimeHarness {
  const harness = {
    cache: new Map<string, CachedTranslation>(),
    translateCalls: [] as TranslateBatchRequest[],
    commitCalls: [] as CommitRequest[],
    missing: new Set<number>(),
  } as RuntimeHarness;

  harness.send = vi.fn(async (request: RuntimeRequest) => {
    switch (request.type) {
      case 'earworm:get-cached': {
        const data = harness.cache.get(cacheKey(request.videoId, request.cuesHash));
        return (data ? { hit: true, data } : { hit: false }) satisfies GetCachedResponse;
      }
      case 'earworm:translate-batch': {
        harness.translateCalls.push(request);
        const results = request.batch
          .filter((item) => !harness.missing.has(item.i))
          .map((item) => translationFor(item.i, item.text));
        return {
          ok: true,
          model: 'acceptance-model',
          results,
        } satisfies TranslateBatchResponse;
      }
      case 'earworm:commit': {
        harness.commitCalls.push(request);
        harness.cache.set(cacheKey(request.videoId, request.cuesHash), request.data);
        return { ok: true };
      }
      default:
        return { ok: true };
    }
  });

  chrome.runtime.sendMessage =
    harness.send as unknown as typeof chrome.runtime.sendMessage;
  return harness;
}

/* -------------------------------------------------------------------------- */
/* mount / drive helpers                                                      */
/* -------------------------------------------------------------------------- */

let mounted: MountedContentApp | null = null;

/** The current sentence, as painted by the bilingual overlay. */
function currentEnglish(app: MountedContentApp): string {
  return overlayLine(app, 'en')?.textContent ?? '';
}

/** The recommended column must stay exactly as YouTube rendered it. */
function recommendedColumn(): Element | null {
  return document.querySelector('#secondary-inner');
}

function overlayOf(app: MountedContentApp): HTMLElement | null {
  return app.ui.container.querySelector<HTMLElement>('[data-ew-overlay]');
}

function overlayLine(
  app: MountedContentApp,
  lang: 'en' | 'zh',
): HTMLElement | null {
  return app.ui.container.querySelector<HTMLElement>(
    `[data-ew-line="${lang}"]`,
  );
}

/** Open the control-bar quick menu and return its shadow-root surface. */
async function openQuickMenu(app: MountedContentApp): Promise<HTMLElement> {
  const existing = app.ui.portalContainer.querySelector<HTMLElement>(
    '[data-earworm-quick-menu]',
  );
  if (existing) return existing;
  const arrow = document
    .querySelector('earworm-quick-toggle-host')
    ?.shadowRoot?.querySelector<HTMLElement>('[data-earworm-quick-menu-trigger]');
  expect(arrow).not.toBeNull();
  await act(async () => {
    fireEvent.click(arrow!);
  });
  const menu = await waitFor(() => {
    const found = app.ui.portalContainer.querySelector<HTMLElement>(
      '[data-earworm-quick-menu]',
    );
    expect(found).not.toBeNull();
    return found!;
  });
  return menu;
}

/** Translation status lives in the quick menu after the sidebar removal. */
async function translationProgress(app: MountedContentApp): Promise<{
  label: string;
  failed: string | null;
}> {
  const menu = await openQuickMenu(app);
  return {
    label:
      menu.querySelector<HTMLElement>('[data-translation-progress]')?.textContent ?? '',
    failed:
      menu.querySelector<HTMLElement>('[data-translation-failed]')?.textContent ?? null,
  };
}

async function mountApp(): Promise<{
  app: MountedContentApp;
  video: FakeVideo;
}> {
  let app!: MountedContentApp;
  await act(async () => {
    app = mountContentApp({ css: '' });
  });
  mounted = app;

  // PlaybackShortcuts starts a controller sync that waits for a <video>; the
  // acceptance harness owns a deterministic media double instead.
  const video = new FakeVideo();
  playerController.attach(video.asVideo());

  await waitFor(() => {
    expect(app.ui.container.querySelector('[data-earworm-root]')).not.toBeNull();
  });
  return { app, video };
}

/**
 * happy-dom's `window.postMessage` does not set `MessageEvent.source` to the
 * posting window, and the production bridge (correctly) rejects any event from
 * another source. Capture the REAL envelope produced by `postCuesReady` /
 * `postCuesFailed`, then dispatch it with `source: window` so the real
 * `parseInjectEvent` validation and transcript client still run.
 */
function dispatchInject(
  type: string,
  payload: CuesReadyPayload | CuesFailedPayload,
): void {
  let envelope: InjectEnvelope | undefined;
  const capture = {
    postMessage(data: InjectEnvelope): void {
      envelope = data;
    },
  } as unknown as Window;
  if (type === INJECT_MESSAGE.cuesReady) {
    postCuesReady(payload as CuesReadyPayload, capture);
  } else {
    postCuesFailed(payload as CuesFailedPayload, capture);
  }
  window.dispatchEvent(
    new MessageEvent('message', {
      data: envelope,
      source: window,
      origin: window.location.origin,
    }),
  );
}

/** Deliver one inject→content bridge message and let the client handle it. */
async function deliverCues(
  cues: Cue[] = CUES,
  videoId = 'vid1',
): Promise<void> {
  await act(async () => {
    dispatchInject(INJECT_MESSAGE.cuesReady, {
      videoId,
      lang: 'en',
      kind: 'manual',
      cues,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function deliverFailure(
  videoId = 'vid1',
  reason: 'no-captions' | 'timeout' = 'no-captions',
): Promise<void> {
  await act(async () => {
    dispatchInject(INJECT_MESSAGE.cuesFailed, { videoId, reason });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function navigateTo(videoId: string): Promise<void> {
  window.history.replaceState({}, '', `/watch?v=${videoId}`);
  await act(async () => {
    window.dispatchEvent(new Event('yt-navigate-finish'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function section(): HTMLElement {
  return document.body;
}

beforeEach(() => {
  mounted = null;
  document.body.innerHTML = HEADER;
  document.title = 'Acceptance video - YouTube';
  window.history.replaceState({}, '', '/watch?v=vid1');
  seedStorage(SETTINGS_STORAGE_KEY, {
    ...DEFAULT_SETTINGS,
    ui: { enabled: true },
  });

  resetCollocationTable();
  setCollocationTable([{ text: 'give up' }]);
  seams.loadCollocationTable.mockReset().mockResolvedValue([{ text: 'give up' }]);
  seams.preloadDictionary.mockReset().mockResolvedValue(null);
  seams.lookupWord
    .mockReset()
    .mockImplementation(async (surface: string) => wordEntry(surface));

  installRuntime();
});

afterEach(() => {
  if (mounted) {
    act(() => unmountContentApp());
    mounted = null;
  }
  playerController.detach();
  window.history.replaceState({}, '', '/');
  document.title = '';
  resetCollocationTable();
});

/* -------------------------------------------------------------------------- */
/* tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('acceptance: cue → sentence → highlight → translation → UI', () => {
  it('merges cues, shows offline spans before translation, then bilingual overlay', async () => {
    const harness = installRuntime();
    const { app, video } = await mountApp();
    video.advance(3.5); // current sentence = "I give up."

    // Hold the cache lookup so the offline layer can be observed on its own.
    const cacheImpl = harness.send.getMockImplementation() as (
      request: RuntimeRequest,
    ) => Promise<unknown>;
    let releaseCache!: () => void;
    harness.send.mockImplementation(async (request: RuntimeRequest) => {
      if (request.type === 'earworm:get-cached') {
        await new Promise<void>((resolve) => {
          releaseCache = resolve;
        });
        return { hit: false } satisfies GetCachedResponse;
      }
      return cacheImpl(request);
    });

    await deliverCues();
    await waitFor(() => expect(currentEnglish(app)).toBe('I give up.'));

    // The recommended column keeps YouTube's own content; no panel is injected.
    expect(document.querySelector('earworm-sidebar-host')).toBeNull();
    expect(document.querySelector('[data-earworm-sidebar]')).toBeNull();
    const inner = recommendedColumn();
    expect(inner?.children).toHaveLength(1);
    expect(inner?.firstElementChild).toHaveAttribute('data-recommended');

    // T6 offline span is visible immediately, before any translation arrives.
    await waitFor(() => {
      const mark = app.ui.container.querySelector<HTMLElement>(
        '[data-ew-overlay] mark[data-collocation="offline"]',
      );
      expect(mark?.textContent).toBe('give up');
    });
    expect(overlayLine(app, 'zh')).toBeNull();

    // The merge produced "Hello there." as the first 字幕句; a/s/d reaches it.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    await waitFor(() => expect(currentEnglish(app)).toBe('Hello there.'));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    });
    await waitFor(() => expect(currentEnglish(app)).toBe('I give up.'));

    await waitFor(() => expect(releaseCache).toBeTypeOf('function'));
    await act(async () => {
      releaseCache();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Mocked translate-batch result reaches the overlay; the LLM span replaces
    // the offline one without duplicate highlighting.
    await waitFor(() => {
      expect(overlayLine(app, 'zh')?.textContent).toBe('我放弃。');
    });
    await waitFor(() => {
      const marks = app.ui.container.querySelectorAll(
        '[data-ew-overlay] mark[data-collocation]',
      );
      expect(marks).toHaveLength(1);
      expect(marks[0]?.getAttribute('data-collocation')).toBe('llm');
      expect(marks[0]?.textContent).toBe('give up');
    });
    await waitFor(async () => {
      expect((await translationProgress(app)).label).toContain('翻译 2/2');
    });

    // The content script drove the background channel with the spec contract.
    expect(harness.translateCalls).toHaveLength(1);
    const request = harness.translateCalls[0]!;
    expect(request.videoId).toBe('vid1');
    expect(request.cuesHash).toMatch(/^[a-f0-9]{64}$/);
    expect(request.batch.map((item) => item.text)).toEqual([
      'Hello there.',
      'I give up.',
    ]);
    expect(request.meta.title).toBe('Acceptance video');
    expect(harness.commitCalls).toHaveLength(1);
    expect(harness.commitCalls[0]?.data.zh).toEqual(['你好。', '我放弃。']);
  });

  it('navigates with a / s / d and lets editable focus keep the keys', async () => {
    const harness = installRuntime();
    const { app, video } = await mountApp();
    await deliverCues();
    await waitFor(() => expect(currentEnglish(app)).toBe('Hello there.'));
    await waitFor(() => expect(overlayLine(app, 'zh')?.textContent).toBe('你好。'));

    const playRange = vi.spyOn(playerController, 'playRange');

    // d = next sentence: seek + play from its start, pause-at-end by default.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    });
    await waitFor(() => expect(currentEnglish(app)).toBe('I give up.'));
    expect(video.currentTime).toBeCloseTo(3.5, 5);
    expect(video.playCalls).toBeGreaterThan(0);
    expect(playRange).toHaveBeenLastCalledWith(3.5, 5, { pauseAtEnd: true });

    // a = previous sentence (clamped to the first one).
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    await waitFor(() => expect(currentEnglish(app)).toBe('Hello there.'));
    expect(video.currentTime).toBeCloseTo(0, 5);

    // Focused inputs keep native typing: no seek, no sentence change.
    const before = video.currentTime;
    const input = document.createElement('input');
    section().appendChild(input);
    input.focus();
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', bubbles: true, composed: true }),
      );
    });
    expect(video.currentTime).toBe(before);
    expect(currentEnglish(app)).toBe('Hello there.');
    input.remove();
    playRange.mockRestore();
  });

  it('honours the persisted continuous-playback setting without a sidebar', async () => {
    // The in-page continuous switch moved out with the sidebar; the persisted
    // setting (also exposed on the options page) must still drive playback.
    await act(async () => {
      await saveSettings({ playback: { continuous: true } });
    });
    const { app, video } = await mountApp();
    await deliverCues();
    await waitFor(() => expect(currentEnglish(app)).toBe('Hello there.'));

    const playRange = vi.spyOn(playerController, 'playRange');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    });
    await waitFor(() =>
      expect(playRange).toHaveBeenLastCalledWith(3.5, 5, { pauseAtEnd: false }),
    );
    expect(video.currentTime).toBeCloseTo(3.5, 5);
    playRange.mockRestore();
  });

  it('toggles English and Chinese blur independently through the shadow UI', async () => {
    const { app } = await mountApp();
    await deliverCues();
    await waitFor(() => expect(overlayLine(app, 'zh')?.textContent).toBe('你好。'));

    const root = app.ui.container.querySelector<HTMLElement>('[data-earworm-root]')!;
    expect(document.querySelector('earworm-sidebar-host')).toBeNull();
    const menu = await openQuickMenu(app);
    const enSwitch = await waitFor(() => {
      const element = menu.querySelector<HTMLElement>('[aria-label="模糊英文"]');
      expect(element).not.toBeNull();
      return element!;
    });
    const zhSwitch = menu.querySelector<HTMLElement>('[aria-label="模糊中文"]')!;

    fireEvent.click(enSwitch);
    await waitFor(() => {
      expect(root).toHaveAttribute('data-blur-en', '1');
      expect(root).toHaveAttribute('data-blur-zh', '0');
    });
    const enText = overlayLine(app, 'en')?.querySelector('[data-lang="en"]');
    expect(enText).not.toBeNull();
    await waitFor(() =>
      expect(getComputedStyle(enText!).filter).toContain('blur(5px)'),
    );
    // Independence is asserted on the root flags; Chinese text is still shown.
    expect(overlayLine(app, 'zh')?.textContent).toBe('你好。');

    fireEvent.click(zhSwitch);
    await waitFor(() => {
      expect(root).toHaveAttribute('data-blur-en', '1');
      expect(root).toHaveAttribute('data-blur-zh', '1');
    });
    // Re-query: the toggle re-render may replace the overlay line node.
    const zhBlurred = overlayLine(app, 'zh');
    expect(zhBlurred).not.toBeNull();
    await waitFor(() =>
      expect(getComputedStyle(zhBlurred!).filter).toContain('blur(5px)'),
    );
  });

  it('opens the dictionary popup for a clicked word with its collocation card', async () => {
    const { app, video } = await mountApp();
    video.advance(3.5); // "I give up." is the current sentence
    await deliverCues();
    await waitFor(() => expect(overlayLine(app, 'zh')?.textContent).toBe('我放弃。'));

    const word = await waitFor(() => {
      const element = app.ui.container.querySelector<HTMLElement>(
        '[data-ew-overlay] [data-word="give"]',
      );
      expect(element).not.toBeNull();
      return element!;
    });
    fireEvent.click(word);

    await waitFor(() => {
      expect(
        app.ui.portalContainer.querySelector('[data-earworm-dictionary]'),
      ).not.toBeNull();
    });
    const card = app.ui.portalContainer.querySelector('[data-earworm-dictionary]');
    expect(card).toHaveAttribute('data-state', 'ready');
    expect(
      card?.querySelector('[data-ew-dict-headword]')?.textContent,
    ).toBe('give');
    expect(card?.querySelector('[data-ew-dict-phonetic]')?.textContent).toBe('/ɡɪv/');
    expect(card?.querySelector('[data-ew-dict-translation]')?.textContent).toContain(
      '给',
    );
    expect(card?.querySelector('[data-ew-dict-collocation]')).toHaveAttribute(
      'data-source',
      'llm',
    );
    expect(card?.querySelector('[data-ew-dict-note]')?.textContent).toBe('放弃');
  });

  it('leaves a replaced recommended column alone and still opens the overlay dictionary', async () => {
    const { app, video } = await mountApp();
    video.advance(3.5);
    await deliverCues();
    await waitFor(() => expect(currentEnglish(app)).toBe('I give up.'));

    const secondary = document.querySelector('#secondary')!;
    const newInner = document.createElement('div');
    newInner.id = 'secondary-inner';
    const recommended = document.createElement('div');
    recommended.setAttribute('data-recommended', '');
    newInner.appendChild(recommended);
    secondary.replaceChildren(newInner);

    // The old sidebar re-inserted itself on column replacement; it must not.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(newInner.children).toHaveLength(1);
    expect(newInner.firstElementChild).toBe(recommended);
    expect(document.querySelector('earworm-sidebar-host')).toBeNull();
    expect(currentEnglish(app)).toBe('I give up.');

    const word = await waitFor(() => {
      const element = app.ui.container.querySelector<HTMLElement>(
        '[data-ew-overlay] [data-word="give"]',
      );
      expect(element).not.toBeNull();
      return element!;
    });
    fireEvent.click(word);
    await waitFor(() => {
      const card = app.ui.portalContainer.querySelector('[data-earworm-dictionary]');
      expect(card).toHaveAttribute('data-state', 'ready');
    });
    expect(
      app.ui.portalContainer.querySelector('[data-ew-dict-headword]')?.textContent,
    ).toBe('give');
  });

  it('shows 无字幕 without requesting translation and leaves playback alone', async () => {
    const harness = installRuntime();
    const { app, video } = await mountApp();

    await deliverFailure('vid1', 'no-captions');
    await waitFor(() => {
      expect(
        app.ui.container.querySelector('[data-ew-status="no-captions"]'),
      ).not.toBeNull();
    });
    expect(app.ui.container.textContent).toContain('无字幕');
    expect(harness.send).not.toHaveBeenCalled();
    expect(video.pauseCalls).toBe(0);
  });

  it('keeps English on partial failure, then retries just the failed sentence', async () => {
    const harness = installRuntime();
    harness.missing = new Set([1]);
    const { app } = await mountApp();

    await deliverCues();
    await waitFor(() => expect(currentEnglish(app)).toBe('Hello there.'));
    await waitFor(() => expect(overlayLine(app, 'zh')?.textContent).toBe('你好。'));
    // The failed sentence keeps its English; the successful one is bilingual.
    await waitFor(async () => {
      expect((await translationProgress(app)).failed).toContain('失败 1');
    });
    expect(harness.commitCalls).toHaveLength(0);

    harness.missing = new Set();
    const menu = await openQuickMenu(app);
    const retry = await waitFor(() => {
      const button = Array.from(menu.querySelectorAll('button')).find((candidate) =>
        candidate.textContent?.includes('重试'),
      );
      expect(button).not.toBeUndefined();
      return button!;
    });
    fireEvent.click(retry);

    await waitFor(() => expect(harness.commitCalls).toHaveLength(1));
    await waitFor(async () => {
      const progress = await translationProgress(app);
      expect(progress.label).toContain('翻译 2/2');
      expect(progress.failed).toBeNull();
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    });
    await waitFor(() => expect(overlayLine(app, 'zh')?.textContent).toBe('我放弃。'));
    expect(harness.translateCalls).toHaveLength(2);
    expect(harness.translateCalls[1]?.batch).toEqual([
      { i: 1, text: 'I give up.', prev: 'Hello there.' },
    ]);
  });

  it('reuses the cache on the second open with zero translate requests', async () => {
    const harness = installRuntime();
    const first = await mountApp();
    await deliverCues();
    await waitFor(() => expect(currentEnglish(first.app)).toBe('Hello there.'));
    await waitFor(() => expect(overlayLine(first.app, 'zh')?.textContent).toBe('你好。'));
    await waitFor(async () => {
      expect((await translationProgress(first.app)).label).toContain('翻译 2/2');
    });
    expect(harness.translateCalls).toHaveLength(1);
    expect(harness.commitCalls).toHaveLength(1);

    act(() => unmountContentApp());
    mounted = null;
    expect(document.querySelector('earworm-sidebar-host')).toBeNull();

    const second = await mountApp();
    await deliverCues();
    await waitFor(() => expect(currentEnglish(second.app)).toBe('Hello there.'));
    await waitFor(() => expect(overlayLine(second.app, 'zh')?.textContent).toBe('你好。'));
    await waitFor(async () => {
      expect((await translationProgress(second.app)).label).toContain('翻译 2/2');
    });

    // Same video + same cue hash: a get-cached hit, no second LLM batch.
    expect(harness.translateCalls).toHaveLength(1);
    expect(harness.commitCalls).toHaveLength(1);
  });

  it('resets and re-acquires on YouTube SPA navigation', async () => {
    const harness = installRuntime();
    const { app } = await mountApp();
    await deliverCues();
    await waitFor(() => expect(currentEnglish(app)).toBe('Hello there.'));

    await navigateTo('vid2');
    await waitFor(() => expect(overlayLine(app, 'en')).toBeNull());

    await deliverCues(
      [
        { start: 0, end: 2, text: 'Brand new' },
        { start: 2, end: 3, text: 'video.' },
      ],
      'vid2',
    );
    await waitFor(() => expect(currentEnglish(app)).toBe('Brand new video.'));
    expect(app.ui.container.textContent).not.toContain('Hello there.');
    await waitFor(() =>
      expect(overlayLine(app, 'en')?.textContent).toBe('Brand new video.'),
    );
    expect(harness.translateCalls.at(-1)?.videoId).toBe('vid2');
  });
});
