import { describe, expect, it, vi } from 'vitest';
import type { CachedTranslation } from '@/lib/contracts';
import {
  createInjectEnvelope,
  createMessageRouter,
  isCuesFailedPayload,
  isCuesReadyPayload,
  isInjectEnvelope,
  isProducePayload,
  isRuntimeRequest,
  postInjectMessage,
  sendRuntimeMessage,
  type TranslateBatchRequest,
} from '@/lib/messages';

const validTranslation: CachedTranslation = {
  zh: ['你好'],
  cols: [[{ text: 'hello', note: '你好' }]],
  model: 'group/free-ds',
  ts: 1,
};

describe('inject window bridge', () => {
  it('creates and validates an envelope', () => {
    const envelope = createInjectEnvelope('content-to-inject', 'earworm:produce', {
      videoId: 'abc',
    });
    expect(envelope).toEqual({
      __earworm: true,
      dir: 'content-to-inject',
      type: 'earworm:produce',
      payload: { videoId: 'abc' },
    });
    expect(isInjectEnvelope(envelope)).toBe(true);
  });

  it('rejects foreign or malformed envelopes', () => {
    expect(isInjectEnvelope(null)).toBe(false);
    expect(isInjectEnvelope({})).toBe(false);
    expect(isInjectEnvelope({ __earworm: false, dir: 'inject-to-content', type: 'x', payload: {} })).toBe(
      false,
    );
    expect(isInjectEnvelope({ __earworm: true, dir: 'sideways', type: 'x', payload: {} })).toBe(
      false,
    );
    expect(isInjectEnvelope({ __earworm: true, dir: 'inject-to-content', type: '', payload: {} })).toBe(
      false,
    );
    expect(isInjectEnvelope({ __earworm: true, dir: 'inject-to-content', type: 'x' })).toBe(false);
  });

  it('posts the envelope with targetOrigin "*"', () => {
    const target = { postMessage: vi.fn() } as unknown as Window;
    postInjectMessage('inject-to-content', 'earworm:cues-ready', { ok: true }, target);
    expect(target.postMessage).toHaveBeenCalledWith(
      {
        __earworm: true,
        dir: 'inject-to-content',
        type: 'earworm:cues-ready',
        payload: { ok: true },
      },
      '*',
    );
  });

  it('validates cue payloads', () => {
    const ready = {
      videoId: 'vid',
      lang: 'en',
      kind: 'manual',
      cues: [{ start: 0, end: 1.25, text: 'hello' }],
    };
    expect(isCuesReadyPayload(ready)).toBe(true);
    expect(isCuesReadyPayload({ ...ready, kind: 'asr' })).toBe(false);
    expect(isCuesReadyPayload({ ...ready, cues: [{ start: 0, end: 1, text: 3 }] })).toBe(false);
    expect(isCuesReadyPayload({ ...ready, cues: [{ start: 0, end: Number.NaN, text: 'x' }] })).toBe(
      false,
    );
    expect(isCuesReadyPayload({ ...ready, videoId: '' })).toBe(false);

    expect(isCuesFailedPayload({ videoId: 'vid', reason: 'timeout' })).toBe(true);
    expect(isCuesFailedPayload({ videoId: 'vid', reason: 'rate-limited' })).toBe(false);
    expect(isProducePayload({ videoId: 'vid' })).toBe(true);
    expect(isProducePayload({ videoId: 'vid', force: true })).toBe(true);
    expect(isProducePayload({ videoId: 'vid', force: 'yes' })).toBe(false);
  });
});

