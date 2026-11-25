import type {
  CachedTranslation,
  Cue,
  CueTrackKind,
  LlmSentenceResult,
  LlmSettings,
  VideoMeta,
} from './contracts';
import type { TranscriptFailureReason } from './transcript';
import { isValidCachedTranslation } from './cached-translation';
import { isRecord } from './utils/is-record';
import { errorMessage } from './utils/error';

/* -------------------------------------------------------------------------- */
/* inject (MAIN world) ↔ content (isolated world), window.postMessage bridge   */
/* -------------------------------------------------------------------------- */

/** Envelope marker; both sides validate it before acting on a message. */
export type InjectDirection = 'inject-to-content' | 'content-to-inject';

export type InjectEnvelope<TPayload = unknown> = {
  __earworm: true;
  dir: InjectDirection;
  type: string;
  payload: TPayload;
};

export const INJECT_MESSAGE = {
  cuesReady: 'earworm:cues-ready',
  cuesFailed: 'earworm:cues-failed',
  produce: 'earworm:produce',
} as const;

export type InjectMessageType = (typeof INJECT_MESSAGE)[keyof typeof INJECT_MESSAGE];

export type CuesReadyPayload = {
  videoId: string;
  lang: string;
  kind: CueTrackKind;
  cues: Cue[];
};

export type CuesFailedPayload = {
  videoId: string;
  reason: TranscriptFailureReason;
};

export type ProducePayload = {
  videoId: string;
  force?: boolean;
};

export function isInjectEnvelope(value: unknown): value is InjectEnvelope {
  if (!isRecord(value)) return false;
  return (
    value.__earworm === true &&
    (value.dir === 'inject-to-content' || value.dir === 'content-to-inject') &&
    typeof value.type === 'string' &&
    value.type.length > 0 &&
    'payload' in value
  );
}

export function createInjectEnvelope<T>(
  dir: InjectDirection,
  type: InjectMessageType | string,
  payload: T,
): InjectEnvelope<T> {
  return { __earworm: true, dir, type, payload };
}

/**
 * Post one bridge envelope. `targetOrigin` is `*` on purpose: the bridge only
 * runs on the YouTube origin and both sides validate marker, direction,
 * message type and videoId before acting.
 */
export function postInjectMessage<T>(
  dir: InjectDirection,
  type: InjectMessageType | string,
  payload: T,
  target: Window = window,
): void {
  target.postMessage(createInjectEnvelope(dir, type, payload), '*');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isCue(value: unknown): value is Cue {
  if (!isRecord(value)) return false;
  return (
    typeof value.start === 'number' &&
    Number.isFinite(value.start) &&
    typeof value.end === 'number' &&
    Number.isFinite(value.end) &&
    typeof value.text === 'string'
  );
}

export function isCuesReadyPayload(value: unknown): value is CuesReadyPayload {
  if (!isRecord(value)) return false;
  return (
    typeof value.videoId === 'string' &&
    value.videoId.length > 0 &&
    typeof value.lang === 'string' &&
    (value.kind === 'manual' || value.kind === 'asr') &&
    Array.isArray(value.cues) &&
    value.cues.every(isCue)
  );
}

const FAILURE_REASONS: readonly TranscriptFailureReason[] = [
  'no-captions',
  'nudge-failed',
  'timeout',
  'http',
];

export function isCuesFailedPayload(value: unknown): value is CuesFailedPayload {
  if (!isRecord(value)) return false;
  return (
    typeof value.videoId === 'string' &&
    value.videoId.length > 0 &&
    typeof value.reason === 'string' &&
    (FAILURE_REASONS as readonly string[]).includes(value.reason)
  );
}

export function isProducePayload(value: unknown): value is ProducePayload {
  if (!isRecord(value)) return false;
  return (
    typeof value.videoId === 'string' &&
    value.videoId.length > 0 &&
    (value.force === undefined || typeof value.force === 'boolean')
  );
}

/* -------------------------------------------------------------------------- */
/* content ↔ background, chrome.runtime.sendMessage                            */
/* -------------------------------------------------------------------------- */

export type GetCachedRequest = {
  type: 'earworm:get-cached';
  videoId: string;
  cuesHash: string;
};

export type GetCachedResponse =
  | { hit: true; data: CachedTranslation }
  | { hit: false };

export type TranslateBatchItem = {
  i: number;
  text: string;
  prev?: string;
  next?: string;
};

export type TranslateBatchRequest = {
  type: 'earworm:translate-batch';
  videoId: string;
  cuesHash: string;
  meta: VideoMeta;
  batch: TranslateBatchItem[];
  batchIndex: number;
  batchCount: number;
};

export type TranslateBatchResponse =
  | { ok: true; results: LlmSentenceResult[]; model: string }
  | { ok: false; error: string };

export type CommitRequest = {
  type: 'earworm:commit';
  videoId: string;
  cuesHash: string;
  data: CachedTranslation;
};

export type CommitResponse = { ok: true };

export type TestLlmRequest = {
  type: 'earworm:test-llm';
  llm: LlmSettings;
};

export type TestLlmResponse = { ok: boolean; error?: string; sample?: string };

export type ClearCacheRequest = { type: 'earworm:clear-cache' };

export type ClearCacheResponse = { ok: true };

/**
 * Read one shipped data asset through the service worker.
 *
 * The isolated content world cannot fetch `chrome-extension://` URLs on
 * youtube.com (Chrome rejects the cross-origin request), but the service
 * worker can. Paths are restricted to our own `data/*.json` bundle.
 */
export type FetchDataRequest = {
  type: 'earworm:fetch-data';
  path: string;
};

export type FetchDataResponse =
  | { ok: true; text: string }
  | { ok: false; error: string };

export type RuntimeRequest =
  | GetCachedRequest
  | TranslateBatchRequest
  | CommitRequest
  | TestLlmRequest
  | ClearCacheRequest
  | FetchDataRequest;

export type RuntimeResponse =
  | GetCachedResponse
  | TranslateBatchResponse
  | CommitResponse
  | TestLlmResponse
  | ClearCacheResponse
  | FetchDataResponse;

/** Only the shipped JSON assets may be read through the background. */
export const DATA_ASSET_PATH_PATTERN = /^data\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

export function isDataAssetPath(value: unknown): value is string {
  return typeof value === 'string' && DATA_ASSET_PATH_PATTERN.test(value);
}

export type RuntimeRequestType = RuntimeRequest['type'];

const RUNTIME_REQUEST_TYPES: readonly RuntimeRequestType[] = [
  'earworm:get-cached',
  'earworm:translate-batch',
  'earworm:commit',
  'earworm:test-llm',
  'earworm:clear-cache',
  'earworm:fetch-data',
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isLlmSettings(value: unknown): value is LlmSettings {
  if (!isRecord(value)) return false;
  return (
    typeof value.baseUrl === 'string' &&
    typeof value.apiKey === 'string' &&
    typeof value.model === 'string'
  );
}

function isVideoMeta(value: unknown): value is VideoMeta {
  if (!isRecord(value)) return false;
  return (
    typeof value.videoId === 'string' &&
    typeof value.title === 'string' &&
    typeof value.channel === 'string'
  );
}


function isTranslateBatchItem(value: unknown): value is TranslateBatchItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.i === 'number' &&
    Number.isInteger(value.i) &&
    value.i >= 0 &&
    typeof value.text === 'string' &&
    (value.prev === undefined || typeof value.prev === 'string') &&
    (value.next === undefined || typeof value.next === 'string')
  );
}

