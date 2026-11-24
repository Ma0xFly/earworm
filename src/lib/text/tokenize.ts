/**
 * English tokenizer for clickable subtitle words.
 *
 * The token stream covers the input exactly:
 * `tokens.map(t => t.text).join('') === text`, and every token's `start`/`end`
 * are UTF-16 offsets into the source string. Word tokens keep internal
 * apostrophes so contractions (`don't`, `I'm`, `rock'n'roll`) are one word,
 * which is what dictionary lookup wants; punctuation and whitespace stay as
 * their own tokens so renderers can preserve spelling exactly.
 */

export type TokenKind = 'word' | 'space' | 'punct';

export type TextToken = {
  text: string;
  /** UTF-16 offset, inclusive. */
  start: number;
  /** UTF-16 offset, exclusive. */
  end: number;
  kind: TokenKind;
};

/** Words: ASCII letters with internal straight/curly apostrophes. */
const WORD_PATTERN = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

function isWhitespace(character: string): boolean {
  return /\s/.test(character);
}

function splitNonWord(chunk: string, offset: number): TextToken[] {
  const tokens: TextToken[] = [];
  let index = 0;
  while (index < chunk.length) {
    const whitespace = isWhitespace(chunk[index] ?? '');
    let end = index + 1;
    while (end < chunk.length && isWhitespace(chunk[end] ?? '') === whitespace) end += 1;
    tokens.push({
      text: chunk.slice(index, end),
      start: offset + index,
      end: offset + end,
      kind: whitespace ? 'space' : 'punct',
    });
    index = end;
  }
  return tokens;
}

/**
 * Split a sentence into word/space/punct tokens. Use `kind === 'word'` (or
 * `isWordToken`) to decide what is clickable.
 */
export function tokenizeWords(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let cursor = 0;
  WORD_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = WORD_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) {
      tokens.push(...splitNonWord(text.slice(cursor, match.index), cursor));
    }
    const end = match.index + match[0].length;
    tokens.push({ text: match[0], start: match.index, end, kind: 'word' });
    cursor = end;
  }
  if (cursor < text.length) {
    tokens.push(...splitNonWord(text.slice(cursor), cursor));
  }
  return tokens;
}

/** Alias kept for callers that only think of "tokenizing a sentence". */
export const tokenize = tokenizeWords;

export function isWordToken(token: TextToken): boolean {
  return token.kind === 'word';
}

/** Only the clickable word tokens, in sentence order. */
export function wordTokens(text: string): TextToken[] {
  return tokenizeWords(text).filter(isWordToken);
}

/**
 * Normalize a surface form for dictionary lookup: lowercase and unify curly
 * apostrophes. Punctuation trimming is intentionally left to the dictionary
 * layer (it may need to keep internal apostrophes/hyphens).
 */
export function normalizeWord(word: string): string {
  return word.trim().toLowerCase().replace(/’/g, "'");
}
