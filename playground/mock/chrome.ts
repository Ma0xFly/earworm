/**
 * `chrome.*` mock for the playground (T14).
 *
 * The real content app (settings provider, session engine, dictionary loader,
 * collocation loader) expects the extension runtime. This module installs a
 * minimal in-memory implementation before anything mounts:
 *
 * - `chrome.storage.local` + `chrome.storage.onChanged` (settings sync);
 * - `chrome.runtime.getURL` -> the repository `public/` directory served by
 *   Vite (`/data/ecdict.json`, `/data/collocations.json`, …);
 * - `chrome.runtime.sendMessage` -> {@link MockBackend} (background messages);
 * - `chrome.permissions` (only touched by the options page, provided anyway).
 *
 * Storage is mirrored into `sessionStorage` so the continuous-play toggle
 * survives a "重新加载「 of the playground page.
 */

import type { MockBackend } from './background';

type StorageChange = chrome.storage.StorageChange;
type ChangeListener = (
  changes: Record<string, StorageChange>,
  areaName: string,
) => void;

const PERSIST_KEY = 'earworm:playground:storage';

function loadPersistedStorage(): Map<string, unknown> {
  const storage = new Map<string, unknown>();
  try {
    const raw = window.sessionStorage.getItem(PERSIST_KEY);
    if (!raw) return storage;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return storage;
    for (const [key, value] of Object.entries(parsed)) storage.set(key, value);
  } catch {
    // Storage is a convenience only; an unreadable value means defaults.
  }
  return storage;
}

function persistStorage(storage: Map<string, unknown>): void {
  try {
    const plain: Record<string, unknown> = {};
    for (const [key, value] of storage) plain[key] = value;
    window.sessionStorage.setItem(PERSIST_KEY, JSON.stringify(plain));
  } catch {
    // Quota/private-mode failures must not break the demo.
  }
}

export type ChromeMock = {
  storage: Map<string, unknown>;
  dispose: () => void;
};

/** Install the mock on `globalThis.chrome`; returns a restore handle. */
export function installChromeMock(backend: MockBackend): ChromeMock {
  const storage = loadPersistedStorage();
  const changeListeners = new Set<ChangeListener>();

  const emit = (changes: Record<string, StorageChange>): void => {
    if (Object.keys(changes).length === 0) return;
    persistStorage(storage);
    for (const listener of [...changeListeners]) listener(changes, 'local');
  };

  const getKeys = (
    keys?: string | string[] | Record<string, unknown> | null,
  ): Record<string, unknown> => {
    if (keys === undefined || keys === null) {
      return Object.fromEntries(storage);
    }
    if (typeof keys === 'string') {
      return storage.has(keys) ? { [keys]: storage.get(keys) } : {};
    }
    if (Array.isArray(keys)) {
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        if (storage.has(key)) result[key] = storage.get(key);
      }
      return result;
    }
    const result: Record<string, unknown> = { ...keys };
    for (const key of Object.keys(keys)) {
      if (storage.has(key)) result[key] = storage.get(key);
    }
    return result;
  };

  const local = {
    get: async (keys?: string | string[] | Record<string, unknown> | null) =>
      getKeys(keys),
    set: async (items: Record<string, unknown>) => {
      const changes: Record<string, StorageChange> = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: storage.get(key), newValue: value };
        storage.set(key, value);
      }
      emit(changes);
    },
    remove: async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      const changes: Record<string, StorageChange> = {};
      for (const key of list) {
        if (!storage.has(key)) continue;
        changes[key] = { oldValue: storage.get(key) };
        storage.delete(key);
      }
      emit(changes);
    },
    clear: async () => {
      const changes: Record<string, StorageChange> = {};
      for (const [key, value] of storage) changes[key] = { oldValue: value };
      storage.clear();
      emit(changes);
    },
    getBytesInUse: async () => 0,
    QUOTA_BYTES: 10_485_760,
  };

  const runtime = {
    id: 'earworm-playground',
    lastError: undefined,
    getURL: (path: string): string =>
      `${window.location.origin}/${path.replace(/^\/+/, '')}`,
    sendMessage: (message: unknown): Promise<unknown> =>
      backend.handleMessage(message),
    onMessage: {
      addListener: (): void => {},
      removeListener: (): void => {},
      hasListener: (): boolean => false,
    },
  };

  const permissions = {
    contains: async (): Promise<boolean> => true,
    request: async (): Promise<boolean> => true,
    remove: async (): Promise<boolean> => true,
  };

  const mock = {
    storage: {
      local,
      onChanged: {
        addListener: (listener: ChangeListener): void => {
          changeListeners.add(listener);
        },
        removeListener: (listener: ChangeListener): void => {
          changeListeners.delete(listener);
        },
        hasListener: (listener: ChangeListener): boolean =>
          changeListeners.has(listener),
      },
    },
    runtime,
    permissions,
  };

  const target = globalThis as unknown as { chrome?: unknown };
  const previous = target.chrome;
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    writable: true,
    value: mock,
  });

  return {
    storage,
    dispose() {
      changeListeners.clear();
      if (previous === undefined) {
        Reflect.deleteProperty(target, 'chrome');
      } else {
        Object.defineProperty(globalThis, 'chrome', {
          configurable: true,
          writable: true,
          value: previous,
        });
      }
    },
  };
}
