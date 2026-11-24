import { describe, expect, it, vi } from 'vitest';
import type { LlmSettings } from '@/lib/contracts';
import {
  chatCompletionsUrl,
  LlmError,
  requestChatCompletion,
  type FetchLike,
} from '@/lib/llm/client';
import {
  buildPromptMessages,
  type ChatMessage,
} from '@/lib/llm/prompt';
import { chatResponse, TEST_BATCH, TEST_LLM_SETTINGS, TEST_META } from './fixtures/llm';

const MESSAGES: ChatMessage[] = buildPromptMessages(TEST_META, [TEST_BATCH[0]!]);

function fetchReturning(response: Response): { fetchImpl: FetchLike; mock: ReturnType<typeof vi.fn> } {
  const mock = vi.fn(async () => response);
  return { fetchImpl: mock as unknown as FetchLike, mock };
}

function bodyOf(mock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = mock.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

function headersOf(mock: ReturnType<typeof vi.fn>): Record<string, string> {
  const init = mock.mock.calls[0]?.[1] as RequestInit;
  return init.headers as Record<string, string>;
}

describe('chat completion client', () => {
  it('posts the required body to /chat/completions', async () => {
    const { fetchImpl, mock } = fetchReturning(chatResponse('[]'));
    await requestChatCompletion({ settings: TEST_LLM_SETTINGS, messages: MESSAGES, fetchImpl });

    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3425/v1/chat/completions');
    const init = mock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(headersOf(mock)['Content-Type']).toBe('application/json');
    expect(headersOf(mock).Authorization).toBeUndefined();
    expect(bodyOf(mock)).toMatchObject({
      model: 'group/free-ds',
      messages: MESSAGES,
      temperature: 0.2,
      max_tokens: 8000,
      reasoning_effort: 'none',
      stream: false,
    });
  });

  it('sends a bearer token only when an API key is configured', async () => {
    const settings: LlmSettings = { ...TEST_LLM_SETTINGS, apiKey: 'sk-secret' };
    const { fetchImpl, mock } = fetchReturning(chatResponse('[]'));
    await requestChatCompletion({ settings, messages: MESSAGES, fetchImpl });
    expect(headersOf(mock).Authorization).toBe('Bearer sk-secret');
  });

  it('normalises a trailing slash and an already-complete endpoint', () => {
    expect(chatCompletionsUrl('http://127.0.0.1:3425/v1/')).toBe(
      'http://127.0.0.1:3425/v1/chat/completions',
    );
    expect(chatCompletionsUrl('http://127.0.0.1:3425/v1/chat/completions')).toBe(
      'http://127.0.0.1:3425/v1/chat/completions',
    );
    expect(chatCompletionsUrl('https://api.example.com/v1')).toBe(
      'https://api.example.com/v1/chat/completions',
    );
  });

  it('returns message content and ignores reasoning_content', async () => {
    const { fetchImpl } = fetchReturning(
      chatResponse('[{"i":0,"zh":"你好"}]', {
        reasoning: 'step by step reasoning that must not leak',
        model: 'group/free-ds-2026-01',
      }),
    );
    const result = await requestChatCompletion({
      settings: TEST_LLM_SETTINGS,
      messages: MESSAGES,
      fetchImpl,
    });
    expect(result).toEqual({
      content: '[{"i":0,"zh":"你好"}]',
      model: 'group/free-ds-2026-01',
    });
  });

  it('joins content-part arrays', async () => {
    const response = new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [
                { type: 'text', text: 'hello ' },
                { type: 'text', text: 'world' },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    const { fetchImpl } = fetchReturning(response);
    const result = await requestChatCompletion({
      settings: TEST_LLM_SETTINGS,
      messages: MESSAGES,
      fetchImpl,
    });
    expect(result.content).toBe('hello world');
  });

  it('treats reasoning-only content as a retryable shape error', async () => {
    const { fetchImpl } = fetchReturning(
      chatResponse('', { reasoning: 'I thought about it for 8000 tokens.' }),
    );
    const error = await requestChatCompletion({
      settings: TEST_LLM_SETTINGS,
      messages: MESSAGES,
      fetchImpl,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).retryable).toBe(true);
    expect((error as Error).message).toMatch(/reasoning/i);
  });

  it('marks 5xx responses retryable and 4xx responses terminal', async () => {
    const serverError = await requestChatCompletion({
      settings: TEST_LLM_SETTINGS,
      messages: MESSAGES,
      fetchImpl: fetchReturning(new Response('boom', { status: 503 })).fetchImpl,
    }).catch((caught: unknown) => caught);
    expect(serverError).toBeInstanceOf(LlmError);
    expect((serverError as LlmError).retryable).toBe(true);
    expect((serverError as LlmError).status).toBe(503);
    expect((serverError as Error).message).toContain('503');

    const authError = await requestChatCompletion({
      settings: TEST_LLM_SETTINGS,
      messages: MESSAGES,
      fetchImpl: fetchReturning(new Response('bad key', { status: 401 })).fetchImpl,
    }).catch((caught: unknown) => caught);
    expect(authError).toBeInstanceOf(LlmError);
    expect((authError as LlmError).retryable).toBe(false);
    expect((authError as LlmError).status).toBe(401);
  });

  it('marks an unparseable response body retryable', async () => {
    const { fetchImpl } = fetchReturning(new Response('<html>login</html>', { status: 200 }));
    const error = await requestChatCompletion({
      settings: TEST_LLM_SETTINGS,
      messages: MESSAGES,
      fetchImpl,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).retryable).toBe(true);
  });

  it('wraps network failures as retryable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as FetchLike;
    const error = await requestChatCompletion({
      settings: TEST_LLM_SETTINGS,
      messages: MESSAGES,
      fetchImpl,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).retryable).toBe(true);
    expect((error as Error).message).toMatch(/network/i);
  });

  it('aborts a hung request after the timeout and reports it retryable', async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    ) as unknown as FetchLike;

    const started = Date.now();
    const error = await requestChatCompletion({
      settings: TEST_LLM_SETTINGS,
      messages: MESSAGES,
      fetchImpl,
      timeoutMs: 10,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).retryable).toBe(true);
    expect((error as Error).message).toMatch(/timed out/i);
    expect(Date.now() - started).toBeGreaterThanOrEqual(5);
  });
});
