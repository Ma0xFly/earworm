import { createHash } from 'node:crypto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import {
  DEFAULT_SETTINGS,
  type CachedTranslation,
  type CueTrack,
  type LearningSentence,
  type Settings,
} from '@/lib/contracts';
import type {
  GetCachedResponse,
  RuntimeRequest,
  TranslateBatchRequest,
  TranslateBatchResponse,
} from '@/lib/messages';
import type { TranscriptHandlers } from '@/lib/transcript';
import type { SessionApi } from '@/features/session';
import { SETTINGS_STORAGE_KEY, SettingsProvider, useSettings } from '@/lib/settings';
import { resetCollocationTable, setCollocationTable, type CollocationEntry } from '@/lib/collocations';
import { readStorage, seedStorage } from '../../../tests/mocks/chrome';
import { playerController } from '@/features/playback';
import { FakeVideo } from '../../../tests/mocks/video';
import { SessionProvider } from './SessionProvider';
import { useSession } from './SessionProvider';

/* -------------------------------------------------------------------------- */
/* module seams                                                                */
/* -------------------------------------------------------------------------- */

const seams = vi.hoisted(() => ({
  startTranscriptClient: vi.fn(),
  stopTranscriptClient: vi.fn(),
  requestProduce: vi.fn(),
  handlers: null as TranscriptHandlers | null,
  loadCollocationTable: vi.fn(),
  preloadDictionary: vi.fn(),
}));

vi.mock('@/lib/transcript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/transcript')>();
  return {
    ...actual,
    startTranscriptClient: seams.startTranscriptClient,
    requestProduce: seams.requestProduce,
  };
});

vi.mock('@/lib/collocations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/collocations')>();
  return { ...actual, loadCollocationTable: seams.loadCollocationTable };
});

vi.mock('@/lib/dict', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dict')>();
  return { ...actual, preloadDictionary: seams.preloadDictionary };
});

