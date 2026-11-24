import type { MessageRouter } from '@/lib/messages';

/**
 * Background translation handlers (T1 stub).
 *
 * T4 replaces this file with the real OpenAI-compatible batch translation
 * pipeline and IndexedDB cache. `registerTranslationHandlers(router)` is the
 * only entrypoint the background service worker imports, so the signature
 * must stay stable.
 */
export function registerTranslationHandlers(router: MessageRouter): void {
  router.register('earworm:get-cached', () => ({ hit: false }));
  router.register('earworm:translate-batch', () => ({
    ok: false,
    error: 'LLM translation is not implemented yet (ticket T4)',
  }));
  router.register('earworm:commit', () => ({ ok: true }));
  router.register('earworm:test-llm', () => ({
    ok: false,
    error: 'LLM connection test is not implemented yet (ticket T4)',
  }));
  router.register('earworm:clear-cache', () => ({ ok: true }));
}