describe('runtime request validation', () => {
  const translateBatch: TranslateBatchRequest = {
    type: 'earworm:translate-batch',
    videoId: 'vid',
    cuesHash: 'hash',
    meta: { videoId: 'vid', title: 'Title', channel: 'Channel' },
    batch: [{ i: 0, text: 'hello', prev: 'before', next: 'after' }],
    batchIndex: 0,
    batchCount: 2,
  };

  it('accepts every supported request shape', () => {
    expect(isRuntimeRequest({ type: 'earworm:get-cached', videoId: 'vid', cuesHash: 'h' })).toBe(
      true,
    );
    expect(isRuntimeRequest(translateBatch)).toBe(true);
    expect(
      isRuntimeRequest({ type: 'earworm:commit', videoId: 'v', cuesHash: 'h', data: validTranslation }),
    ).toBe(true);
    expect(
      isRuntimeRequest({
        type: 'earworm:test-llm',
        llm: { baseUrl: 'http://127.0.0.1:3425/v1', apiKey: '', model: 'group/free-ds' },
      }),
    ).toBe(true);
    expect(isRuntimeRequest({ type: 'earworm:clear-cache' })).toBe(true);
  });

  it('rejects unknown types and malformed payloads', () => {
    expect(isRuntimeRequest({ type: 'earworm:unknown' })).toBe(false);
    expect(isRuntimeRequest(null)).toBe(false);
    expect(isRuntimeRequest({ type: 'earworm:get-cached', videoId: '', cuesHash: 'h' })).toBe(false);
    expect(isRuntimeRequest({ ...translateBatch, batch: [{ i: -1, text: 'x' }] })).toBe(false);
    expect(isRuntimeRequest({ ...translateBatch, batchCount: 1.5 })).toBe(false);
    expect(
      isRuntimeRequest({ type: 'earworm:commit', videoId: 'v', cuesHash: 'h', data: { zh: [] } }),
    ).toBe(false);
    // Same schema as the cache: empty lines and misaligned columns are invalid.
    expect(
      isRuntimeRequest({
        type: 'earworm:commit',
        videoId: 'v',
        cuesHash: 'h',
        data: { ...validTranslation, zh: [''] },
      }),
    ).toBe(false);
    expect(
      isRuntimeRequest({
        type: 'earworm:commit',
        videoId: 'v',
        cuesHash: 'h',
        data: { ...validTranslation, cols: [] },
      }),
    ).toBe(false);
  });

  it('forwards requests through chrome.runtime.sendMessage', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true }));
    (chrome.runtime as unknown as { sendMessage: typeof sendMessage }).sendMessage = sendMessage;
    await expect(sendRuntimeMessage({ type: 'earworm:clear-cache' })).resolves.toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'earworm:clear-cache' });
  });
});

describe('message router', () => {
  it('registers, replaces and unregisters handlers', async () => {
    const router = createMessageRouter();
    expect(router.has('earworm:clear-cache')).toBe(false);
    const first = vi.fn(() => ({ ok: true, from: 'first' }));
    const unregisterFirst = router.register('earworm:clear-cache', first);
    expect(router.has('earworm:clear-cache')).toBe(true);

    const sender = {} as chrome.runtime.MessageSender;
    await expect(router.dispatch({ type: 'earworm:clear-cache' }, sender)).resolves.toEqual({
      ok: true,
      from: 'first',
    });
    expect(first).toHaveBeenCalledWith({ type: 'earworm:clear-cache' }, sender);

    const second = vi.fn(() => ({ ok: true, from: 'second' }));
    const unregisterSecond = router.register('earworm:clear-cache', second);
    await expect(router.dispatch({ type: 'earworm:clear-cache' }, sender)).resolves.toEqual({
      ok: true,
      from: 'second',
    });

    // Unregistering the replaced handler must not remove the current one.
    unregisterFirst();
    expect(router.has('earworm:clear-cache')).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);

    unregisterSecond();
    expect(router.has('earworm:clear-cache')).toBe(false);
  });

  it('ignores foreign messages and reports missing handlers', async () => {
    const router = createMessageRouter();
    await expect(router.dispatch({ foo: 'bar' })).resolves.toBeUndefined();
    await expect(router.dispatch({ type: 'earworm:not-ours' })).resolves.toBeUndefined();
    await expect(router.dispatch({ type: 'earworm:clear-cache' })).resolves.toEqual({
      ok: false,
      error: 'No handler registered for earworm:clear-cache',
    });
  });

  it('turns handler exceptions into an error response', async () => {
    const router = createMessageRouter();
    router.register('earworm:clear-cache', () => {
      throw new Error('boom');
    });
    await expect(router.dispatch({ type: 'earworm:clear-cache' })).resolves.toEqual({
      ok: false,
      error: 'boom',
    });

    router.register('earworm:clear-cache', () => Promise.reject(new Error('async boom')));
    await expect(router.dispatch({ type: 'earworm:clear-cache' })).resolves.toEqual({
      ok: false,
      error: 'async boom',
    });
  });

  it('passes an empty sender when none is supplied', async () => {
    const router = createMessageRouter();
    const handler = vi.fn(() => ({ ok: true }));
    router.register('earworm:clear-cache', handler);
    await router.dispatch({ type: 'earworm:clear-cache' });
    expect(handler).toHaveBeenCalledWith({ type: 'earworm:clear-cache' }, {});
  });
});
