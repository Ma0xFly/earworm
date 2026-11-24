import { describe, expect, it } from 'vitest';
import { matchCollocations, type CollocationEntry } from '@/lib/collocations/matcher';

/** A deterministic stand-in for T5's dictionary-backed `lemmatize`. */
const IRREGULAR: Record<string, string> = {
  gave: 'give',
  given: 'give',
  running: 'run',
  ran: 'run',
  talks: 'talk',
  talked: 'talk',
};

function lemma(surface: string): string {
  return IRREGULAR[surface] ?? surface;
}

function table(...bigrams: string[]): CollocationEntry[] {
  return bigrams.map((text) => ({ text }));
}

describe('matchCollocations', () => {
  it('matches case-insensitively and keeps the original text slice', () => {
    const text = 'Never Give Up.';
    expect(matchCollocations(text, table('give up'), lemma)).toEqual([
      { start: 6, end: 13, text: 'Give Up', source: 'offline' },
    ]);
  });

  it('lemmatizes both the sentence and the table entries', () => {
    const text = 'She gave up smoking last year.';
    const spans = matchCollocations(text, table('give up', 'last year'), lemma);
    expect(spans).toEqual([
      { start: 4, end: 11, text: 'gave up', source: 'offline' },
      { start: 20, end: 29, text: 'last year', source: 'offline' },
    ]);

    // Table entries are normalized too: an inflected table entry still matches.
    expect(matchCollocations('They give up.', table('gave up'), lemma)).toEqual([
      { start: 5, end: 12, text: 'give up', source: 'offline' },
    ]);
  });

  it('does not include trailing punctuation but matches across internal punctuation', () => {
    expect(matchCollocations('They gave up, eventually.', table('give up'), lemma)).toEqual([
      { start: 5, end: 12, text: 'gave up', source: 'offline' },
    ]);
    expect(matchCollocations('Give, up!', table('give up'), lemma)).toEqual([
      { start: 0, end: 8, text: 'Give, up', source: 'offline' },
    ]);
  });

  it('handles curly apostrophes and contractions without splitting words', () => {
    const spans = matchCollocations("Don't give up.", table('give up'), lemma);
    expect(spans).toEqual([{ start: 6, end: 13, text: 'give up', source: 'offline' }]);
    expect(matchCollocations('don’t give up', table("don't give up"), lemma)).toHaveLength(1);
  });

  it('prefers the longest candidate and never returns overlaps', () => {
    const text = 'I put up with it.';
    const spans = matchCollocations(
      text,
      table('put up', 'put up with', 'up with'),
      lemma,
    );
    expect(spans).toEqual([
      { start: 2, end: 13, text: 'put up with', source: 'offline' },
    ]);

    const leftToRight = matchCollocations('give up to him', table('give up', 'up to'), lemma);
    expect(leftToRight).toEqual([
      { start: 0, end: 7, text: 'give up', source: 'offline' },
    ]);
  });

  it('lets a longer later candidate win over an earlier shorter one', () => {
    expect(matchCollocations('a b c d', table('a b', 'b c d'), lemma)).toEqual([
      { start: 2, end: 7, text: 'b c d', source: 'offline' },
    ]);
  });

  it('keeps UTF-16 offsets through astral characters', () => {
    const text = '😀 give up';
    const [span] = matchCollocations(text, table('give up'), lemma);
    expect(span).toEqual({ start: 3, end: 10, text: 'give up', source: 'offline' });
    expect(text.slice(span!.start, span!.end)).toBe(span!.text);
  });

  it('returns an empty list for no matches, an empty table or empty text', () => {
    expect(matchCollocations('nothing here', table('give up'), lemma)).toEqual([]);
    expect(matchCollocations('give up', [], lemma)).toEqual([]);
    expect(matchCollocations('', table('give up'), lemma)).toEqual([]);
  });

  it('ignores empty table entries', () => {
    expect(matchCollocations('give up', table('', '  '), lemma)).toEqual([]);
  });
});
