import type { MessageRouter } from '@/lib/messages';
import { loadSettings } from '@/lib/settings';
import { translateBatch } from './batch';
import {
  clearTranslationCache,
  commitTranslation,
  getCachedTranslation,
} from './cache';
import { requestChatCompletion } from './client';
import { buildPromptMessages } from './prompt';
import { errorMessage } from '@/lib/utils/error';

/**
 * Background translation handlers.
 *
 * `registerTranslationHandlers(router)` is the only entrypoint the background
 * service worker imports; every handler catches its own failures so a bad
 * request can never reject into the worker event loop.
 */

/** The connection test is interactive; do not make the options page wait 2 min. */
const TEST_LLM_TIMEOUT_MS = 30_000;
const TEST_SAMPLE_MAX_CHARS = 240;

function truncateSample(content: string): string {
  const normalized = content.trim();
  if (normalized.length <= TEST_SAMPLE_MAX_CHARS) return normalized;
  return `${normalized.slice(0, TEST_SAMPLE_MAX_CHARS - 1)}…`;
}

export function registerTranslationHandlers(router: MessageRouter): void {
  router.register('earworm:get-cached', async (request) => {
    if (request.type !== 'earworm:get-cached') return { hit: false };
    try {
      const data = await getCachedTranslation(request.videoId, request.cuesHash);
      return data ? { hit: true, data } : { hit: false };
    } catch {
      // A cache failure must degrade to a miss, not block translation.
      return { hit: false };
    }
  });

  router.register('earworm:translate-batch', async (request) => {
    if (request.type !== 'earworm:translate-batch') {
      return { ok: false, error: 'Unexpected request type' };
    }
    try {
      const settings = await loadSettings();
      return await translateBatch({
        meta: request.meta,
        items: request.batch,
        settings: settings.llm,
      });
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });

  router.register('earworm:commit', async (request) => {
    if (request.type !== 'earworm:commit') {
      return { ok: false, error: 'Unexpected request type' };
    }
    try {
      await commitTranslation(request.videoId, request.cuesHash, request.data);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });

  router.register('earworm:test-llm', async (request) => {
    if (request.type !== 'earworm:test-llm') {
      return { ok: false, error: 'Unexpected request type' };
    }
    try {
      const messages = buildPromptMessages(
        { videoId: 'connection-test', title: 'Earworm connection test', channel: 'Earworm' },
        [{ i: 0, text: 'Hello there, this is a quick connection test.' }],
      );
      const { content } = await requestChatCompletion({
        settings: request.llm,
        messages,
        timeoutMs: TEST_LLM_TIMEOUT_MS,
      });
      return { ok: true, sample: truncateSample(content) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });

  router.register('earworm:clear-cache', async () => {
    try {
      await clearTranslationCache();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });
}
