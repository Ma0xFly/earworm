/**
 * Adapted for Earworm (MIT) from Gythiro/yt-dual-subs (MIT) — Copyright (c) 2026 Gythiro.
 * Upstream: https://github.com/Gythiro/yt-dual-subs (v3.7.0: content.js
 * `onInjectMessage`, `sendConfig`, `onNav`; `videoIdFromLocation`).
 * Adapted: 2026-11-24. Full upstream MIT permission text: see NOTICE.
 *
 * Isolated-world transcript client: listens to the validated window bridge,
 * requests cues on start and after every YouTube SPA navigation, drops stale
 * messages and hands the normalized track (or a classified failure) to the
 * session layer (T13).
 */

import type { CueTrack } from '@/lib/contracts';
import { INJECT_MESSAGE } from '@/lib/messages';
import { parseInjectEvent, requestProduce } from './bridge';
import { videoIdFromLocation } from './url';

export type TranscriptFailureReason =
  | 'no-captions'
  | 'nudge-failed'
  | 'timeout'
  | 'http';

export type TranscriptHandlers = {
  onTrack: (track: CueTrack) => void;
  onFailure: (videoId: string, reason: TranscriptFailureReason) => void;
};

export type TranscriptClientOptions = {
  /** Window carrying the bridge; defaults to the global one (tests override). */
  pageWindow?: Window;
  /** Current videoId source; defaults to the URL `v=` / Shorts path id. */
  getVideoId?: () => string;
};

/**
 * Start the content-side transcript client. Returns a teardown that removes
 * every listener; after teardown no handler is called again.
 */
export function startTranscriptClient(
  handlers: TranscriptHandlers,
  options: TranscriptClientOptions = {},
): () => void {
  const pageWindow = options.pageWindow ?? window;
  const getVideoId = options.getVideoId ?? videoIdFromLocation;

  let currentVideoId = getVideoId();
  let disposed = false;

  const produce = (videoId: string, force?: boolean): void => {
    if (!videoId) return;
    requestProduce(force ? { videoId, force: true } : { videoId }, pageWindow);
  };

  const onMessage = (event: MessageEvent): void => {
    if (disposed) return;
    // The bridge validates event.source === window, the envelope marker,
    // direction, payload shape and the videoId before this returns anything.
    const message = parseInjectEvent(event, { videoId: currentVideoId });
    if (!message) return;

    if (message.type === INJECT_MESSAGE.cuesReady) {
      handlers.onTrack({
        videoId: message.payload.videoId,
        lang: message.payload.lang,
        kind: message.payload.kind,
        cues: message.payload.cues,
      });
      return;
    }
    // parseInjectEvent only lets the two inject→content types through.
    handlers.onFailure(message.payload.videoId, message.payload.reason);
  };

  const onNavigate = (): void => {
    if (disposed) return;
    // One document, many videos: every later reply for the old id is stale
    // the moment this runs, and the inject script needs a produce request for
    // the new video (it resets its own capture state on the same signal).
    currentVideoId = getVideoId();
    // Force: the inject script may already have produced this video's cues
    // for a client that had not observed the navigation yet; the new client
    // generation still needs its own reply.
    produce(currentVideoId, true);
  };

  pageWindow.addEventListener('message', onMessage, false);
  // YouTube announces SPA navigations on `window` (capture phase upstream).
  // Shorts swipes race this event; the inject-side 500ms id poll still resets
  // its own state, and the next `yt-navigate-finish` re-produces.
  pageWindow.addEventListener('yt-navigate-finish', onNavigate, true);
  produce(currentVideoId);

  return () => {
    if (disposed) return;
    disposed = true;
    pageWindow.removeEventListener('message', onMessage, false);
    pageWindow.removeEventListener('yt-navigate-finish', onNavigate, true);
  };
}
