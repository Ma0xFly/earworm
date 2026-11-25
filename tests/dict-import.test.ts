import { afterEach, describe, expect, it } from 'vitest';
import {
  DICT_META_KEY,
  DICT_META_STORE,
  DICT_PROGRESS_KEY,
  DICT_WORDS_STORE,
  type DictMetaRecord,
  type DictProgressRecord,
  type DictRow,
  type EcdictFile,
} from '@/lib/dict/db';
import { importDictionaryToIdb, type ImportProgress } from '@/lib/dict/import';
import {
  countRecords,
  deleteDatabase,
  getRecord,
  openDatabase,
  putRecord,
} from '@/lib/db/idb';

const rows: DictRow[] = [
  ['run', 'rʌn', 'v. 跑', 'v.', 'zk', 'i:running'],
  ['running', 'ˈrʌnɪŋ', 'n. 跑步', 'n.', 'gk', '0:run'],
  ['have', 'hæv', 'v. 有', 'v.', 'zk', '3:has'],
  ['box', 'bɒks', 'n. 盒子', 'n.', '', 's:boxes'],
  ['they', '', 'pron. 他们', 'pron.', 'zk', ''],
];

function makeEcdict(version = 'ecdict-v1', entries: DictRow[] = rows): EcdictFile {
  return {
    meta: {
      schema: 1,
      version,
      count: entries.length,
      sourceRows: entries.length,
      tagged: entries.filter((entry) => entry[4]).length,
      withPhonetic: entries.filter((entry) => entry[1]).length,
      withTranslation: entries.length,
      withPos: entries.filter((entry) => entry[3]).length,
      withExchange: entries.filter((entry) => entry[5]).length,
      topN: 50000,
      maxTranslationChars: 120,
    },
    entries,
  };
}

const databaseNames: string[] = [];
let counter = 0;

function nextDatabaseName(): string {
  counter += 1;
  const name = `earworm-dict-test-${counter}`;
  databaseNames.push(name);
  return name;
}

afterEach(async () => {
  while (databaseNames.length > 0) {
    const name = databaseNames.pop();
    if (name) await deleteDatabase(null, name);
  }
});

async function readMeta(name: string): Promise<DictMetaRecord | undefined> {
  const db = await openDatabase(name, 1);
  try {
    return await getRecord<DictMetaRecord>(db, DICT_META_STORE, DICT_META_KEY);
  } finally {
    db.close();
  }
}

async function readWordCount(name: string): Promise<number> {
  const db = await openDatabase(name, 1);
  try {
    return await countRecords(db, DICT_WORDS_STORE);
  } finally {
    db.close();
  }
}

