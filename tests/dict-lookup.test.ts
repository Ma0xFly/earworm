import { beforeEach, describe, expect, it } from 'vitest';
import type { EcdictFile, LemmaFile } from '@/lib/dict/db';
import { createDictionary } from '@/lib/dict/import';
import {
  getActiveDictionary,
  lemmatize,
  lookupInDictionary,
  lookupWord,
  resetDictionary,
  setActiveDictionary,
} from '@/lib/dict/lookup';

const ecdict: EcdictFile = {
  meta: {
    schema: 1,
    version: 'ecdict-test',
    count: 6,
    sourceRows: 6,
    tagged: 3,
    withPhonetic: 1,
    withTranslation: 6,
    withPos: 6,
    withExchange: 3,
    topN: 50000,
    maxTranslationChars: 120,
  },
  entries: [
    ['run', 'rʌn', 'v. 跑\nn. 奔跑', 'v. n.', 'zk', 'p:ran/i:running/d:run/0:run/1:d/3:runs/s:runs'],
    ['running', 'ˈrʌnɪŋ', 'n. 跑步', 'n.', 'gk', '0:run/1:i/i:running/s:runnings'],
    ['have', 'hæv', 'v. 有', 'v.', 'zk', 'i:having/p:had/3:has/d:had'],
    ['box', 'bɒks', 'n. 盒子', 'n.', '', 's:boxes'],
    ['they', '', 'pron. 他们', 'pron.', 'zk', ''],
    ['want', '', 'v. 想要', 'v.', 'zk', 'p:wanted/i:wanting/3:wants'],
  ],
};

const lemmas: LemmaFile = {
  meta: { schema: 1, version: 'lemma-test', count: 4, groups: 2 },
  map: { running: 'run', ran: 'run', runs: 'run', has: 'have' },
};

const dictionary = createDictionary(ecdict, lemmas);

beforeEach(() => {
  resetDictionary();
  setActiveDictionary(dictionary);
});

describe('lookupInDictionary', () => {
  it('prefers the lemma headword for an inflected exact match (running -> run)', () => {
    const entry = lookupInDictionary(dictionary, 'running');
    expect(entry).toMatchObject({ word: 'run', matchedForm: 'running', tags: ['zk'] });
    expect(entry?.translation).toContain('v. 跑');
  });

  it('returns the exact entry untouched when it is a headword itself', () => {
    const entry = lookupInDictionary(dictionary, 'box');
    expect(entry).toEqual({
      word: 'box',
      phonetic: 'bɒks',
      translation: 'n. 盒子',
      pos: 'n.',
      tags: [],
      exchange: 's:boxes',
    });
    expect(entry).not.toHaveProperty('matchedForm');
  });

  it('falls back to the lemma map when the surface is not a headword', () => {
    const entry = lookupInDictionary(dictionary, 'ran');
    expect(entry).toMatchObject({ word: 'run', matchedForm: 'ran' });
  });

  it('falls back to the ECDICT exchange index last (boxes -> box)', () => {
    const entry = lookupInDictionary(dictionary, 'boxes');
    expect(entry).toMatchObject({ word: 'box', matchedForm: 'boxes' });
  });

  it('matches case-insensitively and normalizes curly apostrophes', () => {
    expect(lookupInDictionary(dictionary, 'RUNNING')?.word).toBe('run');
    expect(lookupInDictionary(dictionary, '  Box  ')?.word).toBe('box');
  });

  it('returns null for misses and empty input', () => {
    expect(lookupInDictionary(dictionary, 'serendipity')).toBeNull();
    expect(lookupInDictionary(dictionary, '')).toBeNull();
    expect(lookupInDictionary(dictionary, '   ')).toBeNull();
  });

  it('does not mutate the stored entry when adding matchedForm', () => {
    lookupInDictionary(dictionary, 'running');
    expect(lookupInDictionary(dictionary, 'run')).toEqual({
      word: 'run',
      phonetic: 'rʌn',
      translation: 'v. 跑\nn. 奔跑',
      pos: 'v. n.',
      tags: ['zk'],
      exchange: 'p:ran/i:running/d:run/0:run/1:d/3:runs/s:runs',
    });
  });
});

describe('lookupWord', () => {
  it('resolves through the active dictionary', async () => {
    await expect(lookupWord('running')).resolves.toMatchObject({
      word: 'run',
      matchedForm: 'running',
    });
    await expect(lookupWord('nope')).resolves.toBeNull();
  });
});

describe('lemmatize', () => {
  it('returns the lemma for inflected surfaces', () => {
    expect(lemmatize('running')).toBe('run');
    expect(lemmatize('has')).toBe('have');
    expect(lemmatize('boxes')).toBe('box');
    expect(lemmatize('WANTED')).toBe('want');
  });

  it('uses the exchange root for derived exact entries (better-style)', () => {
    const better = createDictionary(
      {
        meta: ecdict.meta,
        entries: [
          ['good', '', 'adj. 好的', 'adj.', 'zk', 'r:better/t:best'],
          ['better', '', 'adj. 更好的', 'adj.', 'gk', '0:good/1:r'],
        ],
      },
      { meta: lemmas.meta, map: {} },
    );
    setActiveDictionary(better);
    expect(lemmatize('better')).toBe('good');
  });

  it('returns the lowercase original when the dictionary has no mapping', () => {
    expect(lemmatize('They')).toBe('they');
    expect(lemmatize('  Serendipity ')).toBe('serendipity');
    expect(lemmatize('')).toBe('');
  });

  it('falls back to the lowercase original with no dictionary loaded', () => {
    resetDictionary();
    expect(getActiveDictionary()).toBeNull();
    expect(lemmatize('Running')).toBe('running');
  });
});
