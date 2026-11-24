/**
 * Adapted for Earworm (MIT) from Gythiro/yt-dual-subs (MIT) — Copyright (c) 2026 Gythiro.
 * Upstream: https://github.com/Gythiro/yt-dual-subs (v3.7.0: background.js retry/timeout policy).
 * Full upstream MIT permission text: see NOTICE.
 */

import type { LlmSettings, VideoMeta } from '@/lib/contracts';
import type {
  TranslateBatchItem,
  TranslateBatchResponse,
} from '@/lib/messages';
import {
  LlmError,
  requestChatCompletion,
  REQUEST_TIMEOUT_MS,
  type FetchLike,
} from './client';
import { parseTranslationContent, ParseError } from './parse';
import { buildPromptMessages } from './prompt';

/**
 * Batch sizing and the one-retry translation policy.
 *
 * The content script owns the queue and splits a video into batches; these
 * helpers are shared so both sides agree on the 30-50 sentence window.
 */

export const DEFAULT_BATCH_SIZE = 40;
export const MIN_BATCH_SIZE = 30;
export const MAX_BATCH_SIZE = 50;
export const BATCH_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
export const MAX_ATTEMPTS = 2;

/** Clamp a caller-provided batch size into the supported 30-50 window. */
export function normalizeBatchSize(size?: number): number {
  if (size === undefined || !Number.isFinite(size)) return DEFAULT_BATCH_SIZE;
  return Math.min(MAX_BATCH_SIZE, Math.max(MIN_BATCH_SIZE, Math.trunc(size)));
}

/** Split items into consecutive batches (default 40, never more than 50). */
export function chunkBatchItems<T>(items: readonly T[], size?: number): T[][] {
  const batchSize = normalizeBatchSize(size);
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += batchSize) {
    batches.push(items.slice(start, start + batchSize));
  }
  return batches;
}

export type TranslateBatchOptions = {
  meta: VideoMeta;
  items: readonly TranslateBatchItem[];
  settings: LlmSettings;
  fetchImpl?: FetchLike;
  /** Override for tests; production uses the 120 s batch timeout. */
  timeoutMs?: number;
};

function isRetryable(error: unknown): boolean {
  if (error instanceof LlmError) return error.retryable;
  if (error instanceof ParseError) return true;
  return false;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}

/**
 * Translate one batch with exactly one retry on transient failures
 * (network, 5xx, timeout, unparseable/invalid model output).
 *
 * A valid response that merely lacks some translations still resolves
 * `ok:true`: those sentences appear in `results` without `zh` so the content
 * side can mark just them failed. Only a request/parse failure fails the
 * whole batch.
 */
export async function translateBatch(
  options: TranslateBatchOptions,
): Promise<TranslateBatchResponse> {
  const { meta, items, settings, fetchImpl, timeoutMs = BATCH_TIMEOUT_MS } = options;

  if (items.length === 0) {
    return { ok: true, results: [], model: settings.model };
  }
  if (items.length > MAX_BATCH_SIZE) {
    return {
      ok: false,
      error: `Batch size ${items.length} exceeds the maximum of ${MAX_BATCH_SIZE} sentences`,
    };
  }

  const messages = buildPromptMessages(meta, items);
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const { content, model } = await requestChatCompletion({
        settings,
        messages,
        timeoutMs,
        fetchImpl,
      });
      const parsed = parseTranslationContent(content, items);
      return { ok: true, results: parsed.results, model };
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt >= MAX_ATTEMPTS) break;
    }
  }

  return { ok: false, error: errorMessage(lastError) };
}
