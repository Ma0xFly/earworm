import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMessageRouter,
  isRuntimeRequest,
  type FetchDataRequest,
} from '@/lib/messages';
import { registerDataHandlers } from '@/lib/data/assets-handler';
import {
  loadCollocationTable,
  resetCollocationTable,
} from '@/lib/collocations/data';
import { loadDictionary } from '@/lib/dict';
import { installChromeMock } from './mocks/chrome';

afterEach(() => {
  resetCollocationTable();
  vi.unstubAllGlobals();
  installChromeMock();
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function backgroundText(byPath: Record<string, string>) {
  return vi.fn(async (message: unknown) => {
    const path = (message as FetchDataRequest).path;
    const text = byPath[path];
    return text === undefined ? { ok: false, error: 'missing' } : { ok: true, text };
  });
}

describe('fetch-data request contract', () => {
  it('accepts only shipped data/*.json paths', () => {
    expect(
      isRuntimeRequest({ type: 'earworm:fetch-data', path: 'data/ecdict.json' }),
    ).toBe(true);
    expect(isRuntimeRequest({ type: 'earworm:fetch-data', path: 'data/lemmas.json' })).toBe(
      true,
    );
    expect(isRuntimeRequest({ type: 'earworm:fetch-data', path: '../manifest.json' })).toBe(
      false,
    );
    expect(isRuntimeRequest({ type: 'earworm:fetch-data', path: 'data/../secret.json' })).toBe(
      false,
    );
    expect(isRuntimeRequest({ type: 'earworm:fetch-data', path: 'src/entrypoints/a.ts' })).toBe(
      false,
    );
    expect(isRuntimeRequest({ type: 'earworm:fetch-data', path: 'data/ecdict.txt' })).toBe(
      false,
    );
  });

  it('serves the file from the background with the requested path', async () => {
    const router = createMessageRouter();
    const fetchImpl = vi.fn(async () => jsonResponse({ hello: 'world' }));
    registerDataHandlers(router, fetchImpl as unknown as typeof fetch);

    await expect(
      router.dispatch({ type: 'earworm:fetch-data', path: 'data/ecdict.json' }),
    ).resolves.toEqual({ ok: true, text: '{"hello":"world"}' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'chrome-extension://earworm-test/data/ecdict.json',
    );
  });

  it('reports HTTP failures and exceptions without throwing', async () => {
    const router = createMessageRouter();
    registerDataHandlers(
      router,
      vi.fn(async () => new Response('missing', { status: 404 })) as unknown as typeof fetch,
    );
    await expect(
      router.dispatch({ type: 'earworm:fetch-data', path: 'data/lemmas.json' }),
    ).resolves.toEqual({ ok: false, error: 'HTTP 404 for data/lemmas.json' });

    registerDataHandlers(
      router,
      vi.fn(async () => {
        throw new Error('boom');
      }) as unknown as typeof fetch,
    );
    await expect(
      router.dispatch({ type: 'earworm:fetch-data', path: 'data/lemmas.json' }),
    ).resolves.toEqual({ ok: false, error: 'boom' });
  });
});

describe('content-side asset loading', () => {
  it('loads a JSON asset directly when the content fetch works', async () => {
    const sendMessage = vi.fn();
    chrome.runtime.sendMessage = sendMessage as unknown as typeof chrome.runtime.sendMessage;
    const fetchImpl = vi.fn(async () => jsonResponse(['give up']));

    await expect(
      loadCollocationTable({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        url: 'chrome-extension://earworm-test/data/collocations.json',
      }),
    ).resolves.toEqual([{ text: 'give up' }]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('falls back to the background when the content fetch is blocked', async () => {
    const sendMessage = backgroundText({
      'data/collocations.json': JSON.stringify(['give up', 'look up']),
    });
    chrome.runtime.sendMessage = sendMessage as unknown as typeof chrome.runtime.sendMessage;
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Unsafe attempt to load URL from frame');
    });

    await expect(
      loadCollocationTable({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        url: 'chrome-extension://earworm-test/data/collocations.json',
      }),
    ).resolves.toEqual([{ text: 'give up' }, { text: 'look up' }]);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'earworm:fetch-data', path: 'data/collocations.json' }),
    );
  });

  it('loads the dictionary through the background fallback', async () => {
    const ecdict = {
      meta: { schema: 1, version: 'test', count: 1 },
      entries: [['run', '', 'v. 跑', '', '', '']],
    };
    const lemmas = { meta: { schema: 1, version: 'test' }, map: { running: 'run' } };
    const sendMessage = backgroundText({
      'data/ecdict.json': JSON.stringify(ecdict),
      'data/lemmas.json': JSON.stringify(lemmas),
    });
    chrome.runtime.sendMessage = sendMessage as unknown as typeof chrome.runtime.sendMessage;

    const dictionary = await loadDictionary({
      fetchImpl: vi.fn(async () => {
        throw new TypeError('blocked');
      }) as unknown as typeof fetch,
      importToIdb: false,
    });

    expect(dictionary.byWord.get('run')?.translation).toBe('v. 跑');
    expect(dictionary.byLemma.get('running')).toBe('run');
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('keeps the original direct-fetch error when the fallback is unavailable', async () => {
    chrome.runtime.sendMessage = vi.fn(async () => {
      throw new Error('no background');
    }) as unknown as typeof chrome.runtime.sendMessage;

    await expect(
      loadCollocationTable({
        fetchImpl: vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch,
        url: 'chrome-extension://earworm-test/data/collocations.json',
      }),
    ).resolves.toEqual([]);
  });
});
