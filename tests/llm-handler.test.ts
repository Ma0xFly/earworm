import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ClearCacheResponse,
  CommitResponse,
  GetCachedResponse,
  TestLlmResponse,
  TranslateBatchRequest,
  TranslateBatchResponse,
} from '@/lib/messages';
import { createMessageRouter } from '@/lib/messages';
import { registerTranslationHandlers } from '@/lib/llm/translate-handler';
import { TRANSLATION_DB_NAME } from '@/lib/llm/cache';
import { deleteDatabase } from '@/lib/db/idb';
import { SETTINGS_STORAGE_KEY } from '@/lib/settings';
import { seedStorage } from './mocks/chrome';
import {
  chatResponse,
  GOOD_CONTENT,
  TEST_BATCH,
  TEST_LLM_SETTINGS,
  TEST_META,
} from './fixtures/llm';

let router = createMessageRouter();
let fetchMock: ReturnType<typeof vi.fn>;

function batchRequest(
  overrides: Partial<TranslateBatchRequest> = {},
): TranslateBatchRequest {
  return {
    type: 'earworm:translate-batch',
    videoId: TEST_META.videoId,
    cuesHash: 'cues-hash',
    meta: TEST_META,
    batch: TEST_BATCH,
    batchIndex: 0,
    batchCount: 1,
    ...overrides,
  };
}

function commitData(
  results: Array<{ zh?: string; cols?: Array<{ text: string; note?: string }> }>,
) {
  return {
    zh: results.map((result) => result.zh ?? ''),
    cols: results.map((result) => result.cols ?? []),
    model: 'group/free-ds',
    ts: 1,
  };
}

async function translateRoundTrip(): Promise<TranslateBatchResponse> {
  const response = (await router.dispatch(batchRequest())) as TranslateBatchResponse;
  return response;
}

beforeEach(() => {
  router = createMessageRouter();
  registerTranslationHandlers(router);
  fetchMock = vi.fn(async () => chatResponse(GOOD_CONTENT));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await deleteDatabase(null, TRANSLATION_DB_NAME);
});

describe('background translation handlers', () => {
  it('registers every runtime translation message', () => {
    expect(router.has('earworm:get-cached')).toBe(true);
    expect(router.has('earworm:translate-batch')).toBe(true);
    expect(router.has('earworm:commit')).toBe(true);
    expect(router.has('earworm:test-llm')).toBe(true);
    expect(router.has('earworm:clear-cache')).toBe(true);
  });

  it('returns a miss without touching the network', async () => {
    const response = (await router.dispatch({
      type: 'earworm:get-cached',
      videoId: 'vid',
      cuesHash: 'hash',
    })) as GetCachedResponse;
    expect(response).toEqual({ hit: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('translates a batch with the model and endpoint from settings', async () => {
    seedStorage(SETTINGS_STORAGE_KEY, {
      version: 1,
      llm: {
        baseUrl: 'http://127.0.0.1:9999/v1',
        apiKey: 'local-key',
        model: 'group/custom-model',
      },
    });

    const response = await translateRoundTrip();
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.results).toHaveLength(2);
    expect(response.results.map((result) => result.i)).toEqual([12, 13]);
    expect(response.results[0]?.zh).toContain('一开始');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:9999/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer local-key');
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'group/custom-model' });
  });

  it('returns ok:false (not a throw) when every attempt fails', async () => {
    fetchMock.mockResolvedValue(new Response('upstream down', { status: 500 }));
    const response = (await router.dispatch(batchRequest())) as TranslateBatchResponse;
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toMatch(/500/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves a cached video without a second fetch (second open = zero network)', async () => {
    const miss = (await router.dispatch({
      type: 'earworm:get-cached',
      videoId: TEST_META.videoId,
      cuesHash: 'cues-hash',
    })) as GetCachedResponse;
    expect(miss).toEqual({ hit: false });

    const translated = await translateRoundTrip();
    expect(translated.ok).toBe(true);
    if (!translated.ok) return;

    const commit = (await router.dispatch({
      type: 'earworm:commit',
      videoId: TEST_META.videoId,
      cuesHash: 'cues-hash',
      data: commitData(translated.results),
    })) as CommitResponse;
    expect(commit.ok).toBe(true);

    const hit = (await router.dispatch({
      type: 'earworm:get-cached',
      videoId: TEST_META.videoId,
      cuesHash: 'cues-hash',
    })) as GetCachedResponse;
    expect(hit.hit).toBe(true);
    if (hit.hit) {
      expect(hit.data.zh).toHaveLength(2);
      expect(hit.data.cols[0]?.[0]?.text).toBe('figure out');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops malformed commit data before the handler and never caches it', async () => {
    // The shared cache validator runs in the message router: misaligned
    // columns and empty Chinese lines are not even dispatched.
    await expect(
      router.dispatch({
        type: 'earworm:commit',
        videoId: 'vid',
        cuesHash: 'hash',
        data: { zh: ['one'], cols: [], model: 'm', ts: 1 },
      }),
    ).resolves.toBeUndefined();

    // A partial run (one sentence without zh) must never enter the cache.
    await expect(
      router.dispatch({
        type: 'earworm:commit',
        videoId: 'vid',
        cuesHash: 'hash',
        data: { zh: ['one', ''], cols: [[], []], model: 'm', ts: 1 },
      }),
    ).resolves.toBeUndefined();

    await expect(
      router.dispatch({ type: 'earworm:get-cached', videoId: 'vid', cuesHash: 'hash' }),
    ).resolves.toEqual({ hit: false });
  });

  it('clears the translation cache', async () => {
    const translated = await translateRoundTrip();
    expect(translated.ok).toBe(true);
    if (!translated.ok) return;
    await router.dispatch({
      type: 'earworm:commit',
      videoId: TEST_META.videoId,
      cuesHash: 'cues-hash',
      data: commitData(translated.results),
    });

    const cleared = (await router.dispatch({ type: 'earworm:clear-cache' })) as ClearCacheResponse;
    expect(cleared).toEqual({ ok: true });

    const miss = (await router.dispatch({
      type: 'earworm:get-cached',
      videoId: TEST_META.videoId,
      cuesHash: 'cues-hash',
    })) as GetCachedResponse;
    expect(miss).toEqual({ hit: false });
  });

  it('test-llm uses the provided settings and truncates the sample', async () => {
    const longContent = '这是一个用于测试连接返回内容的示例。'.repeat(40);
    fetchMock.mockResolvedValue(chatResponse(longContent, { model: 'custom-served' }));

    const response = (await router.dispatch({
      type: 'earworm:test-llm',
      llm: {
        baseUrl: 'https://api.example.com/v1',
        apiKey: '',
        model: 'my-model',
      },
    })) as TestLlmResponse;

    expect(response.ok).toBe(true);
    expect(response.sample).toBeDefined();
    expect(response.sample!.length).toBeLessThanOrEqual(240);
    expect(response.sample!.endsWith('…')).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'my-model',
      reasoning_effort: 'none',
      max_tokens: 8000,
    });
  });

  it('test-llm reports failures as ok:false', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));
    const response = (await router.dispatch({
      type: 'earworm:test-llm',
      llm: TEST_LLM_SETTINGS,
    })) as TestLlmResponse;
    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/connection refused/i);
  });

  it('ignores reasoning_content once content is present', async () => {
    fetchMock.mockResolvedValue(
      chatResponse(GOOD_CONTENT, { reasoning: 'private chain of thought' }),
    );
    const response = await translateRoundTrip();
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(JSON.stringify(response)).not.toContain('private chain of thought');
  });
});
