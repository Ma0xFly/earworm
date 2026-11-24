import { afterEach, describe, expect, it } from 'vitest';
import {
  countRecords,
  deleteDatabase,
  deleteRecord,
  getAllRecords,
  getRecord,
  openDatabase,
  putRecord,
} from '@/lib/db/idb';

type VideoRow = { id: string; title: string; updatedAt: number };

const databases: Array<{ db: IDBDatabase | null; name: string }> = [];

async function createDb(name: string): Promise<IDBDatabase> {
  const db = await openDatabase(name, 1, [
    {
      name: 'videos',
      keyPath: 'id',
      indexes: [{ name: 'by-updatedAt', keyPath: 'updatedAt' }],
    },
  ]);
  databases.push({ db, name });
  return db;
}

afterEach(async () => {
  while (databases.length > 0) {
    const entry = databases.pop();
    if (!entry) continue;
    await deleteDatabase(entry.db, entry.name);
  }
});

describe('IndexedDB helpers', () => {
  it('opens a database and creates stores and indexes', async () => {
    const db = await createDb('earworm-test-open');
    expect(db.objectStoreNames.contains('videos')).toBe(true);
    expect(db.transaction('videos').objectStore('videos').indexNames.contains('by-updatedAt')).toBe(
      true,
    );
  });

  it('puts, gets, lists, counts and deletes records', async () => {
    const db = await createDb('earworm-test-crud');
    const first: VideoRow = { id: 'a', title: 'Alpha', updatedAt: 1 };
    const second: VideoRow = { id: 'b', title: 'Beta', updatedAt: 2 };

    await putRecord(db, 'videos', first);
    await putRecord(db, 'videos', second);
    expect(await countRecords(db, 'videos')).toBe(2);

    await expect(getRecord<VideoRow>(db, 'videos', 'a')).resolves.toEqual(first);
    await expect(getAllRecords<VideoRow>(db, 'videos')).resolves.toEqual(
      expect.arrayContaining([first, second]),
    );

    await putRecord(db, 'videos', { ...first, title: 'Alpha 2' });
    await expect(getRecord<VideoRow>(db, 'videos', 'a')).resolves.toMatchObject({
      title: 'Alpha 2',
    });

    await deleteRecord(db, 'videos', 'a');
    expect(await countRecords(db, 'videos')).toBe(1);
    await expect(getRecord(db, 'videos', 'a')).resolves.toBeUndefined();
  });

  it('rejects with a clear error for a missing store', async () => {
    const db = await createDb('earworm-test-missing-store');
    await expect(getRecord(db, 'nope', 'x')).rejects.toBeTruthy();
  });

  it('is idempotent across reopen with the same version', async () => {
    const name = 'earworm-test-reopen';
    const first = await createDb(name);
    first.close();
    const second = await openDatabase(name, 1);
    databases.push({ db: second, name });
    expect(second.objectStoreNames.contains('videos')).toBe(true);
  });
});