/** Runtime validator for every `earworm:*` chrome.runtime request. */
export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!isRecord(value)) return false;
  const type = value.type;
  if (typeof type !== 'string') return false;
  if (!(RUNTIME_REQUEST_TYPES as readonly string[]).includes(type)) return false;

  switch (type as RuntimeRequestType) {
    case 'earworm:get-cached':
      return isNonEmptyString(value.videoId) && typeof value.cuesHash === 'string';
    case 'earworm:translate-batch':
      return (
        isNonEmptyString(value.videoId) &&
        typeof value.cuesHash === 'string' &&
        isVideoMeta(value.meta) &&
        Array.isArray(value.batch) &&
        value.batch.every(isTranslateBatchItem) &&
        typeof value.batchIndex === 'number' &&
        Number.isInteger(value.batchIndex) &&
        typeof value.batchCount === 'number' &&
        Number.isInteger(value.batchCount)
      );
    case 'earworm:commit':
      return (
        isNonEmptyString(value.videoId) &&
        typeof value.cuesHash === 'string' &&
        isValidCachedTranslation(value.data)
      );
    case 'earworm:test-llm':
      return isLlmSettings(value.llm);
    case 'earworm:clear-cache':
      return true;
    case 'earworm:fetch-data':
      return isDataAssetPath(value.path);
    default:
      return false;
  }
}

/** Promise wrapper around `chrome.runtime.sendMessage`. */
export function sendRuntimeMessage<TResponse = RuntimeResponse>(
  request: RuntimeRequest,
): Promise<TResponse> {
  return chrome.runtime.sendMessage(request) as Promise<TResponse>;
}

/* -------------------------------------------------------------------------- */
/* background message router                                                   */
/* -------------------------------------------------------------------------- */

export type RuntimeHandler = (
  request: RuntimeRequest,
  sender: chrome.runtime.MessageSender,
) => unknown | Promise<unknown>;

export interface MessageRouter {
  /** Register (or replace) the handler for one message type. */
  register(type: RuntimeRequestType, handler: RuntimeHandler): () => void;
  /**
   * Validate and dispatch a message. Resolves `undefined` for messages that do
   * not belong to Earworm; unknown Earworm types resolve to `{ok:false}`.
   */
  dispatch(
    message: unknown,
    sender?: chrome.runtime.MessageSender,
  ): Promise<unknown | undefined>;
  has(type: RuntimeRequestType): boolean;
}

export function createMessageRouter(): MessageRouter {
  const handlers = new Map<RuntimeRequestType, RuntimeHandler>();

  return {
    register(type, handler) {
      handlers.set(type, handler);
      return () => {
        if (handlers.get(type) === handler) handlers.delete(type);
      };
    },
    has(type) {
      return handlers.has(type);
    },
    async dispatch(message, sender) {
      if (!isRuntimeRequest(message)) return undefined;
      const handler = handlers.get(message.type);
      if (!handler) {
        return { ok: false, error: `No handler registered for ${message.type}` };
      }
      try {
        return await handler(message, sender ?? ({} as chrome.runtime.MessageSender));
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
  };
}
