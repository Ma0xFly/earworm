import type { CachedTranslation } from '@/lib/contracts';
import {
  clearStore,
  openDatabase,
  requestToPromise,
  withStore,
} from '@/lib/db/idb';

/**
 * Per-video translation cache owned by the background service worker.
 *
 * Layout (architecture §4.2): IndexedDB `earworm-translations`, object store
 * `videos`, out-of-line key `${videoId}:${cuesHash}`, value
 * `{zh, cols, model, ts}`. At most 200 videos are retained; `ts` is both the
 * commit timestamp and the last-access timestamp, so eviction drops the least
 * recently used rows.
 */

export const TRANSLATION_DB_NAME = 'earworm-translations';
export const TRANSLATION_STORE = 'videos';
export const MAX_CACHE_ENTRIES = 200;

const DB_VERSION = 1;

export function translationCacheKey(videoId: string, cuesHash: string): string {
  return `${videoId}:${cuesHash}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural validation shared by commit, read and tests. */
export function isValidCachedTranslation(value: unknown): value is CachedTranslation {
  if (!isRecord(value)) return false;

  const zh = value.zh;
  if (!Array.isArray(zh) || zh.length === 0) return false;
  if (!zh.every((line) => typeof line === 'string' && line.trim().length > 0)) return false;

  const cols = value.cols;
  if (!Array.isArray(cols) || cols.length !== zh.length) return false;
  for (const sentenceCols of cols) {
    if (!Array.isArray(sentenceCols)) return false;
    for (const collocation of sentenceCols) {
      if (!isRecord(collocation)) return false;
      if (typeof collocation.text !== 'string' || collocation.text.length === 0) return false;
      if (collocation.note !== undefined && typeof collocation.note !== 'string') return false;
    }
  }

  return (
    typeof value.model === 'string' &&
    value.model.length > 0 &&
    typeof value.ts === 'number' &&
    Number.isFinite(value.ts) &&
    value.ts >= 0
  );
}

function openTranslationDb(): Promise<IDBDatabase> {
  return openDatabase(TRANSLATION_DB_NAME, DB_VERSION, [{ name: TRANSLATION_STORE }]);
}

async function withTranslationDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openTranslationDb();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

/**
 * Look up one video's translations and mark them as recently used.
 *
 * Returns `null` on a miss or when the stored row no longer matches the
 * schema (treating legacy/garbage rows as misses is cheaper than migrating).
 */
export async function getCachedTranslation(
  videoId: string,
  cuesHash: string,
): Promise<CachedTranslation | null> {
  const key = translationCacheKey(videoId, cuesHash);
  return withTranslationDb((db) =>
    withStore(db, TRANSLATION_STORE, 'readwrite', async (store) => {
      const raw = await requestToPromise<unknown>(store.get(key));
      if (!isValidCachedTranslation(raw)) return null;

      const touched: CachedTranslation = { ...raw, ts: Date.now() };
      await requestToPromise(store.put(touched, key));
      return touched;
    }),
  );
}

function tsOf(value: unknown): number {
  if (!isRecord(value) || typeof value.ts !== 'number' || !Number.isFinite(value.ts)) return 0;
  return value.ts;
}

async function enforceCacheLimit(db: IDBDatabase): Promise<void> {
  await withStore(db, TRANSLATION_STORE, 'readwrite', async (store) => {
    // Issue both reads before awaiting so the transaction stays active.
    const valuesPromise = requestToPromise<unknown[]>(store.getAll());
    const keysPromise = requestToPromise<IDBValidKey[]>(store.getAllKeys());
    const [values, keys] = await Promise.all([valuesPromise, keysPromise]);

    if (values.length <= MAX_CACHE_ENTRIES) return;

    const rows = values.map((value, index) => ({
      key: keys[index] as IDBValidKey,
      ts: tsOf(value),
    }));
    rows.sort((a, b) => a.ts - b.ts);

    const excess = rows.slice(0, rows.length - MAX_CACHE_ENTRIES);
    await Promise.all(
      excess.map((row) => requestToPromise(store.delete(row.key))),
    );
  });
}

/**
 * Persist a fully successful video translation and evict the least recently
 * used rows beyond the 200-video cap.
 */
export async function commitTranslation(
  videoId: string,
  cuesHash: string,
  data: CachedTranslation,
): Promise<void> {
  if (!isValidCachedTranslation(data)) {
    throw new Error('Invalid translation cache entry');
  }

  const key = translationCacheKey(videoId, cuesHash);
  await withTranslationDb(async (db) => {
    await withStore(db, TRANSLATION_STORE, 'readwrite', (store) =>
      requestToPromise(store.put({ ...data }, key)),
    );
    await enforceCacheLimit(db);
  });
}

/** Drop every cached video translation (options page "clear cache"). */
export async function clearTranslationCache(): Promise<void> {
  await withTranslationDb((db) => clearStore(db, TRANSLATION_STORE));
}
