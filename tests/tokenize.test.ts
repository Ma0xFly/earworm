import { describe, expect, it } from 'vitest';
import {
  isWordToken,
  normalizeWord,
  tokenizeWords,
  wordTokens,
} from '@/lib/text/tokenize';

describe('tokenizeWords', () => {
  it('covers the input exactly with contiguous UTF-16 offsets', () => {
    const text = "Don't stop — it's rock'n'roll, okay?";
    const tokens = tokenizeWords(text);
    expect(tokens.map((token) => token.text).join('')).toBe(text);

    let cursor = 0;
    for (const token of tokens) {
      expect(token.start).toBe(cursor);
      expect(token.end).toBe(token.start + token.text.length);
      cursor = token.end;
    }
    expect(cursor).toBe(text.length);
  });

  it('keeps contractions as one word token and separates punctuation', () => {
    const tokens = tokenizeWords("I'm fine, thanks.");
    expect(tokens.map((token) => `${token.kind}:${token.text}`)).toEqual([
      "word:I'm",
      'space: ',
      'word:fine',
      'punct:,',
      'space: ',
      'word:thanks',
      'punct:.',
    ]);
  });

  it('treats curly apostrophes as part of the word', () => {
    const tokens = tokenizeWords('don’t');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.text).toBe('don’t');
    expect(tokens[0]?.kind).toBe('word');
  });

  it('returns no tokens for an empty string and spaces for whitespace', () => {
    expect(tokenizeWords('')).toEqual([]);
    expect(tokenizeWords(' \t\n')).toEqual([
      { text: ' \t\n', start: 0, end: 3, kind: 'space' },
    ]);
  });

  it('exposes word-only helpers', () => {
    expect(wordTokens('one two').map((token) => token.text)).toEqual(['one', 'two']);
    expect(tokenizeWords('hi!').every(isWordToken)).toBe(false);
  });
});

describe('normalizeWord', () => {
  it('lowercases, unifies curly apostrophes and trims', () => {
    expect(normalizeWord('  Don’t ')).toBe("don't");
  });
});
