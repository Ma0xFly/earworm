import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchCollocations, type CollocationEntry } from '@/lib/collocations';
import { isCleanBigram } from '../scripts/build-collocations';

const artifactPath = path.resolve(process.cwd(), 'public/data/collocations.json');
const raw = readFileSync(artifactPath, 'utf8');
const file = JSON.parse(raw) as {
  meta: {
    schema: number;
    version: string;
    count: number;
    source: string;
    license: string;
    attribution: string;
    filter: string;
    sourceRows: number;
    cleanedRows: number;
    filteredRows: number;
    rejected: { nonAscii: number; digit: number; markup: number };
  };
  bigrams: string[];
};

const table: CollocationEntry[] = file.bigrams.map((text) => ({ text }));

const IRREGULAR: Record<string, string> = { gave: 'give', ran: 'run' };
const lemma = (surface: string): string => IRREGULAR[surface] ?? surface;

describe('public/data/collocations.json', () => {
  it('ships the measured 9,289 unique bigrams under 1 MB', () => {
    expect(file.meta.schema).toBe(1);
    expect(file.meta.count).toBe(9_289);
    expect(file.bigrams).toHaveLength(9_289);
    expect(new Set(file.bigrams).size).toBe(9_289);
    expect(statSync(artifactPath).size).toBeLessThan(1_048_576);
    expect(file.meta.version).toMatch(/^collocations-[0-9a-f]{16}$/);
  });

  it('records provenance, license, filter parameters and cleaning counts', () => {
    expect(file.meta.source).toBe('opensubs-collocations');
    expect(file.meta.license).toBe('CC-BY-4.0');
    expect(file.meta.attribution).toContain('Lison & Tiedemann 2016');
    expect(file.meta.filter).toBe('npmi >= 0.35 or count >= 1000');
    expect(file.meta.sourceRows).toBe(15_000);
    expect(file.meta.cleanedRows).toBe(14_866);
    expect(file.meta.filteredRows).toBe(9_296);
    expect(file.meta.rejected).toEqual({ nonAscii: 55, digit: 78, markup: 1 });
  });

  it('only contains bigrams accepted by the cleaner', () => {
    expect(file.bigrams.filter((bigram) => !isCleanBigram(bigram))).toEqual([]);
    expect(file.bigrams.every((bigram) => bigram.trim() === bigram)).toBe(true);
  });

  it('starts with the highest-scoring bigrams and contains the useful phrasal verbs', () => {
    expect(file.bigrams.slice(0, 3)).toEqual(['come on', 'talk about', 'last night']);
    for (const bigram of ['give up', 'run out', 'put up', 'take care', 'human being']) {
      expect(file.bigrams).toContain(bigram);
    }
    for (const absent of ['look forward', 'look up', 'better than']) {
      expect(file.bigrams).not.toContain(absent);
    }
  });

  it('matches real table entries through the matcher', () => {
    expect(matchCollocations('She gave up smoking.', table, lemma)).toEqual([
      { start: 4, end: 11, text: 'gave up', source: 'offline' },
    ]);
    expect(matchCollocations('They ran out of time.', table, lemma)).toEqual([
      { start: 5, end: 12, text: 'ran out', source: 'offline' },
    ]);
    expect(matchCollocations('Just put up with it.', table, lemma)).toEqual([
      { start: 5, end: 11, text: 'put up', source: 'offline' },
    ]);
  });
});
