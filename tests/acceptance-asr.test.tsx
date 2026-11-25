/**
 * Acceptance test for ticket #30: YouTube auto-generated English captions
 * (kind=asr) are the fallback subtitle source when no manual track exists.
 *
 * Mounts the REAL `ContentApp` (session engine, overlay, shortcuts)
 * and drives it through the real `window.postMessage` bridge, exactly like
 * `tests/acceptance.test.tsx`. Only the expensive/network boundaries are
 * mocked: `chrome.runtime.sendMessage` (translation channel), the shipped
 * collocation data loader and the dictionary preload.
 *
 * The ASR path is exercised end to end: cues arrive with `kind: 'asr'`, the
 * sentence merger applies the ASR pause rule (no punctuation in the cues), the
 * merged sentences are translated, and a/s/d navigate the bilingual overlay.
 */
import { act } from 'react';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Cue, type LlmSentenceResult } from '@/lib/contracts';
import { resetCollocationTable, setCollocationTable } from '@/lib/collocations';
import { SETTINGS_STORAGE_KEY } from '@/lib/settings';
import {
  type CuesReadyPayload,
  type GetCachedResponse,
  type InjectEnvelope,
  type RuntimeRequest,
  type TranslateBatchRequest,
  type TranslateBatchResponse,
} from '@/lib/messages';
import { postCuesReady } from '@/lib/transcript';
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
}));

vi.mock('@/lib/collocations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/collocations')>();
  return { ...actual, loadCollocationTable: seams.loadCollocationTable };
});

vi.mock('@/lib/dict', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dict')>();
  return { ...actual, preloadDictionary: seams.preloadDictionary };
});

/* -------------------------------------------------------------------------- */
/* fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * ASR cues have no sentence punctuation. The 1s pause after cue 0 must end a
 * sentence, while the 0.5s pause before cue 2 must keep it in the same one.
 */
const ASR_CUES: Cue[] = [
  { start: 0, end: 2, text: 'Hello there' },
  { start: 3, end: 5, text: 'how are you today' },
  { start: 5.5, end: 7, text: 'I am fine' },
];

const HEADER = `
  <div id="movie_player"><div class="ytp-chrome-bottom"></div></div>
  <div id="secondary"></div>
`;

type RuntimeHarness = {
  send: ReturnType<typeof vi.fn>;
  translateCalls: TranslateBatchRequest[];
};

/** In-memory stand-in for the background worker's LLM channel. */
function installRuntime(): RuntimeHarness {
  const translateCalls: TranslateBatchRequest[] = [];
  const send = vi.fn(async (request: RuntimeRequest) => {
    switch (request.type) {
      case 'earworm:get-cached':
        return { hit: false } satisfies GetCachedResponse;
      case 'earworm:translate-batch': {
        translateCalls.push(request);
        const results: LlmSentenceResult[] = request.batch.map((item) => ({
          i: item.i,
          zh: item.i === 0 ? '你好。' : '你好吗？我很好。',
        }));
        return {
          ok: true,
          model: 'acceptance-model',
          results,
        } satisfies TranslateBatchResponse;
      }
      default:
        return { ok: true };
    }
  });
  chrome.runtime.sendMessage = send as unknown as typeof chrome.runtime.sendMessage;
  return { send, translateCalls };
}

/* -------------------------------------------------------------------------- */
/* mount / drive helpers                                                      */
/* -------------------------------------------------------------------------- */

let mounted: MountedContentApp | null = null;

async function mountApp(): Promise<{ app: MountedContentApp; video: FakeVideo }> {
  let app!: MountedContentApp;
  await act(async () => {
    app = mountContentApp({ css: '' });
  });
  mounted = app;

  const video = new FakeVideo();
  playerController.attach(video.asVideo());

  await waitFor(() => {
    expect(app.ui.container.querySelector('[data-earworm-root]')).not.toBeNull();
  });
  return { app, video };
}

