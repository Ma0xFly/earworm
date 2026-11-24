import { describe, expect, it } from 'vitest';
import { buildCollocations } from '../scripts/build-collocations';

type Row = {
  lang?: string;
  type?: string;
  bigram: string;
  count?: number;
  pmi?: number;
  npmi?: number;
  score?: number;
};

function row(fields: Row): string {
  return JSON.stringify({
    lang: 'en',
    type: 'VERB+ADP',
    count: 0,
    pmi: 0,
    npmi: 0,
    score: 0,
    ...fields,
  });
}

const SOURCE = [
  row({ bigram: 'give up', count: 21_789, npmi: 0.267, score: 3.85 }),
  row({ bigram: 'give up', type: 'VERB+NOUN', count: 30_000, npmi: 0.2, score: 9 }),
  row({ bigram: 'take off', count: 500, npmi: 0.5, score: 4 }),
  row({ bigram: 'nope', count: 500, npmi: 0.3, score: 8 }),
  row({ bigram: 'café noir', count: 2_000, npmi: 0.9, score: 7 }),
  row({ bigram: '2 fast', count: 2_000, npmi: 0.9, score: 7 }),
  row({ bigram: '\\fad', count: 2_000, npmi: 0.9, score: 7 }),
  row({ bigram: '{\\i}hi', count: 2_000, npmi: 0.9, score: 7 }),
  row({ bigram: 'last night', count: 1_200, npmi: 0.2, score: 5 }),
  row({ bigram: 'human being', count: 10, npmi: 0.4, score: 6 }),
  '',
].join('\n');

describe('buildCollocations', () => {
  it('rejects non-ASCII, digit and ASS-markup bigrams', () => {
    const { meta } = buildCollocations(SOURCE).file;
    expect(meta.rejected).toEqual({ nonAscii: 1, digit: 1, markup: 2 });
    expect(meta.sourceRows).toBe(10);
    expect(meta.cleanedRows).toBe(6);
  });

  it('keeps rows with npmi >= 0.35 or count >= 1000 and dedupes by bigram', () => {
    const { file, stats } = buildCollocations(SOURCE);
    expect(file.meta.filteredRows).toBe(5);
    expect(file.meta.count).toBe(4);
    expect(file.bigrams).toEqual(['give up', 'human being', 'last night', 'take off']);
    expect(stats.uniqueBigrams).toBe(4);
  });

  it('orders bigrams by descending score and keeps the highest-scoring duplicate', () => {
    const { file } = buildCollocations(SOURCE);
    // `give up` appears twice (score 3.85 and 9) and must sort first, once.
    expect(file.bigrams.filter((bigram) => bigram === 'give up')).toHaveLength(1);
    expect(file.bigrams[0]).toBe('give up');
  });

  it('records source, license, attribution and a deterministic content version', () => {
    const first = buildCollocations(SOURCE);
    const second = buildCollocations(SOURCE);
    expect(first.json).toBe(second.json);
    expect(first.file.meta.source).toContain('opensubs');
    expect(first.file.meta.license).toBe('CC-BY-4.0');
    expect(first.file.meta.attribution).toContain('Lison');
    expect(first.file.meta.filter).toContain('npmi');
    expect(first.file.meta.version).toMatch(/^collocations-[0-9a-f]{8,}$/);
    expect(JSON.parse(first.json)).toEqual(first.file);
  });

  it('handles empty and blank input', () => {
    const { file } = buildCollocations('\n\n');
    expect(file.meta.sourceRows).toBe(0);
    expect(file.bigrams).toEqual([]);
  });

  it('rejects malformed JSON lines with their line number', () => {
    expect(() => buildCollocations(`${row({ bigram: 'ok' })}\n{not json}`)).toThrow(/line 2/i);
  });
});
