import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/contracts';
import {
  SETTINGS_STORAGE_KEY,
  applySettingsPatch,
  loadSettings,
  normalizeSettings,
  saveSettings,
  subscribeSettings,
} from '@/lib/settings';
import { readStorage, seedStorage } from './mocks/chrome';

describe('settings', () => {
  it('loads defaults when storage is empty', async () => {
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('normalizes malformed storage without throwing away valid fields', () => {
    const normalized = normalizeSettings({
      version: 99,
      llm: { baseUrl: 42, apiKey: 'secret', model: 'm' },
      blur: { en: 'yes', zh: true },
      playback: { continuous: 0 },
      ui: { sidebar: null },
      extra: 'dropped',
    });

    expect(normalized.version).toBe(1);
    expect(normalized.llm.baseUrl).toBe(DEFAULT_SETTINGS.llm.baseUrl);
    expect(normalized.llm.apiKey).toBe('secret');
    expect(normalized.llm.model).toBe('m');
    expect(normalized.blur).toEqual({ en: false, zh: true });
    expect(normalized.playback.continuous).toBe(false);
    expect(normalized.ui.sidebar).toBe(true);
    expect('extra' in normalized).toBe(false);
  });

  it('merges a nested patch without losing sibling fields', () => {
    const base: Settings = {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'http://example/v1', apiKey: 'k', model: 'm' },
    };
    const next = applySettingsPatch(base, { blur: { en: true }, playback: { continuous: true } });
    expect(next.llm).toEqual(base.llm);
    expect(next.blur).toEqual({ en: true, zh: false });
    expect(next.playback.continuous).toBe(true);
    expect(next.ui.sidebar).toBe(true);
  });

  it('persists a merged settings object under the shared storage key', async () => {
    seedStorage(SETTINGS_STORAGE_KEY, {
      ...DEFAULT_SETTINGS,
      llm: { ...DEFAULT_SETTINGS.llm, apiKey: 'from-storage' },
    });

    const saved = await saveSettings({ blur: { zh: true }, llm: { model: 'group/other' } });

    expect(saved.llm.apiKey).toBe('from-storage');
    expect(saved.llm.model).toBe('group/other');
    expect(saved.blur.zh).toBe(true);
    expect(readStorage(SETTINGS_STORAGE_KEY)).toEqual(saved);
    await expect(loadSettings()).resolves.toEqual(saved);
  });

  it('notifies subscribers of local settings changes and unsubscribes cleanly', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSettings(listener);

    await saveSettings({ blur: { en: true } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ blur: { en: true } });

    unsubscribe();
    await saveSettings({ blur: { en: false } });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