/**
 * `happy-dom` does not set `MessageEvent.source` for `window.postMessage`, and
 * the production bridge correctly rejects another source. Capture the REAL
 * envelope produced by `postCuesReady`, then dispatch it with `source: window`
 * so the real inject→content validation and transcript client both run.
 */
function dispatchAsrCues(payload: CuesReadyPayload): void {
  let envelope: InjectEnvelope | undefined;
  const capture = {
    postMessage(data: InjectEnvelope): void {
      envelope = data;
    },
  } as unknown as Window;
  postCuesReady(payload, capture);
  window.dispatchEvent(
    new MessageEvent('message', {
      data: envelope,
      source: window,
      origin: window.location.origin,
    }),
  );
}

async function deliverAsrCues(cues: Cue[] = ASR_CUES, videoId = 'vid1'): Promise<void> {
  await act(async () => {
    dispatchAsrCues({ videoId, lang: 'en', kind: 'asr', cues });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function overlayLine(app: MountedContentApp, lang: 'en' | 'zh'): HTMLElement | null {
  return app.ui.container.querySelector<HTMLElement>(`[data-ew-line="${lang}"]`);
}

function currentEnglish(app: MountedContentApp): string {
  return overlayLine(app, 'en')?.textContent ?? '';
}

async function pressKey(key: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

beforeEach(() => {
  mounted = null;
  document.body.innerHTML = HEADER;
  document.title = 'ASR acceptance - YouTube';
  window.history.replaceState({}, '', '/watch?v=vid1');

  seedStorage(SETTINGS_STORAGE_KEY, {
    ...DEFAULT_SETTINGS,
    ui: { enabled: true },
  });

  resetCollocationTable();
  setCollocationTable([]);
  seams.loadCollocationTable.mockReset().mockResolvedValue([]);
  seams.preloadDictionary.mockReset().mockResolvedValue(null);
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
/* test                                                                       */
/* -------------------------------------------------------------------------- */

describe('acceptance: ASR-only video (ticket #30)', () => {
  it('splits ASR cues on pauses, shows a bilingual overlay and navigates a/s/d', async () => {
    const harness = installRuntime();
    const { app, video } = await mountApp();
    video.advance(1); // current sentence = "Hello there"

    await deliverAsrCues();
    await waitFor(() => expect(currentEnglish(app)).toBe('Hello there'));

    // ASR pause rule: the 1s gap split cue 0; the 0.5s gap kept cues 1+2.
    // Only the current 字幕句 is painted now, so navigation exposes the split.
    await waitFor(() => expect(overlayLine(app, 'zh')?.textContent).toBe('你好。'));

    // The ASR-merged sentences (not the raw cues) are what gets translated.
    expect(harness.translateCalls).toHaveLength(1);
    expect(harness.translateCalls[0]?.batch.map((item) => item.text)).toEqual([
      'Hello there',
      'how are you today I am fine',
    ]);

    const playRange = vi.spyOn(playerController, 'playRange');

    // d = next sentence: seek to 3s and pause at the ASR sentence end (7s).
    await pressKey('d');
    await waitFor(() =>
      expect(currentEnglish(app)).toBe('how are you today I am fine'),
    );
    expect(video.currentTime).toBeCloseTo(3, 5);
    expect(playRange).toHaveBeenLastCalledWith(3, 7, { pauseAtEnd: true });
    await waitFor(() => expect(overlayLine(app, 'zh')?.textContent).toBe('你好吗？我很好。'));

    // s = repeat the current (second) sentence.
    await pressKey('s');
    await waitFor(() => expect(playRange).toHaveBeenLastCalledWith(3, 7, { pauseAtEnd: true }));
    expect(video.currentTime).toBeCloseTo(3, 5);

    // a = previous sentence, back to the first ASR sentence.
    await pressKey('a');
    await waitFor(() => expect(currentEnglish(app)).toBe('Hello there'));
    expect(video.currentTime).toBeCloseTo(0, 5);
    expect(playRange).toHaveBeenLastCalledWith(0, 2, { pauseAtEnd: true });

    playRange.mockRestore();
  });
});
