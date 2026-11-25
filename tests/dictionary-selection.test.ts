import { describe, expect, it } from 'vitest';
import type { CollocationSpan } from '@/lib/contracts';
import { findCollocationAtOffset } from '@/features/dictionary/selection';

const offline: CollocationSpan = {
  start: 10,
  end: 17,
  text: 'hold up',
  source: 'offline',
};
const llm: CollocationSpan = {
  start: 10,
  end: 17,
  text: 'hold up',
  source: 'llm',
  note: '坚持住；支撑',
};

describe('findCollocationAtOffset', () => {
  it('returns the span that contains the clicked UTF-16 offset', () => {
    expect(findCollocationAtOffset([offline], 10)).toBe(offline);
    expect(findCollocationAtOffset([offline], 13)).toBe(offline);
    expect(findCollocationAtOffset([offline], 16)).toBe(offline);
  });

  it('treats the end offset as exclusive and ignores gaps', () => {
    expect(findCollocationAtOffset([offline], 9)).toBeNull();
    expect(findCollocationAtOffset([offline], 17)).toBeNull();
    expect(findCollocationAtOffset([], 10)).toBeNull();
    expect(findCollocationAtOffset(undefined, 10)).toBeNull();
  });

  it('prefers an LLM span over an overlapping offline span regardless of order', () => {
    expect(findCollocationAtOffset([offline, llm], 12)).toBe(llm);
    expect(findCollocationAtOffset([llm, offline], 12)).toBe(llm);
  });

  it('prefers the LLM span that carries a note over a bare LLM span', () => {
    const bare: CollocationSpan = {
      start: 10,
      end: 17,
      text: 'hold up',
      source: 'llm',
    };
    expect(findCollocationAtOffset([bare, llm], 12)).toBe(llm);
  });

  it('prefers the shorter (more specific) span when source and note are equal', () => {
    const short: CollocationSpan = {
      start: 10,
      end: 14,
      text: 'hold',
      source: 'llm',
    };
    const long: CollocationSpan = {
      start: 10,
      end: 17,
      text: 'hold up',
      source: 'llm',
    };
    expect(findCollocationAtOffset([long, short], 12)).toBe(short);
  });
});
