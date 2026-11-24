/**
 * Minimal IndexedDB helpers shared by the translation cache (background),
 * the offline dictionary import (content) and tests.
 *
 * Every helper opens a transaction per call. Long-running bulk imports should
 * use `withStore` directly so chunking policy stays in the feature module.
 */

export type IndexDefinition = {
  name: string;
  keyPath: string | string[];
  unique?: boolean;
  multiEntry?: boolean;
};

export type StoreDefinition = {
  name: string;
  keyPath?: string;
  autoIncrement?: boolean;
  indexes?: IndexDefinition[];
};

/** Open (and upgrade) a database, creating any store/index it does not have. */
export function openDatabase(
  name: string,
  version: number,
  stores: StoreDefinition[] = [],
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment'));
      return;
    }
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;
      for (const definition of stores) {
        const store = db.objectStoreNames.contains(definition.name)
          ? transaction?.objectStore(definition.name)
          : db.createObjectStore(definition.name, {
              ...(definition.keyPath !== undefined ? { keyPath: definition.keyPath } : {}),
              ...(definition.autoIncrement !== undefined
                ? { autoIncrement: definition.autoIncrement }
                : {}),
            });
        if (!store) continue;
        for (const index of definition.indexes ?? []) {
          if (!store.indexNames.contains(index.name)) {
            store.createIndex(index.name, index.keyPath, {
              unique: index.unique ?? false,
              multiEntry: index.multiEntry ?? false,
            });
          }
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`Failed to open database ${name}`));
    request.onblocked = () =>
      reject(new Error(`Opening database ${name} is blocked by another connection`));
  });
}

/** Wrap an `IDBRequest` in a promise. */
export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/** Resolve when a transaction commits, reject when it errors or aborts. */
export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Run `fn` against one object store and resolve with its result after the
 * transaction commits. `fn` must only use that store (and its requests), so
 * the transaction stays alive until it settles.
 */
export function withStore<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => T | Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(storeName, mode);
    } catch (error) {
      reject(error);
      return;
    }

    let value: T;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      try {
        transaction.abort();
      } catch {
        // Transaction may already be finished.
      }
      reject(error);
    };

    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    transaction.onerror = () =>
      fail(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () =>
      fail(transaction.error ?? new Error('IndexedDB transaction aborted'));

    try {
      const result = fn(transaction.objectStore(storeName));
      if (result instanceof Promise) {
        result.then(
          (resolved) => {
            value = resolved;
          },
          (error) => fail(error),
        );
      } else {
        value = result;
      }
    } catch (error) {
      fail(error);
    }
  });
}

export function getRecord<T>(
  db: IDBDatabase,
  storeName: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  return withStore(db, storeName, 'readonly', (store) =>
    requestToPromise<T | undefined>(store.get(key) as IDBRequest<T | undefined>),
  );
}

export function putRecord(
  db: IDBDatabase,
  storeName: string,
  value: unknown,
  key?: IDBValidKey,
): Promise<IDBValidKey> {
  return withStore(db, storeName, 'readwrite', (store) =>
    requestToPromise(store.put(value, key)),
  );
}

export function deleteRecord(
  db: IDBDatabase,
  storeName: string,
  key: IDBValidKey,
): Promise<void> {
  return withStore(db, storeName, 'readwrite', (store) =>
    requestToPromise(store.delete(key)),
  );
}

export function getAllRecords<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return withStore(db, storeName, 'readonly', (store) =>
    requestToPromise<T[]>(store.getAll() as IDBRequest<T[]>),
  );
}

export function countRecords(db: IDBDatabase, storeName: string): Promise<number> {
  return withStore(db, storeName, 'readonly', (store) => requestToPromise(store.count()));
}

export function clearStore(db: IDBDatabase, storeName: string): Promise<void> {
  return withStore(db, storeName, 'readwrite', (store) => requestToPromise(store.clear()));
}

/** Close and delete a database (used by "clear cache" and tests). */
export function deleteDatabase(db: IDBDatabase | null, name: string): Promise<void> {
  db?.close();
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      resolve();
      return;
    }
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`Failed to delete ${name}`));
    request.onblocked = () => reject(new Error(`Deleting database ${name} is blocked`));
  });
}