/* -------------------------------------------------------------------------- */
/* fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const WATCH_DOM = `
  <h1 class="ytd-watch-metadata"><yt-formatted-string>Watch video</yt-formatted-string></h1>
  <div id="owner"><div id="channel-name"><a>Watch channel</a></div></div>
`;

const TRACK: CueTrack = {
  videoId: 'vid1',
  lang: 'en',
  kind: 'manual',
  cues: [
    { start: 0, end: 2, text: 'Hello there.' },
    { start: 2.5, end: 4.5, text: 'I give up.' },
  ],
};

const PLAIN = { ...DEFAULT_SETTINGS };

type SendResult = unknown;

let api: SessionApi | null = null;
let roots: Root[] = [];

function Probe() {
  const { settings } = useSettings();
  api = useSession();
  return <span data-continuous={settings.playback.continuous ? '1' : '0'} />;
}

function renderSession(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      <SettingsProvider>
        <SessionProvider>
          <Probe />
        </SessionProvider>
      </SettingsProvider>,
    );
  });
  return { container, root };
}

function setVideo(videoId: string): void {
  window.history.replaceState({}, '', videoId ? `/watch?v=${videoId}` : '/');
}

function sendMock(impl: (request: RuntimeRequest) => SendResult): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (request: RuntimeRequest) => impl(request));
  chrome.runtime.sendMessage = fn as unknown as typeof chrome.runtime.sendMessage;
  return fn;
}

function requestsOf(fn: ReturnType<typeof vi.fn>, type: RuntimeRequest['type']): RuntimeRequest[] {
  return fn.mock.calls
    .map((call) => call[0] as RuntimeRequest)
    .filter((request) => request.type === type);
}

function successResponse(request: TranslateBatchRequest): TranslateBatchResponse {
  return {
    ok: true,
    model: 'test-model',
    results: request.batch.map((item) => ({
      i: item.i,
      zh: `译文${item.i}`,
      cols:
        item.i === 0
          ? [{ text: 'not in this sentence', note: '不存在' }]
          : [{ text: 'give up', note: '放弃' }],
    })),
  };
}

function cuesOf(count: number): CueTrack['cues'] {
  return Array.from({ length: count }, (_, index) => ({
    start: index * 3,
    end: index * 3 + 2,
    text: `Sentence ${index}.`,
  }));
}

function defaultSend(request: RuntimeRequest): SendResult {
  switch (request.type) {
    case 'earworm:get-cached':
      return Promise.resolve({ hit: false } satisfies GetCachedResponse);
    case 'earworm:translate-batch':
      return Promise.resolve(successResponse(request));
    default:
      return Promise.resolve({ ok: true });
  }
}

async function deliverTrack(track: CueTrack = TRACK): Promise<void> {
  if (!seams.handlers) throw new Error('transcript client not started');
  await act(async () => {
    seams.handlers?.onTrack(track);
  });
}

async function deliverFailure(videoId: string, reason: Parameters<TranscriptHandlers['onFailure']>[1]): Promise<void> {
  if (!seams.handlers) throw new Error('transcript client not started');
  await act(async () => {
    seams.handlers?.onFailure(videoId, reason);
  });
}

async function waitForStatus(status: string): Promise<void> {
  await waitFor(() => expect(api?.state.status).toBe(status));
}

async function waitForTranslation(state: string): Promise<void> {
  await waitFor(() => expect(api?.state.translation.state).toBe(state));
}

beforeEach(() => {
  api = null;
  roots = [];
  setVideo('vid1');
  document.title = 'Watch video - YouTube';
  document.body.innerHTML = WATCH_DOM;

  seams.handlers = null;
  seams.startTranscriptClient.mockReset().mockImplementation((handlers: TranscriptHandlers) => {
    seams.handlers = handlers;
    return seams.stopTranscriptClient;
  });
  seams.stopTranscriptClient.mockReset();
  seams.requestProduce.mockReset();
  seams.loadCollocationTable.mockReset().mockResolvedValue([{ text: 'give up' }]);
  seams.preloadDictionary.mockReset().mockResolvedValue(null);

  resetCollocationTable();
  setCollocationTable([{ text: 'give up' }]);
  seedStorage(SETTINGS_STORAGE_KEY, PLAIN);
  chrome.runtime.sendMessage = vi.fn(async (request: RuntimeRequest) => defaultSend(request)) as unknown as typeof chrome.runtime.sendMessage;
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  playerController.detach();
  setVideo('');
  document.title = '';
});

/* -------------------------------------------------------------------------- */
/* failure states                                                              */
/* -------------------------------------------------------------------------- */

