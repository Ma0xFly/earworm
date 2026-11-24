import { describe, expect, it } from 'vitest';
import {
  buildArtifacts,
  derivePos,
  normalizeTranslation,
  parseCsv,
  parseEcdictCsv,
  selectEcdictRows,
} from '../scripts/build-ecdict';

const HEADER =
  'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio';

function csvLine(fields: Partial<Record<string, string>>): string {
  const defaults: Record<string, string> = {
    word: '',
    phonetic: '',
    definition: '',
    translation: '',
    pos: '',
    collins: '',
    oxford: '',
    tag: '',
    bnc: '0',
    frq: '0',
    exchange: '',
    detail: '',
    audio: '',
  };
  const order = HEADER.split(',');
  return order
    .map((key) => {
      const value = fields[key] ?? defaults[key] ?? '';
      return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    })
    .join(',');
}

describe('parseCsv', () => {
  it('handles quoted commas, escaped quotes, CRLF and a trailing newline', () => {
    const text =
      'a,b,c\r\n' +
      'plain,"with, comma","quote ""inside"""\r\n' +
      'last,,\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['plain', 'with, comma', 'quote "inside"'],
      ['last', '', ''],
    ]);
  });

  it('strips a UTF-8 BOM', () => {
    expect(parseCsv('\uFEFFword,tag\nlook,zk\n')).toEqual([
      ['word', 'tag'],
      ['look', 'zk'],
    ]);
  });

  it('keeps empty fields and an empty last field', () => {
    expect(parseCsv('a,,c\n,,\n')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });
});

describe('parseEcdictCsv', () => {
  it('maps columns by header and validates the required ones', () => {
    const rows = parseEcdictCsv(
      `${HEADER}\n${csvLine({
        word: 'look',
        phonetic: 'luk',
        translation: 'n. 看\\nvi. 注意',
        tag: 'zk gk',
        bnc: '5',
        frq: '3',
        exchange: 'p:looked',
      })}\n`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      word: 'look',
      phonetic: 'luk',
      translation: 'n. 看\\nvi. 注意',
      tag: 'zk gk',
      bnc: '5',
      frq: '3',
      exchange: 'p:looked',
    });
    expect(() => parseEcdictCsv('word,phonetic\nlook,luk\n')).toThrow(/missing column/i);
  });
});

describe('selectEcdictRows', () => {
  const rows = parseEcdictCsv(
    [
      HEADER,
      csvLine({ word: 'common', tag: '', bnc: '10', frq: '20' }),
      csvLine({ word: 'tagged-only', tag: 'zk' }),
      csvLine({ word: 'rare', tag: '', bnc: '90', frq: '0' }),
      csvLine({ word: 'common', tag: 'gre', bnc: '10', frq: '20' }),
      csvLine({ word: 'unranked', tag: '' }),
    ].join('\n'),
  );

  it('takes the top N by min positive rank and unions every exam-tagged word', () => {
    const selected = selectEcdictRows(rows, { topN: 2 });
    expect(selected.map((row) => row.word)).toEqual(['common', 'rare', 'tagged-only']);
  });

  it('does not duplicate tagged words already selected by frequency', () => {
    const selected = selectEcdictRows(rows, { topN: 50 });
    expect(selected.map((row) => row.word)).toEqual(['common', 'rare', 'tagged-only']);
  });
});

describe('normalizeTranslation', () => {
  it('turns literal \\r\\n / \\n into real newlines and trims lines', () => {
    expect(normalizeTranslation('n. 看\\r\\nvi. 注意\\n  adj.  好看  ')).toBe(
      'n. 看\nvi. 注意',
    );
  });

  it('drops [网络] / [计] machine-translation lines', () => {
    expect(normalizeTranslation('[网络] 胡德\\nn. 罩\\n[计] 引擎盖\\nv. 覆盖')).toBe(
      'n. 罩\nv. 覆盖',
    );
  });

  it('falls back to a line whose only label was dropped', () => {
    expect(normalizeTranslation('[网络] 胡德')).toBe('胡德');
  });

  it('keeps at most two lines and clamps long text to 120 chars', () => {
    const long = 'x'.repeat(130);
    expect(normalizeTranslation(`${long}\\na\\nb`)).toBe(`${'x'.repeat(117)}...`);
    expect(normalizeTranslation('one\\ntwo\\nthree')).toBe('one\ntwo');
  });
});

