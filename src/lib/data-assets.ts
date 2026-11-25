import {
  sendRuntimeMessage,
  type FetchDataResponse,
} from '@/lib/messages';

/**
 * Read a shipped JSON asset (`data/*.json`).
 *
 * Direct `fetch(chrome.runtime.getURL(...))` from the isolated content world is
 * blocked on youtube.com ("Unsafe attempt to load URL ... Domains, protocols
 * and ports must match"), even though the extension origin serves the file.
 * Every shipped asset therefore falls back to the service worker, which can
 * fetch its own origin. The caller's `fetchImpl`/URL stay injectable for
 * tests and the playground.
 */
async function fetchTextViaBackground(path: string): Promise<string | null> {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.id || typeof runtime.sendMessage !== 'function') return null;
  try {
    const response = await sendRuntimeMessage<FetchDataResponse>({
      type: 'earworm:fetch-data',
      path,
    });
    if (response?.ok === true && typeof response.text === 'string') {
      return response.text;
    }
  } catch (error) {
    console.warn('[earworm] background data fetch failed:', error);
  }
  return null;
}

/**
 * Fetch one JSON asset directly, falling back to the background service
 * worker when the direct request fails. The original fetch error is preserved
 * when the fallback is unavailable, so callers keep their diagnostics.
 */
export async function fetchExtensionJson(
  path: string,
  fetchImpl: typeof fetch,
  url: string,
): Promise<unknown> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return await response.json();
  } catch (error) {
    const text = await fetchTextViaBackground(path);
    if (text === null) throw error;
    return JSON.parse(text) as unknown;
  }
}
