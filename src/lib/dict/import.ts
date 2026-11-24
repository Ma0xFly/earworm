/**
 * Runtime loading and IndexedDB import for the offline dictionary.
 *
 * Startup split (measured on the real data):
 * - fetch + JSON.parse of `ecdict.json` + `lemmas.json` is ~90 ms, cheap enough
 *   to await on the first lookup;
 * - writing 50k entries to IndexedDB takes ~5 s, so it must never block the
 *   first subtitle render. `loadDictionary` returns the in-memory dictionary
 *   immediately and streams the IDB import in the background.
 */

import type { WordEntry } from '@/lib/contracts';
import { fetchExtensionJson } from '@/lib/data-assets';
import { normalizeWord } from '@/lib/text/tokenize';
import {
  clearStore,
  deleteRecord,
  getRecord,
  openDatabase,
  putRecord,
  withStore,
} from '@/lib/db/idb';
import {
  DICT_META_KEY,
  DICT_META_STORE,
  DICT_PROGRESS_KEY,
  DICT_WORDS_STORE,
  openDictDatabase,
  type DictMetaRecord,
  type DictProgressRecord,
  type DictRow,
  type EcdictFile,
  type EcdictMeta,
  type LemmaFile,
  type LemmaMeta,
  type StoredWord,
} from './db';
import { buildExchangeIndex } from './lemma';
import { isPlainRecord as isRecord } from '@/lib/utils/is-record';

/** Fully parsed dictionary: headwords, lemma reverse map and exchange forms. */
export type Dictionary = {
  meta: EcdictMeta;
  lemmaMeta: LemmaMeta;
  /** lowercase word -> entry */
  byWord: Map<string, WordEntry>;
  /** lowercase inflected form -> lowercase lemma headword */
  byLemma: Map<string, string>;
  /** lowercase inflected form -> lowercase headword (ECDICT exchange) */
  byForm: Map<string, string>;
};

export type ImportProgress = {
  phase: 'idb';
  /** Entries committed so far. */
  loaded: number;
  total: number;
};

export type ImportResult = {
  skipped: boolean;
  /** Entries written by this call (0 when `skipped`). */
  imported: number;
  /** Index this run resumed from (0 for a fresh import). */
  resumedFrom: number;
  total: number;
};

export type ImportDictionaryOptions = {
  db?: IDBDatabase;
  /** Alternate database name, used by tests. */
  dbName?: string;
  /** Rows per readwrite transaction (2k–5k keeps IDB commits short). */
  chunkSize?: number;
  onProgress?: (progress: ImportProgress) => void;
};

export type LoadDictionaryOptions = {
  fetchImpl?: typeof fetch;
  ecdictUrl?: string;
  lemmaUrl?: string;
  /** Set false to keep IndexedDB untouched (tests/options). */
  importToIdb?: boolean;
  /** Alternate database name for the background import (tests). */
  dbName?: string;
  chunkSize?: number;
  onImportProgress?: (progress: ImportProgress) => void;
  /** Override the idle scheduler (tests/playground). */
  schedule?: (task: () => void) => void;
};

/** URL of a shipped data file, resolved through the extension runtime. */
export function dictionaryAssetUrl(file: string): string {
  const runtime = globalThis.chrome?.runtime;
  return runtime?.getURL ? runtime.getURL(`data/${file}`) : `data/${file}`;
}

/** Convert a compact JSON row to the shared `WordEntry` contract. */
export function rowToEntry(row: DictRow): WordEntry {
  const [word, phonetic, translation, pos, tag, exchange] = row;
  const entry: WordEntry = {
    word,
    translation,
    tags: tag.length > 0 ? tag.split(/\s+/).filter(Boolean) : [],
  };
  if (phonetic) entry.phonetic = phonetic;
  if (pos) entry.pos = pos;
  if (exchange) entry.exchange = exchange;
  return entry;
}

