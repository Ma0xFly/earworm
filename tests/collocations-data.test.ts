import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Sentence } from '@/lib/contracts';
import {
  computeOfflineSpans,
  decodeCollocationFile,
  getCollocationMeta,
  loadCollocationTable,
  resetCollocationTable,
  setCollocationTable,
} from '@/lib/collocations/data';
import {
  createDictionary,
  resetDictionary,
  setActiveDictionary,
  type EcdictFile,
  type LemmaFile,
} from '@/lib/dict';

const FILE = {
  meta: {
    schema: 1,
    version: 'collocations-test',
    count: 2,
    source: 'opensubs-collocations',
    sourceUrl: 'https://example.test/opensubs',
    license: 'CC-BY-4.0',
    attribution: 'OpenSubtitles — Lison & Tiedemann 2016',
    filter: 'npmi >= 0.35 or count >= 1000',
    sourceRows: 10,
    cleanedRows: 8,
    filteredRows: 2,
    rejected: { nonAscii: 1, digit: 1, markup: 0 },
  },
  bigrams: ['give up', 'run out'],
};

function response(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload,
  } as unknown as Response;
}

function sentence(text: string): Sentence {
  return { id: 0, start: 0, end: 1, text, cueStart: 0, cueEnd: 0 };
}

function withoutChrome<T>(run: () => T): T {
  const saved = (globalThis as { chrome?: typeof chrome }).chrome;
  Reflect.deleteProperty(globalThis, 'chrome');
  try {
    return run();
  } finally {
    if (saved) {
      Object.defineProperty(globalThis, 'chrome', {
        configurable: true,
        writable: true,
        value: saved,
      });
    }
  }
}

afterEach(() => {
  resetCollocationTable();
  resetDictionary();
});

describe('decodeCollocationFile', () => {
  it('decodes the shipped object shape and keeps meta', () => {
    const decoded = decodeCollocationFile(FILE);
    expect(decoded.meta).toEqual(FILE.meta);
    expect(decoded.entries).toEqual([{ text: 'give up' }, { text: 'run out' }]);
  });

  it('accepts a bare string array as a legacy/fixture shape', () => {
    expect(decodeCollocationFile(['give up', ' run out ', '', 'give up'])).toEqual({
      entries: [{ text: 'give up' }, { text: 'run out' }],
      meta: null,
    });
  });

  it('rejects malformed payloads', () => {
    expect(() => decodeCollocationFile({ nope: true })).toThrow(/bigrams/i);
    expect(() => decodeCollocationFile('give up')).toThrow(/array or object/i);
  });
});

describe('loadCollocationTable', () => {
  it('fetches the extension asset, decodes it and caches the singleton', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(FILE));
    const first = await loadCollocationTable({ fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'chrome-extension://earworm-test/data/collocations.json',
    );
    expect(first).toEqual([{ text: 'give up' }, { text: 'run out' }]);
    expect(getCollocationMeta()?.count).toBe(2);

    const second = await loadCollocationTable({ fetchImpl });
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('degrades to an empty table when chrome is unavailable', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(FILE));
    const entries = await withoutChrome(() => loadCollocationTable({ fetchImpl }));
    expect(entries).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getCollocationMeta()).toBeNull();
  });

  it('degrades to an empty table on HTTP or decode errors and retries later', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = vi.fn<typeof fetch>(async () => response(null, false, 404));
    expect(await loadCollocationTable({ fetchImpl: failing })).toEqual([]);

    const working = vi.fn<typeof fetch>(async () => response(FILE));
    expect(await loadCollocationTable({ fetchImpl: working })).toHaveLength(2);
    expect(failing).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('computeOfflineSpans', () => {
  it('returns empty until a table is loaded and matches after injection', () => {
    const text = 'Never Give Up last year.';
    expect(computeOfflineSpans(sentence(text))).toEqual([]);

    setCollocationTable([{ text: 'give up' }, { text: 'last year' }]);
    expect(computeOfflineSpans(sentence(text))).toEqual([
      { start: 6, end: 13, text: 'Give Up', source: 'offline' },
      { start: 14, end: 23, text: 'last year', source: 'offline' },
    ]);

    resetCollocationTable();
    expect(computeOfflineSpans(sentence(text))).toEqual([]);
  });

  it('rebuilds its lemma index when the active dictionary changes', () => {
    const text = 'She gave up.';
    setCollocationTable([{ text: 'give up' }]);

    // No dictionary: `gave` cannot be reduced, so nothing matches.
    expect(computeOfflineSpans(sentence(text))).toEqual([]);

    const ecdict: EcdictFile = {
      meta: {
        schema: 1,
        version: 'ecdict-test',
        count: 1,
        sourceRows: 1,
        tagged: 0,
        withPhonetic: 0,
        withTranslation: 1,
        withPos: 1,
        withExchange: 1,
        topN: 1,
        maxTranslationChars: 120,
      },
      entries: [['give', '', '给', 'v.', '', 'p:gave/i:giving']],
    };
    const lemmas: LemmaFile = {
      meta: { schema: 1, version: 'lemma-test', count: 1, groups: 1 },
      map: { gave: 'give' },
    };
    setActiveDictionary(createDictionary(ecdict, lemmas));

    expect(computeOfflineSpans(sentence(text))).toEqual([
      { start: 4, end: 11, text: 'gave up', source: 'offline' },
    ]);
  });
});
