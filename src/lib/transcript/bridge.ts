/**
 * Adapted for Earworm (MIT) from Gythiro/yt-dual-subs (MIT) — Copyright (c) 2026 Gythiro.
 * Upstream: https://github.com/Gythiro/yt-dual-subs (v3.7.0: inject.js `post`,
 * content.js `onInjectMessage` / `sendConfig`).
 * Adapted: 2026-11-24. Full upstream MIT permission text: see NOTICE.
 *
 * Validated `window.postMessage` bridge between the MAIN-world inject script
 * and the isolated-world transcript client. Envelope shapes, direction names,
 * message types and payload validators come from `@/lib/messages`; this module
 * adds the event-source/direction checks both sides must perform before acting
 * on anything, and the three post helpers.
 */

import {
  INJECT_MESSAGE,
  isCuesFailedPayload,
  isCuesReadyPayload,
  isInjectEnvelope,
  isProducePayload,
  postInjectMessage,
  type CuesFailedPayload,
  type CuesReadyPayload,
  type InjectDirection,
  type InjectEnvelope,
  type ProducePayload,
} from '@/lib/messages';

export type CuesReadyMessage = InjectEnvelope<CuesReadyPayload> & {
  dir: 'inject-to-content';
  type: typeof INJECT_MESSAGE.cuesReady;
};

export type CuesFailedMessage = InjectEnvelope<CuesFailedPayload> & {
  dir: 'inject-to-content';
  type: typeof INJECT_MESSAGE.cuesFailed;
};

export type InjectBridgeMessage = CuesReadyMessage | CuesFailedMessage;

export type ProduceMessage = InjectEnvelope<ProducePayload> & {
  dir: 'content-to-inject';
  type: typeof INJECT_MESSAGE.produce;
};

export type BridgeFilter = {
  /** When set, messages whose payload videoId differs are rejected as stale. */
  videoId?: string;
};

/* -------------------------------------------------------------------------- */
/* posting (both worlds)                                                       */
/* -------------------------------------------------------------------------- */

/** inject → content: the normalized manual-English cue track. */
export function postCuesReady(payload: CuesReadyPayload, target: Window = window): void {
  postInjectMessage('inject-to-content', INJECT_MESSAGE.cuesReady, payload, target);
}

/** inject → content: acquisition gave up for this video, with a reason. */
export function postCuesFailed(payload: CuesFailedPayload, target: Window = window): void {
  postInjectMessage('inject-to-content', INJECT_MESSAGE.cuesFailed, payload, target);
}

/** content → inject: acquire (or force re-acquire) cues for this video. */
export function requestProduce(payload: ProducePayload, target: Window = window): void {
  postInjectMessage('content-to-inject', INJECT_MESSAGE.produce, payload, target);
}

/* -------------------------------------------------------------------------- */
/* parsing                                                                     */
/* -------------------------------------------------------------------------- */

function readEnvelope(event: MessageEvent, direction: InjectDirection): InjectEnvelope | null {
  // `event.source === window` is the only origin check that matters for a
  // same-page bridge: an iframe or another window can post to us, but cannot
  // impersonate our own window as the event source.
  if (event.source !== window) return null;
  const data: unknown = event.data;
  if (!isInjectEnvelope(data)) return null;
  if (data.dir !== direction) return null;
  return data;
}

/**
 * Validate one `message` event arriving in the isolated world. Returns `null`
 * for anything that is not an Earworm inject→content message, including known
 * types with malformed payloads and messages for another videoId.
 */
export function parseInjectEvent(
  event: MessageEvent,
  filter?: BridgeFilter,
): InjectBridgeMessage | null {
  const envelope = readEnvelope(event, 'inject-to-content');
  if (!envelope) return null;

  if (envelope.type === INJECT_MESSAGE.cuesReady) {
    if (!isCuesReadyPayload(envelope.payload)) return null;
    if (filter?.videoId && envelope.payload.videoId !== filter.videoId) return null;
    return envelope as CuesReadyMessage;
  }
  if (envelope.type === INJECT_MESSAGE.cuesFailed) {
    if (!isCuesFailedPayload(envelope.payload)) return null;
    if (filter?.videoId && envelope.payload.videoId !== filter.videoId) return null;
    return envelope as CuesFailedMessage;
  }
  return null;
}

/**
 * Validate one `message` event arriving in the MAIN world. Returns `null` for
 * anything that is not an Earworm content→inject produce request.
 */
export function parseContentEvent(
  event: MessageEvent,
  filter?: BridgeFilter,
): ProduceMessage | null {
  const envelope = readEnvelope(event, 'content-to-inject');
  if (!envelope) return null;
  if (envelope.type !== INJECT_MESSAGE.produce) return null;
  if (!isProducePayload(envelope.payload)) return null;
  if (filter?.videoId && envelope.payload.videoId !== filter.videoId) return null;
  return envelope as ProduceMessage;
}