/** Build the in-memory indexes used by lookup and `lemmatize`. */
export function createDictionary(ecdict: EcdictFile, lemmas: LemmaFile): Dictionary {
  const byWord = new Map<string, WordEntry>();
  for (const row of ecdict.entries) {
    const entry = rowToEntry(row);
    const key = normalizeWord(entry.word);
    if (!key) continue;
    byWord.set(key, entry);
  }

  const byForm = buildExchangeIndex(
    ecdict.entries.map((row) => [row[0], row[5]] as const),
  );

  const byLemma = new Map<string, string>();
  for (const [form, lemma] of Object.entries(lemmas.map)) {
    const surface = normalizeWord(form);
    const headword = normalizeWord(lemma);
    if (!surface || !headword || surface === headword) continue;
    if (!byWord.has(headword)) continue;
    byLemma.set(surface, headword);
  }

  return { meta: ecdict.meta, lemmaMeta: lemmas.meta, byWord, byLemma, byForm };
}

function assertEcdictMeta(value: unknown): asserts value is EcdictMeta {
  if (!isRecord(value) || value.schema !== 1 || typeof value.version !== 'string') {
    throw new Error('Invalid ECDICT data: malformed meta');
  }
  if (typeof value.count !== 'number' || value.count < 0) {
    throw new Error('Invalid ECDICT data: malformed count');
  }
}

function assertLemmaMeta(value: unknown): asserts value is LemmaMeta {
  if (!isRecord(value) || value.schema !== 1 || typeof value.version !== 'string') {
    throw new Error('Invalid lemma data: malformed meta');
  }
}

/** Validate the fetched `ecdict.json` payload. */
export function decodeEcdictFile(payload: unknown): EcdictFile {
  if (!isRecord(payload)) throw new Error('Invalid ECDICT data: expected an object');
  assertEcdictMeta(payload.meta);
  if (!Array.isArray(payload.entries)) {
    throw new Error('Invalid ECDICT data: missing entries array');
  }
  const entries = payload.entries.map((row, index) => {
    if (!Array.isArray(row) || row.length < 6 || typeof row[0] !== 'string') {
      throw new Error(`Invalid ECDICT data: malformed row ${index}`);
    }
    return [row[0], row[1], row[2], row[3], row[4], row[5]].map((value) =>
      typeof value === 'string' ? value : '',
    ) as DictRow;
  });
  return { meta: payload.meta, entries };
}

/** Validate the fetched `lemmas.json` payload. */
export function decodeLemmaFile(payload: unknown): LemmaFile {
  if (!isRecord(payload)) throw new Error('Invalid lemma data: expected an object');
  assertLemmaMeta(payload.meta);
  if (!isRecord(payload.map)) throw new Error('Invalid lemma data: missing map');
  const map: Record<string, string> = {};
  for (const [form, lemma] of Object.entries(payload.map)) {
    if (typeof lemma === 'string') map[form] = lemma;
  }
  return { meta: payload.meta, map };
}

function toStoredWord(row: DictRow): StoredWord {
  const entry = rowToEntry(row);
  const stored: StoredWord = { word: entry.word, translation: entry.translation, tags: entry.tags };
  if (entry.phonetic) stored.phonetic = entry.phonetic;
  if (entry.pos) stored.pos = entry.pos;
  if (entry.exchange) stored.exchange = entry.exchange;
  const tag = row[4];
  if (tag) stored.tag = tag;
  return stored;
}

/** Write one chunk in a single readwrite transaction (committed on return). */
function writeChunk(
  db: IDBDatabase,
  rows: DictRow[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(DICT_WORDS_STORE, 'readwrite');
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Dictionary chunk transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Dictionary chunk transaction aborted'));
    try {
      const store = transaction.objectStore(DICT_WORDS_STORE);
      for (const row of rows) store.put(toStoredWord(row));
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // Already finished.
      }
      reject(error);
    }
  });
}

/**
 * Import dictionary rows into IndexedDB, idempotently.
 *
 * - a completed import with the same content version and count is a no-op;
 * - progress is recorded after every committed chunk, so an interrupted import
 *   resumes at the next chunk instead of starting over;
 * - a different version clears the store and restarts.
 */
