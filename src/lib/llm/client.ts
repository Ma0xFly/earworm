/**
 * Adapted for Earworm (MIT) from Gythiro/yt-dual-subs (MIT) — Copyright (c) 2026 Gythiro.
 * Upstream: https://github.com/Gythiro/yt-dual-subs (v3.7.0: background.js translation channel).
 * Full upstream MIT permission text: see NOTICE.
 */

import type { LlmSettings } from '@/lib/contracts';
import type { ChatMessage } from './prompt';

/**
 * Tiny OpenAI-compatible chat-completions client for the background worker.
 *
 * One call = one HTTP request (no retry here); `batch.ts` owns the retry
 * policy. Every failure is surfaced as `LlmError` with a `retryable` flag so
 * the caller can distinguish a transient network/5xx/timeout/parse problem
 * from a terminal 4xx.
 */

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export const DEFAULT_MAX_TOKENS = 8000;
export const DEFAULT_TEMPERATURE = 0.2;
export const REQUEST_TIMEOUT_MS = 120_000;

export class LlmError extends Error {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, options: { retryable: boolean; status?: number }) {
    super(message);
    this.name = 'LlmError';
    this.retryable = options.retryable;
    if (options.status !== undefined) this.status = options.status;
  }
}

export type ChatCompletionOptions = {
  settings: LlmSettings;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
};

export type ChatCompletionResult = { content: string; model: string };

/** Resolve a settings base URL to the chat-completions endpoint. */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part === 'object' && part !== null) {
        const text = (part as { text?: unknown }).text;
        if (typeof text === 'string') return text;
      }
      return '';
    })
    .join('');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Perform one chat completion. `max_tokens`, `temperature` and
 * `reasoning_effort: "none"` are sent explicitly because the default endpoint
 * (magpie `group/free-ds`) is a reasoning model that returns an empty
 * `content` unless reasoning is disabled and the token budget is generous.
 */
export async function requestChatCompletion(
  options: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  const {
    settings,
    messages,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = DEFAULT_TEMPERATURE,
    timeoutMs = REQUEST_TIMEOUT_MS,
    fetchImpl = fetch,
  } = options;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = settings.apiKey.trim();
  if (apiKey.length > 0) headers.Authorization = `Bearer ${apiKey}`;

  const body = {
    model: settings.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    reasoning_effort: 'none',
    stream: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetchImpl(chatCompletionsUrl(settings.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LlmError(`Request timed out after ${timeoutMs} ms`, { retryable: true });
      }
      throw new LlmError(`Network error: ${errorText(error)}`, { retryable: true });
    }

    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 300).trim();
      } catch {
        // The status alone is enough; never mask it with a body-read failure.
      }
      throw new LlmError(
        `HTTP ${response.status}${detail.length > 0 ? `: ${detail}` : ''}`,
        { retryable: response.status >= 500, status: response.status },
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new LlmError('Response body is not valid JSON', { retryable: true });
    }

    const record =
      typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    const choices = Array.isArray(record.choices) ? record.choices : [];
    const first = choices[0];
    const message =
      typeof first === 'object' && first !== null
        ? ((first as { message?: unknown }).message as Record<string, unknown> | undefined)
        : undefined;
    const content = contentText(message?.content);

    if (content.trim().length === 0) {
      const reasoning = message?.reasoning_content;
      throw new LlmError(
        typeof reasoning === 'string' && reasoning.trim().length > 0
          ? 'Model returned reasoning_content without content (raise max_tokens or set reasoning_effort to none)'
          : 'Model returned empty content',
        { retryable: true },
      );
    }

    const servedModel =
      typeof record.model === 'string' && record.model.length > 0
        ? record.model
        : settings.model;

    return { content, model: servedModel };
  } finally {
    clearTimeout(timer);
  }
}
