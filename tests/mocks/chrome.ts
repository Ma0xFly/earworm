import { vi } from 'vitest';

/**
 * Minimal in-memory `chrome` mock used by every test.
 *
 * Implements the promise-based `chrome.storage.local` API, change events, and
 * the runtime/permissions surface the extension touches. Tests can override
 * individual functions (e.g. `chrome.runtime.sendMessage`) with `vi.fn()`.
 */

type ChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void;

const storage = new Map<string, unknown>();
const changeListeners = new Set<ChangeListener>();

async function getKeys(
  keys?: string | string[] | Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
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
}

function emitChanges(changes: Record<string, chrome.storage.StorageChange>): void {
  if (Object.keys(changes).length === 0) return;
  for (const listener of changeListeners) listener(changes, 'local');
}

const local: chrome.storage.StorageArea = {
  get: (keys?: string | string[] | Record<string, unknown> | null) =>
    getKeys(keys) as unknown as Promise<Record<string, unknown>>,
  set: async (items: Record<string, unknown>) => {
    const changes: Record<string, chrome.storage.StorageChange> = {};
    for (const [key, value] of Object.entries(items)) {
      changes[key] = { oldValue: storage.get(key), newValue: value };
      storage.set(key, value);
    }
    emitChanges(changes);
  },
  remove: async (keys: string | string[]) => {
    const list = Array.isArray(keys) ? keys : [keys];
    const changes: Record<string, chrome.storage.StorageChange> = {};
    for (const key of list) {
      if (!storage.has(key)) continue;
      changes[key] = { oldValue: storage.get(key) };
      storage.delete(key);
    }
    emitChanges(changes);
  },
  clear: async () => {
    const changes: Record<string, chrome.storage.StorageChange> = {};
    for (const [key, value] of storage) changes[key] = { oldValue: value };
    storage.clear();
    emitChanges(changes);
  },
  getBytesInUse: async () => 0,
  QUOTA_BYTES: 10_485_760,
} as unknown as chrome.storage.StorageArea;

export const chromeMock = {
  storage: {
    local,
    onChanged: {
      addListener: (listener: ChangeListener) => changeListeners.add(listener),
      removeListener: (listener: ChangeListener) => changeListeners.delete(listener),
      hasListener: (listener: ChangeListener) => changeListeners.has(listener),
    },
  },
  runtime: {
    id: 'earworm-test',
    lastError: undefined as chrome.runtime.LastError | undefined,
    getURL: (path: string) => `chrome-extension://earworm-test/${path.replace(/^\//, '')}`,
    sendMessage: async (_message: unknown) => undefined,
    openOptionsPage: vi.fn(async () => undefined),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
    },
  },
  permissions: {
    contains: async () => true,
    request: async () => true,
    remove: async () => true,
  },
  tabs: { create: vi.fn() },
};

export function installChromeMock(): void {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    writable: true,
    value: chromeMock,
  });
}

export function resetChromeMock(): void {
  storage.clear();
  changeListeners.clear();
  chromeMock.runtime.lastError = undefined;
  chromeMock.runtime.sendMessage = async () => undefined;
  chromeMock.runtime.openOptionsPage.mockClear();
}

/** Seed `chrome.storage.local` without firing change events. */
export function seedStorage(key: string, value: unknown): void {
  storage.set(key, value);
}

/** Read the raw stored value (bypasses settings normalization). */
export function readStorage(key: string): unknown {
  return storage.get(key);
}
