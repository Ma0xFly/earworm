import { describe, expect, it } from 'vitest';
import type { CollocationSpan, LearningSentence, Sentence } from '@/lib/contracts';
import { applyCachedSentence, applyLlmResult } from './pipeline';

function sentence(overrides: Partial<LearningSentence> = {}): LearningSentence {
  const base: Sentence = {
    id: 0,
    start: 0,
    end: 2,
    text: 'Never give up.',
    cueStart: 0,
    cueEnd: 0,
  };
  return { ...base, cols: [], status: 'pending', ...overrides };
}

const offline: CollocationSpan[] = [
  { start: 6, end: 13, text: 'give up', source: 'offline' },
];

describe('sentence translation merging', () => {
  it('keeps the translation and unions aligned LLM spans over offline spans', () => {
    const result = applyLlmResult(offline, sentence(), {
      i: 0,
      zh: ' 永不放弃。 ',
      cols: [{ text: 'give up', note: '放弃' }],
    });

    expect(result).toMatchObject({ zh: '永不放弃。', status: 'done' });
    expect(result.cols).toEqual([{ start: 6, end: 13, text: 'give up', source: 'llm', note: '放弃' }]);
  });

  it('treats an empty LLM line as a failure and does not overwrite a done sentence', () => {
    const failed = applyLlmResult(offline, sentence(), { i: 0, zh: '   ' });
    expect(failed).toMatchObject({ status: 'failed' });
    expect(failed.zh).toBeUndefined();

    const done = sentence({ status: 'done', zh: '旧译文' });
    expect(applyLlmResult(offline, done, { i: 0, zh: '' })).toBe(done);
  });

  it('applies cached rows with the same rules as live LLM results', () => {
    const cached = applyCachedSentence(offline, sentence(), ' 你好。 ', [
      { text: 'give up', note: '放弃' },
    ]);
    expect(cached).toMatchObject({ zh: '你好。', status: 'done' });
    expect(cached.cols).toEqual([
      { start: 6, end: 13, text: 'give up', source: 'llm', note: '放弃' },
    ]);

    expect(applyCachedSentence(offline, sentence(), undefined, undefined)).toMatchObject({
      status: 'failed',
    });
    const done = sentence({ status: 'done', zh: '已有译文' });
    expect(applyCachedSentence(offline, done, '', [])).toBe(done);
  });

  it('drops cached spans that do not literally occur in the sentence', () => {
    const cached = applyCachedSentence(offline, sentence(), '你好。', [
      { text: 'not here', note: '不存在' },
    ]);
    expect(cached.cols).toEqual(offline);
  });
});
