import { describe, expect, it } from 'vitest';
import {
  alignCollocation,
  extractJsonArray,
  parseTranslationContent,
  ParseError,
} from '@/lib/llm/parse';
import type { TranslateBatchItem } from '@/lib/messages';

const ITEMS: TranslateBatchItem[] = [
  {
    i: 12,
    text: 'She had to hold up the line while I figured it out.',
  },
  {
    i: 13,
    text: 'It turned out that nobody had bothered to write it down.',
  },
];

describe('JSON extraction', () => {
  it('parses a bare JSON array', () => {
    expect(extractJsonArray('[{"i":0,"zh":"你好","cols":[]}]')).toEqual([
      { i: 0, zh: '你好', cols: [] },
    ]);
  });

  it('strips a ```json fence and surrounding chatter', () => {
    const raw = 'Sure, here you go:\n```json\n[{"i":0,"zh":"你好","cols":[]}]\n```\nHope this helps!';
    expect(extractJsonArray(raw)).toEqual([{ i: 0, zh: '你好', cols: [] }]);
  });

  it('strips a bare ``` fence', () => {
    const raw = '```\n[{"i":0,"zh":"你好"}]\n```';
    expect(extractJsonArray(raw)).toEqual([{ i: 0, zh: '你好' }]);
  });

  it('recovers an array embedded in noise without a fence', () => {
    const raw = 'Result: [{"i":0,"zh":"你好","cols":[]}] — done.';
    expect(extractJsonArray(raw)).toEqual([{ i: 0, zh: '你好', cols: [] }]);
  });

  it('rejects non-array output and broken JSON', () => {
    expect(() => extractJsonArray('{"i":0,"zh":"你好"}')).toThrow(ParseError);
    expect(() => extractJsonArray('not json at all')).toThrow(ParseError);
    expect(() => extractJsonArray('[{"i":0,"zh":')).toThrow(ParseError);
    expect(() => extractJsonArray('')).toThrow(ParseError);
  });
});

describe('collocation alignment', () => {
  it('finds a literal substring and computes UTF-16 offsets', () => {
    const sentence = '😀 hold up now';
    const aligned = alignCollocation(sentence, 'hold up');
    expect(aligned).toEqual({ start: 3, end: 10, text: 'hold up' });
    expect(sentence.slice(aligned!.start, aligned!.end)).toBe('hold up');
  });

  it('trims surrounding whitespace from the model span', () => {
    const sentence = 'Please hold up a second.';
    expect(alignCollocation(sentence, '  hold up  ')).toEqual({
      start: 7,
      end: 14,
      text: 'hold up',
    });
  });

  it('falls back to case-insensitive matching and recomputes the span text', () => {
    const sentence = 'Hold up, I said.';
    expect(alignCollocation(sentence, 'hold up')).toEqual({
      start: 0,
      end: 7,
      text: 'Hold up',
    });
  });

  it('returns null for spans that do not occur in the sentence', () => {
    expect(alignCollocation('Nothing to see here.', 'hold up')).toBeNull();
    expect(alignCollocation('Anything', '')).toBeNull();
    expect(alignCollocation('Anything', '   ')).toBeNull();
  });
});

describe('translation response parsing', () => {
  it('validates indices, translations and aligned collocations', () => {
    const raw = JSON.stringify([
      {
        i: 12,
        zh: '她只好先撑着电话，我这边才慢慢想明白。',
        cols: [
          { text: 'hold up', note: '撑住，维持' },
          { text: 'figured it out', note: '想明白了' },
          { text: 'not in the sentence', note: '应当丢弃' },
        ],
      },
      {
        i: 13,
        zh: '结果发现根本没人愿意把它写下来。',
        cols: [{ text: 'write it down', note: '写下来' }],
      },
    ]);

    const parsed = parseTranslationContent(raw, ITEMS);
    expect(parsed.failed).toEqual([]);
    expect(parsed.results).toHaveLength(2);

    const first = parsed.results[0]!;
    expect(first.i).toBe(12);
    expect(first.zh).toContain('撑着电话');
    expect(first.cols?.map((span) => span.text)).toEqual(['hold up', 'figured it out']);
    const holdUp = first.cols![0]!;
    expect(ITEMS[0]!.text.slice(holdUp.start, holdUp.end)).toBe('hold up');
    const figured = first.cols![1]!;
    expect(ITEMS[0]!.text.slice(figured.start, figured.end)).toBe('figured it out');

    const second = parsed.results[1]!;
    expect(second.cols?.[0]).toMatchObject({ text: 'write it down' });
    expect(ITEMS[1]!.text.slice(second.cols![0]!.start, second.cols![0]!.end)).toBe(
      'write it down',
    );
  });

  it('marks a sentence with missing or empty zh as failed but keeps the rest', () => {
    const raw = JSON.stringify([
      { i: 12, zh: '第一句。', cols: [] },
      { i: 13, zh: '   ', cols: [{ text: 'turned out' }] },
    ]);
    const parsed = parseTranslationContent(raw, ITEMS);
    expect(parsed.failed).toEqual([13]);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0]).toMatchObject({ i: 12, zh: '第一句。' });
    expect(parsed.results[1]).toMatchObject({ i: 13, cols: [] });
    expect(parsed.results[1]?.zh).toBeUndefined();
  });

  it('ignores unknown indices, duplicate indices and missing sentences', () => {
    const raw = JSON.stringify([
      { i: 999, zh: '不在这一批。', cols: [] },
      { i: 12, zh: '第一次出现。', cols: [] },
      { i: 12, zh: '重复出现。', cols: [] },
    ]);
    const parsed = parseTranslationContent(raw, ITEMS);
    expect(parsed.results.map((result) => result.zh)).toEqual(['第一次出现。', undefined]);
    expect(parsed.failed).toEqual([13]);
  });

  it('drops malformed collocations without losing the translation', () => {
    const raw = JSON.stringify([
      {
        i: 12,
        zh: '她只好撑着电话。',
        cols: [
          { text: 42, note: 'bad' },
          { text: 'hold up', note: 7 },
          { text: 'hold up' },
          { note: 'missing text' },
          null,
          'nope',
        ],
      },
      { i: 13, zh: '第二句。', cols: 'not-an-array' },
    ]);
    const parsed = parseTranslationContent(raw, ITEMS);
    expect(parsed.failed).toEqual([]);
    expect(parsed.results[0]?.zh).toBe('她只好撑着电话。');
    expect(parsed.results[0]?.cols).toEqual([
      { text: 'hold up', start: 11, end: 18, note: undefined },
    ]);
    expect(parsed.results[1]?.cols).toEqual([]);
  });

  it('deduplicates identical aligned spans', () => {
    const raw = JSON.stringify([
      {
        i: 12,
        zh: '她只好撑着电话。',
        cols: [{ text: 'hold up' }, { text: 'hold up' }],
      },
    ]);
    const parsed = parseTranslationContent(raw, [ITEMS[0]!]);
    expect(parsed.results[0]?.cols).toHaveLength(1);
  });

  it('throws when the array contains no usable translation at all', () => {
    expect(() => parseTranslationContent('[]', ITEMS)).toThrow(ParseError);
    expect(() =>
      parseTranslationContent('[{"i":12,"zh":""},{"i":13}]', ITEMS),
    ).toThrow(ParseError);
  });

  it('returns an empty result for an empty batch', () => {
    expect(parseTranslationContent('[]', [])).toEqual({ results: [], failed: [] });
  });
});
