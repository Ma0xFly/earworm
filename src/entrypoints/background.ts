import { defineBackground } from 'wxt/utils/define-background';
import { createMessageRouter, isRuntimeRequest } from '@/lib/messages';
import { registerTranslationHandlers } from '@/lib/llm/translate-handler';
import { registerDataHandlers } from '@/lib/data/assets-handler';
import { errorMessage } from '@/lib/utils/error';

/**
 * Background service worker: owns the LLM translation channel and its
 * IndexedDB cache.
 *
 * T1 provides the message router skeleton; T4 replaces
 * `src/lib/llm/translate-handler.ts` with real handlers and keeps
 * `registerTranslationHandlers(router)` stable.
 */
export default defineBackground(() => {
  const router = createMessageRouter();
  registerTranslationHandlers(router);
  registerDataHandlers(router);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isRuntimeRequest(message)) return false;

    void router
      .dispatch(message, sender)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: errorMessage(error),
        });
      });
    return true;
  });
});