describe('importDictionaryToIdb', () => {
  it('writes every entry in chunks and records version + count meta', async () => {
    const dbName = nextDatabaseName();
    const progress: ImportProgress[] = [];
    const result = await importDictionaryToIdb(makeEcdict(), {
      dbName,
      chunkSize: 2,
      onProgress: (update) => progress.push(update),
    });

    expect(result).toEqual({ skipped: false, imported: 5, resumedFrom: 0, total: 5 });
    expect(progress).toEqual([
      { phase: 'idb', loaded: 2, total: 5 },
      { phase: 'idb', loaded: 4, total: 5 },
      { phase: 'idb', loaded: 5, total: 5 },
    ]);
    expect(await readWordCount(dbName)).toBe(5);
    await expect(readMeta(dbName)).resolves.toMatchObject({
      key: DICT_META_KEY,
      version: 'ecdict-v1',
      count: 5,
    });
  });

  it('is idempotent: the same version + count skips without touching the store', async () => {
    const dbName = nextDatabaseName();
    await importDictionaryToIdb(makeEcdict(), { dbName, chunkSize: 2 });

    const progress: ImportProgress[] = [];
    const second = await importDictionaryToIdb(makeEcdict(), {
      dbName,
      onProgress: (update) => progress.push(update),
    });

    expect(second).toEqual({ skipped: true, imported: 0, resumedFrom: 0, total: 5 });
    expect(progress).toEqual([]);
    expect(await readWordCount(dbName)).toBe(5);
  });

  it('clears and reimports when the content version changes', async () => {
    const dbName = nextDatabaseName();
    await importDictionaryToIdb(makeEcdict(), { dbName, chunkSize: 2 });

    const replacement: DictRow[] = [['fresh', '', 'adj. 新的', 'adj.', '', '']];
    const result = await importDictionaryToIdb(makeEcdict('ecdict-v2', replacement), {
      dbName,
      chunkSize: 2,
    });

    expect(result).toMatchObject({ skipped: false, imported: 1, resumedFrom: 0, total: 1 });
    expect(await readWordCount(dbName)).toBe(1);
    await expect(readMeta(dbName)).resolves.toMatchObject({ version: 'ecdict-v2', count: 1 });
  });

  it('resumes after an interrupted chunk instead of restarting', async () => {
    const dbName = nextDatabaseName();
    let calls = 0;
    await expect(
      importDictionaryToIdb(makeEcdict(), {
        dbName,
        chunkSize: 2,
        onProgress: () => {
          calls += 1;
          if (calls === 1) throw new Error('simulated interruption');
        },
      }),
    ).rejects.toThrow('simulated interruption');

    expect(await readWordCount(dbName)).toBe(2);

    const resumed = await importDictionaryToIdb(makeEcdict(), { dbName, chunkSize: 2 });
    expect(resumed).toEqual({ skipped: false, imported: 3, resumedFrom: 2, total: 5 });
    expect(await readWordCount(dbName)).toBe(5);
    await expect(readMeta(dbName)).resolves.toMatchObject({ version: 'ecdict-v1', count: 5 });
  });

  it('restarts when a resumed import has a different version', async () => {
    const dbName = nextDatabaseName();
    const db = await openDatabase(dbName, 1, [
      { name: DICT_WORDS_STORE, keyPath: 'word' },
      { name: DICT_META_STORE, keyPath: 'key' },
    ]);
    try {
      await putRecord(db, DICT_META_STORE, {
        key: DICT_PROGRESS_KEY,
        version: 'ecdict-old',
        nextIndex: 2,
      });
    } finally {
      db.close();
    }

    const result = await importDictionaryToIdb(makeEcdict('ecdict-new'), { dbName, chunkSize: 2 });
    expect(result).toMatchObject({ skipped: false, imported: 5, resumedFrom: 0, total: 5 });
  });

  it('leaves no progress marker after a complete import', async () => {
    const dbName = nextDatabaseName();
    await importDictionaryToIdb(makeEcdict(), { dbName });
    const db = await openDatabase(dbName, 1);
    try {
      await expect(
        getRecord(db, DICT_META_STORE, DICT_PROGRESS_KEY),
      ).resolves.toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('finalizes when every chunk was committed but the meta was not', async () => {
    const dbName = nextDatabaseName();
    const db = await openDatabase(dbName, 1, [
      { name: DICT_WORDS_STORE, keyPath: 'word' },
      { name: DICT_META_STORE, keyPath: 'key' },
    ]);
    try {
      for (const row of rows) {
        await putRecord(db, DICT_WORDS_STORE, {
          word: row[0],
          translation: row[2],
          tags: row[4] ? row[4].split(' ') : [],
        });
      }
      await putRecord(db, DICT_META_STORE, {
        key: DICT_PROGRESS_KEY,
        version: 'ecdict-v1',
        nextIndex: rows.length,
      });
    } finally {
      db.close();
    }

    const result = await importDictionaryToIdb(makeEcdict(), { dbName, chunkSize: 2 });
    expect(result).toEqual({ skipped: false, imported: 0, resumedFrom: 5, total: 5 });
    expect(await readWordCount(dbName)).toBe(5);
    await expect(readMeta(dbName)).resolves.toMatchObject({ version: 'ecdict-v1', count: 5 });
  });
});
