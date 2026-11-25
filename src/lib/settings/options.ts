import type { Settings } from '@/lib/contracts';
import type { SettingsPatch } from '@/lib/settings';

/**
 * UI-side helpers for the options page.
 *
 * This module owns form validation, draft/default merging and the optional
 * host-permission flow for custom LLM endpoints. Storage itself stays in
 * `src/lib/settings.ts`; the API key is only ever written to
 * `chrome.storage.local` through `saveSettings`.
 */

export type LlmFormValues = Settings['llm'];

export type OptionsDraft = {
  llm: LlmFormValues;
  blur: Settings['blur'];
  continuous: Settings['playback']['continuous'];
};

export type LlmFormErrors = Partial<Record<keyof LlmFormValues, string>>;

export type BaseUrlPermissionResult =
  | { granted: true; pattern: string; requested: boolean }
  | { granted: false; pattern: string | null; error: string };

/**
 * Origin patterns already requested at install time by `wxt.config.ts`
 * (`host_permissions`). Any port on loopback HTTP is covered.
 */
function isInstallTimeOrigin(pattern: string): boolean {
  try {
    const origin = new URL(pattern.slice(0, -2));
    return (
      origin.protocol === 'http:' &&
      (origin.hostname === 'localhost' || origin.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

/** Start a draft from the normalized settings, filling in every default. */
export function draftFromSettings(settings: Settings): OptionsDraft {
  return {
    llm: {
      baseUrl: settings.llm.baseUrl,
      apiKey: settings.llm.apiKey,
      model: settings.llm.model,
    },
    blur: { en: settings.blur.en, zh: settings.blur.zh },
    continuous: settings.playback.continuous,
  };
}

/** Trim form values and remove trailing slashes from the endpoint URL. */
export function normalizeLlmForm(values: LlmFormValues): LlmFormValues {
  return {
    baseUrl: values.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: values.apiKey.trim(),
    model: values.model.trim(),
  };
}

function baseUrlError(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return '请填写 Base URL';

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return 'Base URL 必须是有效的 http 或 https 地址';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Base URL 只支持 http 或 https';
  }
  if (!parsed.hostname) {
    return 'Base URL 必须包含主机名';
  }
  if (parsed.username || parsed.password) {
    return 'Base URL 不能包含用户名或密码';
  }
  return undefined;
}

/** Validate the LLM trio. The API key is optional (local gateways may skip it). */
export function validateLlmForm(values: LlmFormValues): LlmFormErrors {
  const errors: LlmFormErrors = {};
  const endpoint = baseUrlError(values.baseUrl);
  if (endpoint) errors.baseUrl = endpoint;
  if (!values.model.trim()) errors.model = '请填写模型名称';
  return errors;
}

/** Build the partial update persisted by the options page. */
export function draftToPatch(draft: OptionsDraft): SettingsPatch {
  return {
    llm: normalizeLlmForm(draft.llm),
    blur: { en: draft.blur.en, zh: draft.blur.zh },
    playback: { continuous: draft.continuous },
  };
}

/**
 * Derive the optional-host-permission pattern for a base URL:
 * `https://api.example.com/v1` -> `https://api.example.com/*`.
 * Returns `null` for non-HTTP(S) or credential-bearing URLs.
 */
export function deriveOriginPattern(baseUrl: string): string | null {
  const trimmed = baseUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    return `${parsed.origin}/*`;
  } catch {
    return null;
  }
}

/**
 * Ensure the browser may reach a custom base URL.
 *
 * Loopback HTTP origins are already covered by install-time host permissions.
 * Every other origin is checked with `permissions.contains` and only requested
 * when missing; call this directly from the save click handler so Chrome sees
 * a user gesture. A denied/failed request returns `granted:false` and the
 * caller must not persist the URL.
 */
export async function ensureBaseUrlPermission(baseUrl: string): Promise<BaseUrlPermissionResult> {
  const pattern = deriveOriginPattern(baseUrl);
  if (!pattern) {
    return {
      granted: false,
      pattern: null,
      error: '请先填写有效的 http 或 https Base URL',
    };
  }

  if (isInstallTimeOrigin(pattern)) {
    return { granted: true, pattern, requested: false };
  }

  const permissions = typeof chrome !== 'undefined' ? chrome.permissions : undefined;
  if (!permissions || typeof permissions.request !== 'function') {
    return {
      granted: false,
      pattern,
      error: '当前浏览器不支持申请端点访问权限',
    };
  }

  let alreadyGranted = false;
  try {
    alreadyGranted =
      typeof permissions.contains === 'function'
        ? await permissions.contains({ origins: [pattern] })
        : false;
  } catch {
    // A failed contains() must not block a fresh user-gesture request.
    alreadyGranted = false;
  }
  if (alreadyGranted) {
    return { granted: true, pattern, requested: false };
  }

  try {
    const granted = await permissions.request({ origins: [pattern] });
    if (!granted) {
      return {
        granted: false,
        pattern,
        error: `未授予 ${pattern} 的访问权限，设置未保存`,
      };
    }
    return { granted: true, pattern, requested: true };
  } catch (error) {
    return {
      granted: false,
      pattern,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Collapse whitespace and shorten a connection-test sample for display. */
export function truncateSample(sample: string | undefined, maxChars = 160): string | undefined {
  if (typeof sample !== 'string') return undefined;
  const collapsed = sample.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  const limit = Math.max(1, Math.floor(maxChars));
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit)}…`;
}
