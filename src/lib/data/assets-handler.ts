import type { MessageRouter } from '@/lib/messages';
import { errorMessage } from '@/lib/utils/error';

/**
 * Serve shipped data assets to the content script.
 *
 * Background service workers can fetch `chrome.runtime.getURL(...)`; content
 * scripts cannot on youtube.com. Paths are validated by `isRuntimeRequest`
 * (only `data/*.json`), so this handler cannot read arbitrary extension files.
 */
export function registerDataHandlers(
  router: MessageRouter,
  fetchImpl: typeof fetch = fetch,
): void {
  router.register('earworm:fetch-data', async (request) => {
    if (request.type !== 'earworm:fetch-data') {
      return { ok: false, error: 'Unexpected request type' };
    }
    try {
      const response = await fetchImpl(chrome.runtime.getURL(request.path));
      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status} for ${request.path}` };
      }
      return { ok: true, text: await response.text() };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });
}