describe('derivePos', () => {
  it('derives a coarse POS list from translation line prefixes', () => {
    expect(derivePos('n. 看\\nvt. 注意\\nvi. 显得')).toBe('n. v.');
    expect(derivePos('a. 好的\\nad. 好地\\nabbr. 缩写')).toBe('adj. adv. abbr.');
  });

  it('returns an empty string when no line starts with a known POS', () => {
    expect(derivePos('[网络] 胡德')).toBe('');
  });
});

describe('buildArtifacts', () => {
  const csvText = [
    HEADER,
    csvLine({
      word: 'look',
      phonetic: 'luk',
      translation: 'n. 看\\nvi. 注意\\n[网络] 样子',
      tag: 'zk gk',
      bnc: '5',
      frq: '3',
      exchange: 'p:looked/i:looking/3:looks',
    }),
    csvLine({ word: 'running', translation: 'n. 跑步', tag: 'gk', frq: '100' }),
    csvLine({ word: 'run', translation: 'v. 跑', tag: 'zk', frq: '50', exchange: 'i:running/p:ran' }),
    csvLine({
      word: 'exam-only',
      phonetic: 'ɪɡˈzæm',
      translation: '[网络] 考试专用',
      tag: 'gre',
    }),
    csvLine({ word: 'rare', translation: 'a. 稀有', bnc: '80000', frq: '0' }),
    csvLine({ word: 'unranked', translation: 'n. 无排名' }),
  ].join('\n');
  const lemmaText = [
    '; comment',
    'run/44715 -> running,ran,runs',
    'look/100 -> looked,looking,looks',
    'they/10 -> they',
  ].join('\n');

  it('builds a positional entry array with version and stats meta', () => {
    const { ecdict, lemmas } = buildArtifacts({ csvText, lemmaText }, { topN: 2 });

    expect(ecdict.meta).toMatchObject({
      schema: 1,
      count: 4,
      sourceRows: 6,
      tagged: 4,
      withPhonetic: 2,
      withPos: 3,
      topN: 2,
      maxTranslationChars: 120,
    });
    expect(ecdict.meta.version).toMatch(/^ecdict-[0-9a-f]{16}$/);
    expect(ecdict.entries).toEqual([
      ['look', 'luk', 'n. 看\nvi. 注意', 'n. v.', 'zk gk', 'p:looked/i:looking/3:looks'],
      ['run', '', 'v. 跑', 'v.', 'zk', 'i:running/p:ran'],
      ['running', '', 'n. 跑步', 'n.', 'gk', ''],
      ['exam-only', 'ɪɡˈzæm', '考试专用', '', 'gre', ''],
    ]);
    expect(lemmas.meta).toMatchObject({ schema: 1, count: 6 });
    expect(lemmas.map).toEqual({
      looked: 'look',
      looking: 'look',
      looks: 'look',
      ran: 'run',
      running: 'run',
      runs: 'run',
    });
    expect(lemmas.meta.version).toMatch(/^lemma-[0-9a-f]{16}$/);
  });

  it('is deterministic for the same input and changes the version on data changes', () => {
    const first = buildArtifacts({ csvText, lemmaText }, { topN: 2 });
    const second = buildArtifacts({ csvText, lemmaText }, { topN: 2 });
    expect(second.ecdictJson).toBe(first.ecdictJson);
    expect(second.lemmasJson).toBe(first.lemmasJson);

    const changed = buildArtifacts(
      { csvText, lemmaText: `${lemmaText}\nrun/1 -> sprinted` },
      { topN: 2 },
    );
    expect(changed.lemmas.meta.version).not.toBe(first.lemmas.meta.version);
  });
});
