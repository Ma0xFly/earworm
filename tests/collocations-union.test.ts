import { describe, expect, it } from 'vitest';
import type { CollocationSpan } from '@/lib/contracts';
import { unionSpans } from '@/lib/collocations/union';

function offline(text: string, start: number, end: number): CollocationSpan {
  return { start, end, text, source: 'offline' };
}

function llm(text: string, start: number, end: number, note?: string): CollocationSpan {
  return { start, end, text, source: 'llm', ...(note ? { note } : {}) };
}

describe('unionSpans', () => {
  it('merges disjoint spans sorted by start and keeps the LLM note', () => {
    const text = 'give up now';
    expect(
      unionSpans([offline('give up', 0, 7)], [llm('now', 8, 11, '现在')]),
    ).toEqual([
      { start: 0, end: 7, text: 'give up', source: 'offline' },
      { start: 8, end: 11, text: 'now', source: 'llm', note: '现在' },
    ]);
    void text;
  });

  it('drops an offline span fully covered by an LLM span', () => {
    expect(
      unionSpans([offline('put up', 0, 7)], [llm('put up with', 0, 13, '忍受')]),
    ).toEqual([{ start: 0, end: 13, text: 'put up with', source: 'llm', note: '忍受' }]);
  });

  it('trims an offline span overlapped at its start, dropping the whitespace', () => {
    expect(unionSpans([offline('give up', 0, 7)], [llm('give', 0, 4)])).toEqual([
      { start: 0, end: 4, text: 'give', source: 'llm' },
      { start: 5, end: 7, text: 'up', source: 'offline' },
    ]);
  });

  it('trims an offline span overlapped at its end', () => {
    expect(unionSpans([offline('give up', 0, 7)], [llm('up', 5, 7)])).toEqual([
      { start: 0, end: 4, text: 'give', source: 'offline' },
      { start: 5, end: 7, text: 'up', source: 'llm' },
    ]);
  });

  it('splits an offline span around an LLM span in its middle', () => {
    expect(
      unionSpans([offline('as well as', 0, 10)], [llm('well', 3, 7, '也')]),
    ).toEqual([
      { start: 0, end: 2, text: 'as', source: 'offline' },
      { start: 3, end: 7, text: 'well', source: 'llm', note: '也' },
      { start: 8, end: 10, text: 'as', source: 'offline' },
    ]);
  });

  it('keeps LLM priority when LLM spans overlap each other', () => {
    expect(
      unionSpans([], [llm('give up', 0, 7), llm('up to', 5, 10)]),
    ).toEqual([{ start: 0, end: 7, text: 'give up', source: 'llm' }]);
  });

  it('never returns overlapping or out-of-order spans', () => {
    const result = unionSpans(
      [offline('give up', 0, 7), offline('up to', 5, 10)],
      [llm('to him', 8, 14)],
    );
    expect(result).toEqual([
      { start: 0, end: 7, text: 'give up', source: 'offline' },
      { start: 8, end: 14, text: 'to him', source: 'llm' },
    ]);
    for (let index = 1; index < result.length; index += 1) {
      expect(result[index]!.start).toBeGreaterThanOrEqual(result[index - 1]!.end);
    }
  });

  it('returns an empty list for empty inputs', () => {
    expect(unionSpans([], [])).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const offlineInput = [offline('give up', 0, 7)];
    const llmInput = [llm('give', 0, 4)];
    unionSpans(offlineInput, llmInput);
    expect(offlineInput).toEqual([{ start: 0, end: 7, text: 'give up', source: 'offline' }]);
    expect(llmInput).toEqual([{ start: 0, end: 4, text: 'give', source: 'llm' }]);
  });
});
