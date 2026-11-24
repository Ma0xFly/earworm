/**
 * Lemma-aware matching against the offline collocation table.
 *
 * The table is a list of multiword expressions (the shipped table is all
 * bigrams). Both table entries and sentence words are normalized the same way:
 * lowercase, straight apostrophes, then the dictionary's `lemmatize`. Keeping
 * the two sides symmetric also keeps odd lemma decisions consistent — for
 * example `pass -> pas` and `pass through -> pas through` still match.
 *
 * Matching is done on word tokens, never raw strings, so punctuation and
 * spacing can never corrupt offsets. Candidates are accepted longest-first,
 * then left-to-right, and never overlap; `text` is always the original slice.
 */

import type { CollocationSpan } from '@/lib/contracts';
import {
  isWordToken,
  normalizeWord,
  tokenizeWords,
  type TextToken,
} from '@/lib/text/tokenize';

/** One table entry, e.g. `"give up"`. */
export type CollocationEntry = {
  text: string;
  /** Combined rank from the source data; not shipped per-entry today. */
  score?: number;
  /** Source type (`VERB+ADP`, `ADJ+NOUN`, ...); debugging only. */
  type?: string;
};

/** Pre-normalized lookup table; reuse one per table to avoid re-lemmatizing. */
export type CollocationIndex = {
  /** Normalized lemma phrase -> rank in the source table (lower = better). */
  byKey: Map<string, number>;
  /** Longest phrase length, in words. */
  maxTokens: number;
  /** The normalizer the keys were built with; text tokens use the same one. */
  lemmatize: (surface: string) => string;
};

/** Sanity cap so a malformed multiword entry cannot make matching quadratic. */
export const MAX_COLLOCATION_TOKENS = 8;

function lemmaOf(surface: string, lemmatize: (word: string) => string): string {
  const normalized = normalizeWord(surface);
  if (!normalized) return '';
  return normalizeWord(lemmatize(normalized)) || normalized;
}

function entryWords(text: string): TextToken[] {
  return tokenizeWords(text).filter(isWordToken);
}

/**
 * Normalize every table entry once. Entries resolving to the same lemma phrase
 * keep their first (highest-ranked) position; single-word and over-long entries
 * are ignored because a collocation span needs at least two words.
 */
export function buildCollocationIndex(
  table: readonly CollocationEntry[],
  lemmatize: (surface: string) => string,
): CollocationIndex {
  const byKey = new Map<string, number>();
  let maxTokens = 0;

  for (let rank = 0; rank < table.length; rank += 1) {
    const entry = table[rank];
    if (!entry) continue;
    const words = entryWords(entry.text);
    if (words.length < 2 || words.length > MAX_COLLOCATION_TOKENS) continue;

    const key = words
      .map((word) => lemmaOf(word.text, lemmatize))
      .join(' ');
    if (!key || byKey.has(key)) continue;
    byKey.set(key, rank);
    maxTokens = Math.max(maxTokens, words.length);
  }

  return { byKey, maxTokens, lemmatize };
}

type Candidate = {
  start: number;
  end: number;
  tokens: number;
  rank: number;
};

/**
 * Match a sentence against a pre-built index. Returns non-overlapping spans
 * sorted by `start`; `text` is always `sentenceText.slice(start, end)`.
 */
export function matchIndexedCollocations(
  text: string,
  index: CollocationIndex,
): CollocationSpan[] {
  if (!text || index.maxTokens < 2 || index.byKey.size === 0) return [];

  const words = tokenizeWords(text).filter(isWordToken);
  if (words.length < 2) return [];

  const lemmas = words.map((word) => lemmaOf(word.text, index.lemmatize));
  const candidates: Candidate[] = [];

  for (let start = 0; start < words.length - 1; start += 1) {
    const limit = Math.min(index.maxTokens, words.length - start);
    let key = lemmas[start] ?? '';
    for (let length = 2; length <= limit; length += 1) {
      key = `${key} ${lemmas[start + length - 1] ?? ''}`;
      const rank = index.byKey.get(key);
      if (rank === undefined) continue;
      const first = words[start];
      const last = words[start + length - 1];
      if (!first || !last) continue;
      candidates.push({ start: first.start, end: last.end, tokens: length, rank });
    }
  }

  candidates.sort(
    (left, right) =>
      right.tokens - left.tokens ||
      left.start - right.start ||
      left.rank - right.rank ||
      left.end - right.end,
  );

  const accepted: Candidate[] = [];
  for (const candidate of candidates) {
    const overlaps = accepted.some(
      (span) => candidate.start < span.end && span.start < candidate.end,
    );
    if (!overlaps) accepted.push(candidate);
  }

  accepted.sort((left, right) => left.start - right.start);

  return accepted.map((candidate) => ({
    start: candidate.start,
    end: candidate.end,
    text: text.slice(candidate.start, candidate.end),
    source: 'offline' as const,
  }));
}

/**
 * One-shot matcher used by tests and callers that do not cache. Runtime code
 * should build the index once via [`buildCollocationIndex`].
 */
export function matchCollocations(
  text: string,
  table: readonly CollocationEntry[],
  lemmatize: (surface: string) => string,
): CollocationSpan[] {
  return matchIndexedCollocations(text, buildCollocationIndex(table, lemmatize));
}
