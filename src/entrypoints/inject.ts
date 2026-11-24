/**
 * MAIN-world subtitle acquisition bridge (T1 stub).
 *
 * T3 replaces this file with the real implementation: hook XHR/fetch (and
 * PerformanceObserver) in the page context, capture the player's own
 * `/api/timedtext` request (including `pot`), re-fetch it as `fmt=json3`,
 * normalize to `Cue[]` and post an `earworm:cues-ready` /
 * `earworm:cues-failed` envelope to the isolated content script.
 *
 * The manifest registers this built file as a `world: "MAIN"`,
 * `run_at: "document_start"` content script.
 */
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

export default defineUnlistedScript({
  main() {
    // No-op scaffold. T3 owns the bridge; this marker lets the future bridge
    // detect a duplicate injection during development.
    (window as Window & { __earwormInjectScaffold?: boolean }).__earwormInjectScaffold = true;
  },
});
