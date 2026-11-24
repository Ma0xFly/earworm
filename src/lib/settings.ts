import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_SETTINGS, type Settings } from './contracts';

/** `chrome.storage.local` key holding the full settings object. */
export const SETTINGS_STORAGE_KEY = 'earworm:settings';

/** Deep partial update accepted by `saveSettings` / `useSettings().set`. */
export type SettingsPatch = {
  version?: 1;
  llm?: Partial<Settings['llm']>;
  blur?: Partial<Settings['blur']>;
  playback?: Partial<Settings['playback']>;
  ui?: Partial<Settings['ui']>;
};

/** Stack-independent deep clone of the defaults (objects/arrays only). */
export function cloneSettings(settings: Settings): Settings {
  return {
    version: 1,
    llm: { ...settings.llm },
    blur: { ...settings.blur },
    playback: { ...settings.playback },
    ui: { ...settings.ui },
  };
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Default + validate a settings object read from storage. Unknown keys are
 * dropped, wrong types fall back to the default, and `version` is always 1.
 */
export function normalizeSettings(raw: unknown): Settings {
  const source = asRecord(raw);
  const llm = asRecord(source.llm);
  const blur = asRecord(source.blur);
  const playback = asRecord(source.playback);
  const ui = asRecord(source.ui);

  return {
    version: 1,
    llm: {
      baseUrl: asString(llm.baseUrl, DEFAULT_SETTINGS.llm.baseUrl),
      apiKey: asString(llm.apiKey, DEFAULT_SETTINGS.llm.apiKey),
      model: asString(llm.model, DEFAULT_SETTINGS.llm.model),
    },
    blur: {
      en: asBoolean(blur.en, DEFAULT_SETTINGS.blur.en),
      zh: asBoolean(blur.zh, DEFAULT_SETTINGS.blur.zh),
    },
    playback: {
      continuous: asBoolean(playback.continuous, DEFAULT_SETTINGS.playback.continuous),
    },
    ui: {
      sidebar: asBoolean(ui.sidebar, DEFAULT_SETTINGS.ui.sidebar),
    },
  };
}

function mergePatch(base: Settings, patch: SettingsPatch): Settings {
  return normalizeSettings({
    version: 1,
    llm: { ...base.llm, ...patch.llm },
    blur: { ...base.blur, ...patch.blur },
    playback: { ...base.playback, ...patch.playback },
    ui: { ...base.ui, ...patch.ui },
  });
}

/** Merge a partial update into an existing settings object. */
export function applySettingsPatch(base: Settings, patch: SettingsPatch): Settings {
  return mergePatch(normalizeSettings(base), patch);
}

function storageArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  return chrome.storage.local;
}

/** Read settings from `chrome.storage.local`; always resolves with defaults. */
export async function loadSettings(): Promise<Settings> {
  const area = storageArea();
  if (!area) return cloneSettings(DEFAULT_SETTINGS);
  try {
    const stored = (await area.get(SETTINGS_STORAGE_KEY)) as Record<string, unknown>;
    return normalizeSettings(stored?.[SETTINGS_STORAGE_KEY]);
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

/** Merge and persist a partial settings update; resolves with the new value. */
export async function saveSettings(patch: SettingsPatch): Promise<Settings> {
  const current = await loadSettings();
  const next = mergePatch(current, patch);
  const area = storageArea();
  if (!area) return next;
  await area.set({ [SETTINGS_STORAGE_KEY]: next });
  return next;
}

/**
 * Subscribe to settings changes. The callback receives the normalized new
 * settings and fires for `chrome.storage.local` writes of the settings key.
 */
export function subscribeSettings(callback: (settings: Settings) => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== 'local' || !(SETTINGS_STORAGE_KEY in changes)) return;
    callback(normalizeSettings(changes[SETTINGS_STORAGE_KEY]?.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export type SettingsContextValue = {
  settings: Settings;
  set: (patch: SettingsPatch) => void;
};

const defaultContextValue: SettingsContextValue = {
  settings: cloneSettings(DEFAULT_SETTINGS),
  set: () => {},
};

const SettingsContext = createContext<SettingsContextValue>(defaultContextValue);

/** Provides settings to the content app; keeps storage and React in sync. */
export function SettingsProvider({ children }: { children?: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => cloneSettings(DEFAULT_SETTINGS));

  useEffect(() => {
    let alive = true;
    void loadSettings().then((loaded) => {
      if (!alive) return;
      setSettings(loaded);
    });
    const unsubscribe = subscribeSettings((next) => {
      if (alive) setSettings(next);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const set = useCallback((patch: SettingsPatch) => {
    setSettings((previous) => applySettingsPatch(previous, patch));
    void saveSettings(patch).catch(() => {
      // Storage failures must never break playback; the in-memory value stands.
    });
  }, []);

  return createElement(SettingsContext.Provider, { value: { settings, set } }, children);
}

/** Read the current settings plus the `set(patch)` updater. */
export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
