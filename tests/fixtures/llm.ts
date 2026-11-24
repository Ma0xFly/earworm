import type { LlmSettings, VideoMeta } from '@/lib/contracts';
import type { TranslateBatchItem } from '@/lib/messages';

/** Deterministic fixtures shared by the LLM pipeline tests (no network). */

export const TEST_META: VideoMeta = {
  videoId: 'dQw4w9WgXcQ',
  title: 'How I Learned to Code',
  channel: 'Tech Talks',
};

export const TEST_BATCH: TranslateBatchItem[] = [
  {
    i: 12,
    text: 'I had to figure out how to set up the whole thing from scratch.',
    prev: 'It was a mess at first.',
    next: 'But then it finally clicked.',
  },
  {
    i: 13,
    text: 'It turned out that nobody had bothered to write it down.',
    prev: 'I had to figure out how to set up the whole thing from scratch.',
    next: 'So I started keeping my own notes.',
  },
];

export const TEST_LLM_SETTINGS: LlmSettings = {
  baseUrl: 'http://127.0.0.1:3425/v1',
  apiKey: '',
  model: 'group/free-ds',
};

export const GOOD_CONTENT = JSON.stringify([
  {
    i: 12,
    zh: '一开始我不得不从零摸索怎么把整件事搭起来。',
    cols: [
      { text: 'figure out', note: '弄明白，想出' },
      { text: 'set up', note: '搭建，设置' },
      { text: 'from scratch', note: '从零开始' },
    ],
  },
  {
    i: 13,
    zh: '结果发现根本没人愿意把它写下来。',
    cols: [
      { text: 'turned out', note: '结果是，原来' },
      { text: 'write it down', note: '把它写下来' },
    ],
  },
]);

export const GOOD_RESPONSE = {
  id: 'chatcmpl-test',
  model: 'group/free-ds-2026-01',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: GOOD_CONTENT,
        reasoning_content: 'The user wants a JSON array. I will translate carefully…',
      },
      finish_reason: 'stop',
    },
  ],
};

/** OpenAI-compatible JSON response helper used by fetch mocks. */
export function chatResponse(
  content: string,
  options: { model?: string; reasoning?: string; finishReason?: string } = {},
): Response {
  const body = {
    id: 'chatcmpl-test',
    model: options.model ?? 'group/free-ds',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
          ...(options.reasoning !== undefined ? { reasoning_content: options.reasoning } : {}),
        },
        finish_reason: options.finishReason ?? 'stop',
      },
    ],
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
