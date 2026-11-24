import { describe, expect, it, vi } from 'vitest';
import type { TranslateBatchResponse, TranslateBatchItem } from '@/lib/messages';
import {
  BATCH_TIMEOUT_MS,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  MIN_BATCH_SIZE,
  chunkBatchItems,
  normalizeBatchSize,
  translateBatch,
} from '@/lib/llm/batch';
import type { FetchLike } from '@/lib/llm/client';
import {
  chatResponse,
  GOOD_CONTENT,
  TEST_BATCH,
  TEST_LLM_SETTINGS,
  TEST_META,
} from './fixtures/llm';

function asFetch(...responses: Array<Response | Error>): {
  fetchImpl: FetchLike;
  mock: ReturnType<typeof vi.fn>;
} {
  const mock = vi.fn(async () => {
    const next = responses.shift();
    if (next === undefined) throw new Error('unexpected extra fetch');
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetchImpl: mock as unknown as FetchLike, mock };
}

function makeItems(count: number): TranslateBatchItem[] {
  return Array.from({ length: count }, (_, index) => ({
    i: index,
    text: `Sentence number ${index}.`,
  }));
}

describe('batch sizing', () => {
  it('uses 40 by default and clamps the configurable size to 30-50', () => {
    expect(DEFAULT_BATCH_SIZE).toBe(40);
    expect(MIN_BATCH_SIZE).toBe(30);
    expect(MAX_BATCH_SIZE).toBe(50);
    expect(BATCH_TIMEOUT_MS).toBe(120_000);
    expect(normalizeBatchSize(undefined)).toBe(40);
    expect(normalizeBatchSize(10)).toBe(30);
    expect(normalizeBatchSize(45)).toBe(45);
    expect(normalizeBatchSize(99)).toBe(50);
    expect(normalizeBatchSize(Number.NaN)).toBe(40);
  });

  it('chunks items into consecutive batches', () => {
    expect(chunkBatchItems(makeItems(95))).toHaveLength(3);
    expect(chunkBatchItems(makeItems(95)).map((batch) => batch.length)).toEqual([40, 40, 15]);
    expect(chunkBatchItems(makeItems(95), 45).map((batch) => batch.length)).toEqual([45, 45, 5]);
    expect(chunkBatchItems(makeItems(7), 3).map((batch) => batch.length)).toEqual([7]);
    expect(chunkBatchItems([])).toEqual([]);
  });
});

describe('batch translation', () => {
  it('translates one batch in a single request and returns the served model', async () => {
    const { fetchImpl, mock } = asFetch(chatResponse(GOOD_CONTENT));
    const response = await translateBatch({
      meta: TEST_META,
      items: TEST_BATCH,
      settings: TEST_LLM_SETTINGS,
      fetchImpl,
    });

    expect(mock).toHaveBeenCalledTimes(1);
    const callBody = JSON.parse(String((mock.mock.calls[0]?.[1] as RequestInit).body)) as {
      model: string;
    };
    expect(callBody.model).toBe('group/free-ds');
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.results).toHaveLength(2);
    expect(response.results[0]?.zh).toContain('一开始');
    expect(response.results[0]?.cols?.[0]?.text).toBe('figure out');
    expect(response.model).toBe('group/free-ds');
  });

  it('retries once after a network failure', async () => {
    const { fetchImpl, mock } = asFetch(new TypeError('fetch failed'), chatResponse(GOOD_CONTENT));
    const response = await translateBatch({
      meta: TEST_META,
      items: TEST_BATCH,
      settings: TEST_LLM_SETTINGS,
      fetchImpl,
    });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(response.ok).toBe(true);
  });

  it('retries once after a 5xx response', async () => {
    const { fetchImpl, mock } = asFetch(
      new Response('upstream down', { status: 502 }),
      chatResponse(GOOD_CONTENT),
    );
    const response = await translateBatch({
      meta: TEST_META,
      items: TEST_BATCH,
      settings: TEST_LLM_SETTINGS,
      fetchImpl,
    });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(response.ok).toBe(true);
  });

  it('retries once after an unparseable answer', async () => {
    const { fetchImpl, mock } = asFetch(
      chatResponse('this is not JSON at all'),
      chatResponse(GOOD_CONTENT),
    );
    const response = await translateBatch({
      meta: TEST_META,
      items: TEST_BATCH,
      settings: TEST_LLM_SETTINGS,
      fetchImpl,
    });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(response.ok).toBe(true);
  });

  it('retries once when the model answers with reasoning only', async () => {
    const { fetchImpl, mock } = asFetch(
      chatResponse('', { reasoning: 'thinking hard' }),
      chatResponse(GOOD_CONTENT),
    );
    const response = await translateBatch({
      meta: TEST_META,
      items: TEST_BATCH,
      settings: TEST_LLM_SETTINGS,
      fetchImpl,
    });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(response.ok).toBe(true);
  });

  it('retries once after a timeout, then succeeds', async () => {
    let calls = 0;
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      }
      return chatResponse(GOOD_CONTENT);
    });

    const response = await translateBatch({
      meta: TEST_META,
      items: TEST_BATCH,
      settings: TEST_LLM_SETTINGS,
      fetchImpl: mock as unknown as FetchLike,
      timeoutMs: 10,
    });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(response.ok).toBe(true);
  });

  it('gives up after one retry and returns ok:false', async () => {
    const { fetchImpl, mock } = asFetch(
      new Response('down', { status: 500 }),
      new Response('still down', { status: 500 }),
    );
    const response = await translateBatch({
      meta: TEST_META,
      items: TEST_BATCH,
      settings: TEST_LLM_SETTINGS,
      fetchImpl,
    });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(response).toMatchObject({ ok: false });
    if (response.ok) return;
    expect(response.error).toMatch(/500/);
  });

  it('does not retry terminal 4xx errors', async () => {
    const { fetchImpl, mock } = asFetch(new Response('bad request', { status: 400 }));
    const response = await translateBatch({
      meta: TEST_META,
      items: TEST_BATCH,
      settings: TEST_LLM_SETTINGS,
      fetchImpl,
    });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject({ ok: false });
    if (response.ok) return;
    expect(response.error).toMatch(/400/);
  });

  it('rejects an oversized batch without calling the model', async () => {
    const { fetchImpl, mock } = asFetch(chatResponse(GOOD_CONTENT));
    const response: TranslateBatchResponse = await translateBatch({
      meta: TEST_META,
      items: makeItems(MAX_BATCH_SIZE + 1),
      settings: TEST_LLM_SETTINGS,
      fetchImpl,
    });
    expect(mock).not.toHaveBeenCalled();
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toMatch(/50/);
  });

  it('returns an empty success for an empty batch', async () => {
    const { fetchImpl, mock } = asFetch(chatResponse('[]'));
    const response = await translateBatch({
      meta: TEST_META,
      items: [],
      settings: TEST_LLM_SETTINGS,
      fetchImpl,
    });
    expect(mock).not.toHaveBeenCalled();
    expect(response).toEqual({ ok: true, results: [], model: TEST_LLM_SETTINGS.model });
  });
});
