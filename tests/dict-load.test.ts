import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EcdictFile, LemmaFile } from '@/lib/dict/db';
import {
  DICT_META_STORE,
  DICT_WORDS_STORE,
  openDictDatabase,
} from '@/lib/dict/db';
import { countRecords, deleteDatabase, getRecord } from '@/lib/db/idb';
import {
  decodeEcdictFile,
  decodeLemmaFile,
  dictionaryAssetUrl,
  loadDictionary,
} from '@/lib/dict/import';
import {
  getActiveDictionary,
  lookupWord,
  preloadDictionary,
  resetDictionary,
} from '@/lib/dict/lookup';

const ecdict: EcdictFile = {
  meta: {
    schema: 1,
    version: 'ecdict-load-test',
    count: 3,
    sourceRows: 3,
    tagged: 2,
    withPhonetic: 1,
    withTranslation: 3,
    withPos: 3,
    withExchange: 1,
    topN: 50000,
    maxTranslationChars: 120,
  },
  entries: [
    ['run', 'rʌn', 'v. 跑', 'v.', 'zk', 'i:running'],
    ['running', 'ˈrʌnɪŋ', 'n. 跑步', 'n.', 'gk', '0:run'],
    ['box', '', 'n. 盒子', 'n.', '', 's:boxes'],
  ],
};

const lemmas: LemmaFile = {
  meta: { schema: 1, version: 'lemma-load-test', count: 1, groups: 1 },
  map: { running: 'run' },
};

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mockedFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('ecdict.json')) return jsonResponse(ecdict);
    if (url.endsWith('lemmas.json')) return jsonResponse(lemmas);
    return new Response('not found', { status: 404 });
  });
}

const databaseNames: string[] = [];
let counter = 0;

function nextDatabaseName(): string {
  counter += 1;
  const name = `earworm-dict-load-test-${counter}`;
  databaseNames.push(name);
  return name;
}

afterEach(async () => {
  resetDictionary();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  while (databaseNames.length > 0) {
    const name = databaseNames.pop();
    if (name) await deleteDatabase(null, name);
  }
});

describe('dictionaryAssetUrl', () => {
  it('resolves through chrome.runtime.getURL when available', () => {
    expect(dictionaryAssetUrl('ecdict.json')).toBe(
      'chrome-extension://earworm-test/data/ecdict.json',
    );
  });
});

describe('decodeEcdictFile / decodeLemmaFile', () => {
  it('round-trips a valid payload', () => {
    expect(decodeEcdictFile(JSON.parse(JSON.stringify(ecdict)))).toEqual(ecdict);
    expect(decodeLemmaFile(JSON.parse(JSON.stringify(lemmas)))).toEqual(lemmas);
  });

  it('rejects malformed meta and rows with clear errors', () => {
    expect(() => decodeEcdictFile(null)).toThrow(/expected an object/i);
    expect(() => decodeEcdictFile({ entries: [] })).toThrow(/meta/i);
    expect(() =>
      decodeEcdictFile({ meta: ecdict.meta, entries: [['run']] }),
    ).toThrow(/malformed row/i);
    expect(() => decodeLemmaFile({ meta: lemmas.meta })).toThrow(/map/i);
  });
});

describe('loadDictionary', () => {
  it('fetches both shipped files and builds lookup maps', async () => {
    const fetchImpl = mockedFetch();
    const dictionary = await loadDictionary({ fetchImpl, importToIdb: false });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      'chrome-extension://earworm-test/data/ecdict.json',
      'chrome-extension://earworm-test/data/lemmas.json',
    ]);
    expect(dictionary.byWord.get('run')?.translation).toBe('v. 跑');
    expect(dictionary.byLemma.get('running')).toBe('run');
    expect(dictionary.byForm.get('boxes')).toBe('box');
  });

  it('rejects on HTTP errors and malformed payloads', async () => {
    await expect(
      loadDictionary({
        fetchImpl: vi.fn(async () => new Response('nope', { status: 500 })),
        importToIdb: false,
      }),
    ).rejects.toThrow(/HTTP 500/);

    await expect(
      loadDictionary({
        fetchImpl: vi.fn(async () => jsonResponse({ nonsense: true })),
        importToIdb: false,
      }),
    ).rejects.toThrow(/Invalid/);
  });

  it('schedules the IndexedDB import after returning the memory dictionary', async () => {
    const dbName = nextDatabaseName();
    let scheduled: (() => void) | undefined;
    const dictionary = await loadDictionary({
      fetchImpl: mockedFetch(),
      dbName,
      chunkSize: 2,
      schedule: (task) => {
        scheduled = task;
      },
    });

    expect(dictionary.byWord.size).toBe(3);
    expect(scheduled).toBeTypeOf('function');

    // The import is deliberately not awaited by loadDictionary.
    const before = await openDictDatabase(dbName);
    await expect(countRecords(before, DICT_WORDS_STORE)).resolves.toBe(0);
    before.close();

    scheduled?.();
    await vi.waitFor(async () => {
      const db = await openDictDatabase(dbName);
      try {
        expect(await countRecords(db, DICT_WORDS_STORE)).toBe(3);
        await expect(
          getRecord(db, DICT_META_STORE, 'ecdict'),
        ).resolves.toMatchObject({ version: 'ecdict-load-test', count: 3 });
      } finally {
        db.close();
      }
    });
  });
});

describe('preloadDictionary / lookupWord', () => {
  it('loads once, caches the dictionary and resolves lookups', async () => {
    const fetchImpl = mockedFetch();
    const first = await preloadDictionary({ fetchImpl, importToIdb: false });

    expect(first?.byWord.size).toBe(3);
    expect(getActiveDictionary()).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await expect(lookupWord('running')).resolves.toMatchObject({
      word: 'run',
      matchedForm: 'running',
    });

    await preloadDictionary({ fetchImpl, importToIdb: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('degrades to null instead of throwing when the assets are unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));

    await expect(preloadDictionary({ importToIdb: false })).resolves.toBeNull();
    await expect(lookupWord('running')).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