export async function importDictionaryToIdb(
  ecdict: EcdictFile,
  options: ImportDictionaryOptions = {},
): Promise<ImportResult> {
  const database = options.db ?? (await openDictDatabase(options.dbName));
  const ownsDatabase = options.db === undefined;
  const { entries, meta } = ecdict;
  const total = entries.length;
  const chunkSize = Math.max(1, options.chunkSize ?? 4000);

  try {
    const existing = await getRecord<DictMetaRecord>(database, DICT_META_STORE, DICT_META_KEY);
    if (existing?.version === meta.version && existing.count === total) {
      return { skipped: true, imported: 0, resumedFrom: 0, total };
    }

    const progress = await getRecord<DictProgressRecord>(
      database,
      DICT_META_STORE,
      DICT_PROGRESS_KEY,
    );
    const canResume =
      progress !== undefined &&
      progress.version === meta.version &&
      progress.nextIndex > 0 &&
      progress.nextIndex <= total;

    let start = 0;
    if (canResume) {
      start = progress.nextIndex;
    } else {
      await clearStore(database, DICT_WORDS_STORE);
      await deleteRecord(database, DICT_META_STORE, DICT_PROGRESS_KEY);
      await deleteRecord(database, DICT_META_STORE, DICT_META_KEY);
    }

    let imported = 0;
    for (let index = start; index < total; index += chunkSize) {
      const chunk = entries.slice(index, index + chunkSize);
      await writeChunk(database, chunk);
      imported += chunk.length;
      const nextIndex = index + chunk.length;
      await putRecord(database, DICT_META_STORE, {
        key: DICT_PROGRESS_KEY,
        version: meta.version,
        nextIndex,
      });
      options.onProgress?.({ phase: 'idb', loaded: nextIndex, total });
    }

    const record: DictMetaRecord = {
      key: DICT_META_KEY,
      version: meta.version,
      count: total,
      importedAt: Date.now(),
    };
    await putRecord(database, DICT_META_STORE, record);
    await deleteRecord(database, DICT_META_STORE, DICT_PROGRESS_KEY);

    return { skipped: false, imported, resumedFrom: start, total };
  } finally {
    if (ownsDatabase) database.close();
  }
}

function scheduleIdle(task: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => task(), { timeout: 3000 });
    return;
  }
  setTimeout(task, 0);
}

/**
 * Fetch and parse both data files, build the in-memory dictionary, then hand the
 * slow IndexedDB import to an idle callback. Never blocks on the import.
 */
export async function loadDictionary(
  options: LoadDictionaryOptions = {},
): Promise<Dictionary> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable; cannot load the offline dictionary');
  }

  const ecdictUrl = options.ecdictUrl ?? dictionaryAssetUrl('ecdict.json');
  const lemmaUrl = options.lemmaUrl ?? dictionaryAssetUrl('lemmas.json');
  const [ecdictPayload, lemmaPayload] = await Promise.all([
    fetchExtensionJson('data/ecdict.json', fetchImpl, ecdictUrl),
    fetchExtensionJson('data/lemmas.json', fetchImpl, lemmaUrl),
  ]);
  const ecdict = decodeEcdictFile(ecdictPayload);
  const lemmas = decodeLemmaFile(lemmaPayload);
  const dictionary = createDictionary(ecdict, lemmas);

  if (options.importToIdb !== false) {
    const schedule = options.schedule ?? scheduleIdle;
    schedule(() => {
      void importDictionaryToIdb(ecdict, {
        dbName: options.dbName,
        chunkSize: options.chunkSize,
        onProgress: options.onImportProgress,
      }).catch((error: unknown) => {
        console.warn('[earworm] dictionary IndexedDB import failed:', error);
      });
    });
  }

  return dictionary;
}

// Re-exported so callers that open the database themselves can use the same
// versioned schema as the importer.
export { openDatabase, openDictDatabase };
