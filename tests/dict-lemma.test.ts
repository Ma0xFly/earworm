import { describe, expect, it } from 'vitest';
import {
  buildExchangeIndex,
  buildLemmaIndex,
  exchangeRoot,
  parseExchange,
  parseLemmaText,
} from '@/lib/dict/lemma';

describe('parseLemmaText', () => {
  it('parses lemma groups with and without a corpus count', () => {
    const text = [
      '; En Lemma Database (version 1.0.3)',
      '; a comment',
      '',
      'be/4109826 -> is,was,are,were,been,being',
      'run/44715 -> running,ran,runs',
      'ha -> has',
      '  good/100  ->   better, best  ',
    ].join('\n');

    expect(parseLemmaText(text)).toEqual([
      { lemma: 'be', count: 4109826, forms: ['is', 'was', 'are', 'were', 'been', 'being'] },
      { lemma: 'run', count: 44715, forms: ['running', 'ran', 'runs'] },
      { lemma: 'ha', count: 0, forms: ['has'] },
      { lemma: 'good', count: 100, forms: ['better', 'best'] },
    ]);
  });

  it('lowercases, trims and de-duplicates forms while keeping order', () => {
    const [group] = parseLemmaText("Have/12 -> HAS, has, 's , Had");
    expect(group).toEqual({ lemma: 'have', count: 12, forms: ['has', "'s", 'had'] });
  });

  it('ignores lines without the arrow separator', () => {
    expect(parseLemmaText('not a lemma line\n; comment\n')).toEqual([]);
  });
});

describe('parseExchange', () => {
  it('extracts known form codes and ignores root/marker/unknown codes', () => {
    expect(parseExchange('p:was/3:is/d:been/i:being')).toEqual([
      { code: 'p', form: 'was' },
      { code: '3', form: 'is' },
      { code: 'd', form: 'been' },
      { code: 'i', form: 'being' },
    ]);

    expect(parseExchange('0:a-bomb/1:s/x:ignored/f:courts-martial')).toEqual([
      { code: 'f', form: 'courts-martial' },
    ]);
  });

  it('tolerates empty, malformed and missing exchange values', () => {
    expect(parseExchange(undefined)).toEqual([]);
    expect(parseExchange('')).toEqual([]);
    expect(parseExchange('p:/s:')).toEqual([]);
    expect(parseExchange('nonsense')).toEqual([]);
  });
});

describe('exchangeRoot', () => {
  it('returns the code-0 root when present', () => {
    expect(exchangeRoot('0:good/1:r/d:bettered')).toBe('good');
    expect(exchangeRoot('i:running/0:run')).toBe('run');
  });

  it('returns undefined when no root is recorded', () => {
    expect(exchangeRoot('')).toBeUndefined();
    expect(exchangeRoot('p:ran/i:running')).toBeUndefined();
  });
});

describe('buildExchangeIndex', () => {
  it('maps inflected forms to their headword and normalizes case', () => {
    const index = buildExchangeIndex([
      ['have', 'i:having/p:had/3:has/d:had'],
      ['run', 'p:ran/i:running/d:run/0:run/1:d/3:runs/s:runs'],
      ['DJ', 's:djs/f:DJs'],
      ['bare', ''],
    ]);

    expect(index.get('has')).toBe('have');
    expect(index.get('running')).toBe('run');
    expect(index.get('ran')).toBe('run');
    expect(index.get('runs')).toBe('run');
    expect(index.get('djs')).toBe('dj');
    expect(index.has('dj')).toBe(false);
    expect(index.has('bare')).toBe(false);
  });

  it('keeps the first headword for colliding forms deterministically', () => {
    const index = buildExchangeIndex([
      ['first', 's:shared'],
      ['second', 's:shared'],
    ]);
    expect(index.get('shared')).toBe('first');
  });
});

describe('buildLemmaIndex', () => {
  const groups = parseLemmaText(
    [
      'run/44715 -> running,ran,runs',
      'have/1315648 -> had,has,having',
      'ha -> has',
      'it/1213224 -> its,they',
      'he/1196022 -> his,him,they',
      'they/841960 -> their,them',
      'good/500000 -> better',
      'well/156075 -> better,wells',
      'purchase/7372 -> purchased',
    ].join('\n'),
  );
  const known = new Set([
    'run',
    'have',
    'ha',
    'it',
    'he',
    'they',
    'good',
    'well',
    'running',
    'has',
    'better',
    'purchased',
  ]);
  const exchangeIndex = new Map([
    ['has', 'have'],
    ['better', 'good'],
    ['running', 'run'],
  ]);

  it('maps unambiguous inflected forms to their lemma', () => {
    const index = buildLemmaIndex(groups, known, exchangeIndex);
    expect(index.get('running')).toBe('run');
    expect(index.get('ran')).toBe('run');
    expect(index.get('his')).toBe('he');
    expect(index.get('their')).toBe('they');
  });

  it('drops cross-POS collisions without exchange evidence (they -> he)', () => {
    const index = buildLemmaIndex(groups, known, exchangeIndex);
    expect(index.has('they')).toBe(false);
  });

  it('uses exchange evidence to resolve collisions (has -> have, not ha)', () => {
    const index = buildLemmaIndex(groups, known, exchangeIndex);
    expect(index.get('has')).toBe('have');
    expect(index.get('better')).toBe('good');
  });

  it('only keeps lemmas that are dictionary headwords', () => {
    const index = buildLemmaIndex(groups, known, exchangeIndex);
    expect(index.has('purchased')).toBe(false);
  });

  it('skips identity mappings (they -> they)', () => {
    const index = buildLemmaIndex(parseLemmaText('they/1 -> they'), ['they']);
    expect(index.has('they')).toBe(false);
  });

  it('drops ambiguous forms when there is no exchange evidence', () => {
    const index = buildLemmaIndex(
      parseLemmaText('it/2 -> they\nhe/1 -> they'),
      new Set(['it', 'he', 'they']),
    );
    expect(index.has('they')).toBe(false);
  });
});
