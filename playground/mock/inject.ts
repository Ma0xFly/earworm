/**
 * Mock MAIN-world transcript producer for the playground (T14).
 *
 * In the extension, `src/entrypoints/inject.ts` sniffs the player's timedtext
 * requests and answers `earworm:produce` with a validated `earworm:cues-ready`
 * envelope (or `earworm:cues-failed`). The playground has no YouTube player,
 * so this module plays that role: it listens on the same `window.postMessage`
 * bridge, validates the request with T3's parser, waits a short "network"
 * delay and posts the fixture cues (or the scene's failure) back.
 *
 * The envelope is therefore a genuine T3 protocol message: the real transcript
 * client validates `__earworm`, direction, type, payload shape and videoId
 * before T13 ever sees a sentence.
 */

import type {
  CuesFailedPayload,
  CuesReadyPayload,
} from '../../src/lib/messages';
import {
  parseContentEvent,
  postCuesFailed,
  postCuesReady,
} from '../../src/lib/transcript/bridge';
import { videoIdFromHref } from '../../src/lib/transcript/url';
import { FIXTURE_CUES } from '../fixture';
import type { SceneId } from '../scene';

export type CueReply =
  | { kind: 'ready'; payload: CuesReadyPayload }
  | { kind: 'failed'; payload: CuesFailedPayload };

/**
 * The reply a scene produces for a video: no-captions fails, every other
 * scene serves the fixture manual-English track.
 */
export function replyForScene(scene: SceneId, videoId: string): CueReply {
  if (scene === 'no-captions') {
    return {
      kind: 'failed',
      payload: { videoId, reason: 'no-captions' },
    };
  }
  return {
    kind: 'ready',
    payload: { videoId, lang: 'en', kind: 'manual', cues: FIXTURE_CUES },
  };
}

export type MockInjectOptions = {
  getScene: () => SceneId;
  /** Simulated player/timedtext latency. */
  latencyMs?: number;
};

/**
 * Install the mock producer. Returns a teardown that removes the listener.
 * Replies are dropped when a newer `produce` arrived in the meantime or the
 * page URL moved to another video.
 */
export function installMockInject(options: MockInjectOptions): () => void {
  const latencyMs = options.latencyMs ?? 140;
  let generation = 0;
  const timers = new Set<number>();

  const onMessage = (event: MessageEvent): void => {
    const request = parseContentEvent(event);
    if (!request) return;

    const expectedVideoId = videoIdFromHref(window.location.href);
    if (!expectedVideoId || request.payload.videoId !== expectedVideoId) return;

    const videoId = request.payload.videoId;
    const current = ++generation;
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      if (current !== generation) return;
      if (videoIdFromHref(window.location.href) !== videoId) return;

      const reply = replyForScene(options.getScene(), videoId);
      if (reply.kind === 'ready') postCuesReady(reply.payload);
      else postCuesFailed(reply.payload);
    }, latencyMs);
    timers.add(timer);
  };

  window.addEventListener('message', onMessage);

  return () => {
    window.removeEventListener('message', onMessage);
    generation += 1;
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
  };
}
