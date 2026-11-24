import { afterEach, describe, expect, it } from 'vitest';
import type { CachedTranslation } from '@/lib/contracts';
import {
  clearTranslationCache,
  commitTranslation,
  getCachedTranslation,
  MAX_CACHE_ENTRIES,
  TRANSLATION_DB_NAME,
  TRANSLATION_STORE,
  translationCacheKey,
} from '@/lib/llm/cache';
import {
  countRecords,
  deleteDatabase,
  getAllRecords,
  openDatabase,
} from '@/lib/db/idb';

function cached(overrides: Partial<CachedTranslation> = {}): CachedTranslation {
  return {
    zh: ['你好'],
    cols: [[{ text: 'hello', note: '你好' }]],
    model: 'group/free-ds',
    ts: 1000,
    ...overrides,
  };
}

async function countEntries(): Promise<number> {
  const db = await openDatabase(TRANSLATION_DB_NAME, 1, [{ name: TRANSLATION_STORE }]);
  try {
    return await countRecords(db, TRANSLATION_STORE);
  } finally {
    db.close();
  }
}

async function allEntries(): Promise<CachedTranslation[]> {
  const db = await openDatabase(TRANSLATION_DB_NAME, 1, [{ name: TRANSLATION_STORE }]);
  try {
    return await getAllRecords<CachedTranslation>(db, TRANSLATION_STORE);
  } finally {
    db.close();
  }
}

afterEach(async () => {
  await deleteDatabase(null, TRANSLATION_DB_NAME);
});

describe('translation cache', () => {
  it('uses the documented key format', () => {
    expect(translationCacheKey('dQw4w9WgXcQ', 'abc123')).toBe('dQw4w9WgXcQ:abc123');
  });

  it('round-trips a committed translation', async () => {
    await commitTranslation('vid', 'hash', cached());
    const hit = await getCachedTranslation('vid', 'hash');
    expect(hit).toMatchObject({
      zh: ['你好'],
      cols: [[{ text: 'hello', note: '你好' }]],
      model: 'group/free-ds',
    });
    expect(hit?.ts).toEqual(expect.any(Number));
  });

  it('returns null for a miss', async () => {
    await expect(getCachedTranslation('vid', 'missing')).resolves.toBeNull();
  });

  it('overwrites the same video + track key', async () => {
    await commitTranslation('vid', 'hash', cached({ zh: ['旧'], ts: 1 }));
    await commitTranslation('vid', 'hash', cached({ zh: ['新'], ts: 2 }));
    await expect(getCachedTranslation('vid', 'hash')).resolves.toMatchObject({ zh: ['新'] });
    expect(await countEntries()).toBe(1);
  });

  it('does not mix keys across videos or track hashes', async () => {
    await commitTranslation('vid-a', 'hash', cached({ zh: ['A'] }));
    await commitTranslation('vid-b', 'hash', cached({ zh: ['B'] }));
    await commitTranslation('vid-a', 'other', cached({ zh: ['C'] }));
    await expect(getCachedTranslation('vid-a', 'hash')).resolves.toMatchObject({ zh: ['A'] });
    await expect(getCachedTranslation('vid-b', 'hash')).resolves.toMatchObject({ zh: ['B'] });
    await expect(getCachedTranslation('vid-a', 'other')).resolves.toMatchObject({ zh: ['C'] });
  });

  it('touches ts on a hit so eviction follows least-recent use', async () => {
    await commitTranslation('vid', 'hash', cached({ ts: 1 }));
    const before = Date.now();
    await getCachedTranslation('vid', 'hash');
    const entries = await allEntries();
    expect(entries[0]?.ts).toBeGreaterThanOrEqual(before);
  });

  it(`keeps at most ${MAX_CACHE_ENTRIES} entries and evicts the least recently used`, async () => {
    for (let index = 1; index <= MAX_CACHE_ENTRIES; index += 1) {
      await commitTranslation(`vid-${index}`, 'h', cached({ ts: index }));
    }
    expect(await countEntries()).toBe(MAX_CACHE_ENTRIES);

    // Touch the oldest entry so it becomes the most recently used.
    await expect(getCachedTranslation('vid-1', 'h')).resolves.toMatchObject({ zh: ['你好'] });

    await commitTranslation('vid-new', 'h', cached({ ts: MAX_CACHE_ENTRIES + 1 }));
    expect(await countEntries()).toBe(MAX_CACHE_ENTRIES);
    await expect(getCachedTranslation('vid-1', 'h')).resolves.not.toBeNull();
    await expect(getCachedTranslation('vid-2', 'h')).resolves.toBeNull();
    await expect(getCachedTranslation('vid-new', 'h')).resolves.not.toBeNull();
  }, 30_000);

  it('rejects malformed committed data', async () => {
    await expect(
      commitTranslation('vid', 'hash', cached({ cols: [] })),
    ).rejects.toThrow(/invalid/i);
    await expect(
      commitTranslation('vid', 'hash', cached({ zh: [''] })),
    ).rejects.toThrow(/invalid/i);
    await expect(
      commitTranslation('vid', 'hash', cached({ model: '' })),
    ).rejects.toThrow(/invalid/i);
    await expect(
      commitTranslation('vid', 'hash', cached({ ts: Number.NaN })),
    ).rejects.toThrow(/invalid/i);
    expect(await countEntries()).toBe(0);
  });

  it('ignores invalid rows already in the database', async () => {
    const db = await openDatabase(TRANSLATION_DB_NAME, 1, [{ name: TRANSLATION_STORE }]);
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(TRANSLATION_STORE, 'readwrite');
        transaction.objectStore(TRANSLATION_STORE).put({ zh: 'not-an-array' }, 'vid:hash');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
    await expect(getCachedTranslation('vid', 'hash')).resolves.toBeNull();
  });

  it('clears every cached translation', async () => {
    await commitTranslation('a', 'h', cached());
    await commitTranslation('b', 'h', cached());
    await clearTranslationCache();
    expect(await countEntries()).toBe(0);
    await expect(getCachedTranslation('a', 'h')).resolves.toBeNull();
  });
});