describe('session failure states', () => {
  it('reports no-captions without requesting a translation', async () => {
    renderSession();
    await waitForStatus('acquiring');

    await deliverFailure('vid1', 'no-captions');

    expect(api?.state.status).toBe('no-captions');
    expect(api?.state.sentences).toEqual([]);
    expect(api?.state.translation).toEqual({ state: 'idle', done: 0, total: 0, failed: 0 });
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('treats ASR-only tracks as no-captions', async () => {
    renderSession();
    await deliverFailure('vid1', 'asr-only');

    expect(api?.state.status).toBe('no-captions');
    expect(api?.state.sentences).toEqual([]);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('surfaces acquisition errors with the classified reason', async () => {
    renderSession();
    await deliverFailure('vid1', 'timeout');

    expect(api?.state.status).toBe('error');
    expect(api?.state.error).toBe('timeout');
    expect(api?.state.sentences).toEqual([]);
  });

  it('ignores failures for a different video', async () => {
    renderSession();
    await deliverFailure('other-video', 'no-captions');

    expect(api?.state.status).toBe('acquiring');
  });

  it('retryAll re-acquires captions after an acquisition error', async () => {
    renderSession();
    await deliverFailure('vid1', 'timeout');
    expect(api?.state.status).toBe('error');

    await act(async () => {
      api?.retryAll();
    });

    expect(api?.state.status).toBe('acquiring');
    expect(api?.state.error).toBeUndefined();
    expect(api?.state.sentences).toEqual([]);
    expect(seams.requestProduce).toHaveBeenCalledTimes(1);
    expect(seams.requestProduce).toHaveBeenCalledWith({ videoId: 'vid1', force: true });
  });

  it('retryAll retries acquisition after a no-captions result too', async () => {
    renderSession();
    await deliverFailure('vid1', 'no-captions');
    expect(api?.state.status).toBe('no-captions');

    await act(async () => {
      api?.retryAll();
    });

    expect(api?.state.status).toBe('acquiring');
    expect(seams.requestProduce).toHaveBeenCalledWith({ videoId: 'vid1', force: true });
  });

  it('a retried acquisition produces a fresh ready session', async () => {
    renderSession();
    await deliverFailure('vid1', 'timeout');

    await act(async () => {
      api?.retryAll();
    });
    expect(api?.state.status).toBe('acquiring');

    await deliverTrack();
    await waitForTranslation('done');
    expect(api?.state.status).toBe('ready');
    expect(api?.state.sentences).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* track pipeline                                                              */
/* -------------------------------------------------------------------------- */

describe('session track pipeline', () => {
  it('shows offline collocation spans before translation starts', async () => {
    let resolveCache: ((value: GetCachedResponse) => void) | null = null;
    sendMock((request) => {
      if (request.type === 'earworm:get-cached') {
        return new Promise<GetCachedResponse>((resolve) => {
          resolveCache = resolve;
        });
      }
      return defaultSend(request);
    });

    renderSession();
    await deliverTrack();
    await waitForStatus('ready');

    const sentence = api?.state.sentences[1] as LearningSentence;
    expect(sentence.cols).toEqual([
      { start: 2, end: 9, text: 'give up', source: 'offline' },
    ]);
    expect(sentence.status).toBe('pending');
    expect(api?.state.sentences[0]?.cols).toEqual([]);
    expect(api?.state.translation).toEqual({ state: 'running', done: 0, total: 2, failed: 0 });

    await act(async () => {
      resolveCache?.({ hit: false });
    });
    await waitForTranslation('done');
  });

  it('translates a cache miss in batches of 40 with global indexes and neighbour context', async () => {
    const cues = cuesOf(81);
    const send = sendMock(defaultSend);
    const expectedHash = createHash('sha256')
      .update(cues.map((cue) => cue.text).join('\n'))
      .digest('hex');

    renderSession();
    await deliverTrack({ ...TRACK, cues });
    await waitForTranslation('done');

    const cached = requestsOf(send, 'earworm:get-cached')[0];
    expect(cached).toEqual({ type: 'earworm:get-cached', videoId: 'vid1', cuesHash: expectedHash });

    const batches = requestsOf(send, 'earworm:translate-batch') as TranslateBatchRequest[];
    expect(batches.map((batch) => batch.batch.length)).toEqual([40, 40, 1]);
    expect(batches.map((batch) => batch.batchIndex)).toEqual([0, 1, 2]);
    expect(batches.map((batch) => batch.batchCount)).toEqual([3, 3, 3]);
    expect(batches[0]?.meta).toEqual({
      videoId: 'vid1',
      title: 'Watch video',
      channel: 'Watch channel',
    });

    // Global index i, and prev/next even across a batch boundary.
    expect(batches[0]?.batch[0]).toEqual({ i: 0, text: 'Sentence 0.', next: 'Sentence 1.' });
    expect(batches[0]?.batch[39]).toEqual({
      i: 39,
      text: 'Sentence 39.',
      prev: 'Sentence 38.',
      next: 'Sentence 40.',
    });
    expect(batches[1]?.batch[0]).toEqual({
      i: 40,
      text: 'Sentence 40.',
      prev: 'Sentence 39.',
      next: 'Sentence 41.',
    });
    expect(batches[2]?.batch[0]).toEqual({ i: 80, text: 'Sentence 80.', prev: 'Sentence 79.' });

    expect(api?.state.translation).toEqual({ state: 'done', done: 81, total: 81, failed: 0 });
    expect(api?.state.sentences.every((sentence) => sentence.status === 'done')).toBe(true);

    const commits = requestsOf(send, 'earworm:commit');
    expect(commits).toHaveLength(1);
    if (commits[0]?.type !== 'earworm:commit') throw new Error('expected commit');
    expect(commits[0].data.zh).toHaveLength(81);
    expect(commits[0].data.zh[0]).toBe('译文0');
    expect(commits[0].data.model).toBe('test-model');
  });

  it('keeps the translation when LLM spans do not align and unifies valid spans', async () => {
    const send = sendMock((request) => {
      if (request.type === 'earworm:translate-batch') {
        return Promise.resolve({
          ok: true,
          model: 'test-model',
          results: [
            { i: 0, zh: '你好。', cols: [{ text: 'give up', note: '不存在' }] },
            { i: 1, zh: '我放弃。', cols: [{ text: 'give up', note: '放弃' }] },
          ],
        } satisfies TranslateBatchResponse);
      }
      return defaultSend(request);
    });

    renderSession();
    await deliverTrack();
    await waitForTranslation('done');

    // Invalid span dropped, translation kept.
    expect(api?.state.sentences[0]).toMatchObject({ zh: '你好。', status: 'done', cols: [] });
    // Valid span aligned and unioned with the identical offline span (LLM wins).
    const cols = api?.state.sentences[1]?.cols ?? [];
    expect(cols).toHaveLength(1);
    expect(cols[0]).toMatchObject({ text: 'give up', source: 'llm', note: '放弃' });

    const commits = requestsOf(send, 'earworm:commit');
    expect(commits).toHaveLength(1);
    if (commits[0]?.type !== 'earworm:commit') throw new Error('expected commit');
    expect(commits[0].data.cols).toEqual([[], [{ text: 'give up', note: '放弃' }]]);
  });

  it('only marks a cache commit committed after ok, and retries a failed commit', async () => {
    let commitCalls = 0;
    const send = sendMock((request) => {
      if (request.type === 'earworm:commit') {
        commitCalls += 1;
        return Promise.resolve(
          commitCalls === 1 ? { ok: false, error: 'cache unavailable' } : { ok: true },
        );
      }
      return defaultSend(request);
    });

    renderSession();
    await deliverTrack();
    await waitForTranslation('done');

    await waitFor(() => expect(requestsOf(send, 'earworm:commit')).toHaveLength(1));
    // The failed commit must not be treated as committed: "retry all" (no
    // failed sentences) retries the cache write instead of doing nothing.
    await act(async () => {
      api?.retryAll();
    });
    await waitFor(() => expect(requestsOf(send, 'earworm:commit')).toHaveLength(2));

    // A successful commit is final; another retry is a no-op.
    await act(async () => {
      api?.retryAll();
    });
    await waitFor(() => expect(requestsOf(send, 'earworm:commit')).toHaveLength(2));
    expect(commitCalls).toBe(2);
  });

  it('applies successful sentences and marks only the rest failed, without committing', async () => {
    const send = sendMock((request) => {
      if (request.type === 'earworm:translate-batch') {
        return Promise.resolve({
          ok: true,
          model: 'test-model',
          results: [{ i: 0, zh: '你好。' }],
        } satisfies TranslateBatchResponse);
      }
      return defaultSend(request);
    });

    renderSession();
    await deliverTrack();
    await waitForTranslation('partial');

    expect(api?.state.translation).toEqual({ state: 'partial', done: 1, total: 2, failed: 1 });
    expect(api?.state.sentences[0]).toMatchObject({ zh: '你好。', status: 'done' });
    // Offline spans survive on the failed sentence; the English stays visible.
    expect(api?.state.sentences[1]?.status).toBe('failed');
    expect(api?.state.sentences[1]?.zh).toBeUndefined();
    expect(api?.state.sentences[1]?.cols).toEqual([
      { start: 2, end: 9, text: 'give up', source: 'offline' },
    ]);
    expect(requestsOf(send, 'earworm:commit')).toHaveLength(0);
  });

  it('retrySentence resends only that sentence with context and updates on success', async () => {
    const send = sendMock((request) => {
      if (request.type === 'earworm:translate-batch') {
        return Promise.resolve({
          ok: true,
          model: 'test-model',
          results: [{ i: 0, zh: '你好。' }],
        } satisfies TranslateBatchResponse);
      }
      return defaultSend(request);
    });

    renderSession();
    await deliverTrack();
    await waitForTranslation('partial');

    send.mockImplementation(async (request: RuntimeRequest) => defaultSend(request));
    await act(async () => {
      api?.retrySentence(1);
    });
    await waitForTranslation('done');

    const translations = requestsOf(send, 'earworm:translate-batch') as TranslateBatchRequest[];
    expect(translations).toHaveLength(2);
    expect(translations[1]?.batch).toEqual([
      { i: 1, text: 'I give up.', prev: 'Hello there.' },
    ]);
    expect(translations[1]?.batchIndex).toBe(0);
    expect(translations[1]?.batchCount).toBe(1);
    expect(api?.state.sentences[1]).toMatchObject({ zh: '译文1', status: 'done' });
    expect(api?.state.translation).toEqual({ state: 'done', done: 2, total: 2, failed: 0 });
    expect(requestsOf(send, 'earworm:commit')).toHaveLength(1);
  });

  it('retrySentence keeps the failed state when the retry fails', async () => {
    const send = sendMock((request) => {
      if (request.type === 'earworm:translate-batch') {
        return Promise.resolve({
          ok: true,
          model: 'test-model',
          results: [{ i: 0, zh: '你好。' }],
        } satisfies TranslateBatchResponse);
      }
      return defaultSend(request);
    });

    renderSession();
    await deliverTrack();
    await waitForTranslation('partial');

    send.mockImplementation(async (request: RuntimeRequest) =>
      request.type === 'earworm:translate-batch'
        ? ({ ok: false, error: 'endpoint down' } satisfies TranslateBatchResponse)
        : defaultSend(request),
    );
    await act(async () => {
      api?.retrySentence(1);
    });
    await waitFor(() => expect(api?.state.translation.state).toBe('partial'));

    expect(api?.state.sentences[1]).toMatchObject({ status: 'failed' });
    expect(api?.state.translation).toEqual({ state: 'partial', done: 1, total: 2, failed: 1 });
    expect(requestsOf(send, 'earworm:commit')).toHaveLength(0);
  });

  it('retryAll sends every failed sentence and none of the successful ones', async () => {
    const cues: CueTrack['cues'] = [
      { start: 0, end: 2, text: 'Hello there.' },
      { start: 2.5, end: 4.5, text: 'I give up.' },
      { start: 5, end: 7, text: 'Goodbye now.' },
    ];
    const send = sendMock((request) => {
      if (request.type === 'earworm:translate-batch') {
        return Promise.resolve({
          ok: true,
          model: 'test-model',
          results: [{ i: 0, zh: '你好。' }],
        } satisfies TranslateBatchResponse);
      }
      return defaultSend(request);
    });

    renderSession();
    await deliverTrack({ ...TRACK, cues });
    await waitForTranslation('partial');
    expect(api?.state.translation.failed).toBe(2);

    send.mockImplementation(async (request: RuntimeRequest) => defaultSend(request));
    await act(async () => {
      api?.retryAll();
    });
    await waitForTranslation('done');

    const translations = requestsOf(send, 'earworm:translate-batch') as TranslateBatchRequest[];
    expect(translations).toHaveLength(2);
    expect(translations[1]?.batch.map((item) => item.i)).toEqual([1, 2]);
    expect(translations[1]?.batch[0]).toMatchObject({
      i: 1,
      prev: 'Hello there.',
      next: 'Goodbye now.',
    });
    expect(api?.state.sentences.map((sentence) => sentence.status)).toEqual(['done', 'done', 'done']);
    expect(api?.state.translation).toEqual({ state: 'done', done: 3, total: 3, failed: 0 });
    expect(requestsOf(send, 'earworm:commit')).toHaveLength(1);
  });

  it('retryAll chunks many failed sentences into batches of 40', async () => {
    const cues = cuesOf(45);
    const send = sendMock((request) => {
      if (request.type === 'earworm:translate-batch') {
        return Promise.resolve({
          ok: true,
          model: 'test-model',
          results: request.batch.some((item) => item.i === 0)
            ? [{ i: 0, zh: '译文0' }]
            : [],
        } satisfies TranslateBatchResponse);
      }
      return defaultSend(request);
    });

    renderSession();
    await deliverTrack({ ...TRACK, cues });
    await waitForTranslation('partial');
    expect(api?.state.translation.failed).toBe(44);

    send.mockImplementation(async (request: RuntimeRequest) => defaultSend(request));
    await act(async () => {
      api?.retryAll();
    });
    await waitForTranslation('done');

    const translations = (requestsOf(send, 'earworm:translate-batch') as TranslateBatchRequest[]).slice(2);
    expect(translations.map((batch) => batch.batch.length)).toEqual([40, 4]);
    expect(translations[0]?.batch.map((item) => item.i)[0]).toBe(1);
    expect(translations[1]?.batch.map((item) => item.i)[0]).toBe(41);
    expect(api?.state.translation).toEqual({ state: 'done', done: 45, total: 45, failed: 0 });
    expect(requestsOf(send, 'earworm:commit')).toHaveLength(1);
  });

  it('cancels remaining translation batches when the SPA navigates away', async () => {
    const cues = cuesOf(81);
    const pending: Array<{
      request: TranslateBatchRequest;
      resolve: (response: TranslateBatchResponse) => void;
    }> = [];
    const send = sendMock((request) => {
      if (request.type === 'earworm:get-cached') return Promise.resolve({ hit: false });
      if (request.type === 'earworm:translate-batch') {
        return new Promise<TranslateBatchResponse>((resolve) => {
          pending.push({ request, resolve });
        });
      }
      return Promise.resolve({ ok: true });
    });

    renderSession();
    await deliverTrack({ ...TRACK, cues });
    await waitFor(() => expect(pending.length).toBe(2));

    setVideo('vid2');
    await act(async () => {
      window.dispatchEvent(new Event('yt-navigate-finish'));
    });
    expect(api?.state.videoId).toBe('vid2');
    expect(api?.state.sentences).toEqual([]);

    // Drain the two in-flight vid1 batches after navigation: the worker must
    // not launch the third batch nor apply the responses.
    while (pending.length > 0) {
      const entry = pending.shift()!;
      await act(async () => {
        entry.resolve(successResponse(entry.request));
      });
    }
    expect(requestsOf(send, 'earworm:translate-batch')).toHaveLength(2);
    expect(requestsOf(send, 'earworm:commit')).toHaveLength(0);
    expect(api?.state.sentences).toEqual([]);
  });

  it('runs at most two translation requests concurrently', async () => {
    const cues = cuesOf(81);
    const pending: Array<{
      request: TranslateBatchRequest;
      resolve: (response: TranslateBatchResponse) => void;
    }> = [];
    let inFlight = 0;
    let peak = 0;

    sendMock((request) => {
      if (request.type === 'earworm:get-cached') return Promise.resolve({ hit: false });
      if (request.type === 'earworm:translate-batch') {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        return new Promise<TranslateBatchResponse>((resolve) => {
          pending.push({
            request,
            resolve: (response) => {
              inFlight -= 1;
              resolve(response);
            },
          });
        });
      }
      return Promise.resolve({ ok: true });
    });

    renderSession();
    await deliverTrack({ ...TRACK, cues });
    await waitFor(() => expect(pending.length).toBe(2));
    expect(peak).toBe(2);

    const first = pending.shift()!;
    await act(async () => {
      first.resolve(successResponse(first.request));
    });
    await waitFor(() => expect(pending.length).toBe(2));
    expect(peak).toBe(2);

    while (pending.length > 0) {
      const entry = pending.shift()!;
      await act(async () => {
        entry.resolve(successResponse(entry.request));
      });
    }
    await waitForTranslation('done');
    expect(peak).toBe(2);
  });

  it('resets on SPA navigation, keeps a session on same-video events, and re-acquires', async () => {
    const send = sendMock(defaultSend);
    renderSession();
    await deliverTrack();
    await waitForTranslation('done');
    expect(requestsOf(send, 'earworm:get-cached')).toHaveLength(1);

    // YouTube emits the event for in-page updates too; the live session stays.
    await act(async () => {
      window.dispatchEvent(new Event('yt-navigate-finish'));
    });
    expect(api?.state.status).toBe('ready');
    expect(api?.state.sentences).toHaveLength(2);

    setVideo('vid2');
    await act(async () => {
      window.dispatchEvent(new Event('yt-navigate-finish'));
    });
    expect(api?.state.videoId).toBe('vid2');
    expect(api?.state.status).toBe('acquiring');
    expect(api?.state.sentences).toEqual([]);
    expect(api?.state.translation.state).toBe('idle');

    await deliverTrack({ ...TRACK, videoId: 'vid2' });
    await waitForTranslation('done');
    expect(
      (requestsOf(send, 'earworm:get-cached') as Array<{ videoId: string; cuesHash: string }>).map(
        (request) => request.videoId,
      ),
    ).toEqual(['vid1', 'vid2']);
    // Same cue texts = same cache fingerprint for the new video.
    const hashes = (requestsOf(send, 'earworm:get-cached') as Array<{ cuesHash: string }>).map(
      (request) => request.cuesHash,
    );
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('ignores duplicate tracks for the active video and tears the client down on unmount', async () => {
    const send = sendMock(defaultSend);
    const { root } = renderSession();
    await deliverTrack();
    await waitForTranslation('done');

    await deliverTrack();
    expect(requestsOf(send, 'earworm:get-cached')).toHaveLength(1);
    expect(requestsOf(send, 'earworm:translate-batch')).toHaveLength(1);

    act(() => root.unmount());
    roots = roots.filter((candidate) => candidate !== root);
    expect(seams.stopTranscriptClient).toHaveBeenCalledTimes(1);
  });

  it('recomputes offline spans when the collocation table arrives after the track', async () => {
    let resolveTable: ((entries: CollocationEntry[]) => void) | null = null;
    seams.loadCollocationTable.mockReset().mockImplementation(
      () =>
        new Promise<CollocationEntry[]>((resolve) => {
          resolveTable = resolve;
        }),
    );
    // No table at track time: the first paint has no offline spans yet.
    resetCollocationTable();
    sendMock((request) =>
      request.type === 'earworm:translate-batch'
        ? Promise.resolve({
            ok: true,
            model: 'test-model',
            results: [{ i: 0, zh: '你好。' }],
          } satisfies TranslateBatchResponse)
        : defaultSend(request),
    );

    renderSession();
    await deliverTrack();
    await waitForStatus('ready');
    expect(api?.state.sentences[1]?.cols).toEqual([]);

    const table: CollocationEntry[] = [{ text: 'give up' }];
    setCollocationTable(table);
    await act(async () => {
      resolveTable?.(table);
    });
    await waitFor(() => {
      expect(api?.state.sentences[1]?.cols).toEqual([
        { start: 2, end: 9, text: 'give up', source: 'offline' },
      ]);
    });
  });

  it('tracks the current sentence from the player clock and keeps the previous one in a gap', async () => {
    const cues: CueTrack['cues'] = [
      { start: 0, end: 2, text: 'First one.' },
      { start: 2.5, end: 4.5, text: 'Second one.' },
      { start: 5, end: 7, text: 'Third one.' },
    ];
    renderSession();
    await deliverTrack({ ...TRACK, cues });
    await waitForTranslation('done');

    const video = new FakeVideo();
    video.duration = 100;
    act(() => {
      playerController.attach(video.asVideo());
    });

    act(() => {
      video.advance(2.2);
      video.dispatchEvent(new Event('timeupdate'));
    });
    expect(api?.state.currentIndex).toBe(0); // gap after sentence 0

    act(() => {
      video.advance(4);
      video.dispatchEvent(new Event('timeupdate'));
    });
    expect(api?.state.currentIndex).toBe(1);

    act(() => {
      video.advance(6);
      video.dispatchEvent(new Event('timeupdate'));
    });
    expect(api?.state.currentIndex).toBe(2);

    act(() => {
      video.advance(1);
      video.dispatchEvent(new Event('timeupdate'));
    });
    expect(api?.state.currentIndex).toBe(0);
  });

  it('seeks with playRange and honours the continuous-play setting', async () => {
    const playRange = vi.spyOn(playerController, 'playRange');
    setCollocationTable([{ text: 'give up' }]);
    renderSession();
    await deliverTrack();
    await waitForTranslation('done');

    act(() => {
      api?.seekToSentence(1);
    });
    expect(playRange).toHaveBeenLastCalledWith(2.5, 4.5, { pauseAtEnd: true });
    expect(api?.state.currentIndex).toBe(1);

    await act(async () => {
      api?.setContinuous(true);
    });
    await waitFor(() => {
      expect((readStorage(SETTINGS_STORAGE_KEY) as Settings).playback.continuous).toBe(true);
    });
    await waitFor(() => {
      expect(document.querySelector('[data-continuous]')).toHaveAttribute('data-continuous', '1');
    });

    act(() => {
      api?.seekToSentence(1);
    });
    expect(playRange).toHaveBeenLastCalledWith(2.5, 4.5, { pauseAtEnd: false });
    playRange.mockRestore();
  });

  it('toggleSidebar flips the shared ui.sidebar setting from the live value', async () => {
    renderSession();
    await waitFor(() => {
      expect((readStorage(SETTINGS_STORAGE_KEY) as Settings).ui.sidebar).toBe(true);
    });

    await act(async () => {
      api?.toggleSidebar();
    });
    await waitFor(() => {
      expect((readStorage(SETTINGS_STORAGE_KEY) as Settings).ui.sidebar).toBe(false);
    });

    await act(async () => {
      api?.toggleSidebar();
    });
    await waitFor(() => {
      expect((readStorage(SETTINGS_STORAGE_KEY) as Settings).ui.sidebar).toBe(true);
    });
  });

  it('applies a cache hit with zero translation requests', async () => {
    const cached: CachedTranslation = {
      zh: ['你好。', '我放弃。'],
      cols: [[], [{ text: 'give up', note: '放弃' }]],
      model: 'cached-model',
      ts: 1234,
    };
    const send = sendMock((request) => {
      if (request.type === 'earworm:get-cached') {
        return Promise.resolve({ hit: true, data: cached });
      }
      return defaultSend(request);
    });

    renderSession();
    await deliverTrack();
    await waitForTranslation('done');

    expect(requestsOf(send, 'earworm:translate-batch')).toHaveLength(0);
    expect(requestsOf(send, 'earworm:commit')).toHaveLength(0);
    expect(api?.state.sentences.map((sentence) => sentence.zh)).toEqual(['你好。', '我放弃。']);
    expect(api?.state.sentences.map((sentence) => sentence.status)).toEqual(['done', 'done']);
    // LLM span wins the union with the identical offline span and keeps its note.
    expect(api?.state.sentences[1]?.cols).toEqual([
      { start: 2, end: 9, text: 'give up', source: 'llm', note: '放弃' },
    ]);
  });
});
