/**
 * Earworm — ECDICT build script.
 *
 * Trims the 66 MB `ecdict.csv` down to a compact offline dictionary and derives
 * the surface -> lemma map from `lemma.en.txt`:
 *
 *   pnpm build:ecdict
 *   ECDICT_CSV=/path/to/ecdict.csv LEMMA_TXT=/path/to/lemma.en.txt pnpm build:ecdict
 *
 * Outputs (committed, they ship in the extension):
 *   public/data/ecdict.json
 *   public/data/lemmas.json
 *
 * Trim rule (matches the measured analysis, 50,961 entries for ECDICT):
 *   1. rank = min(frq, bnc) over positive values (0 means "not ranked");
 *   2. take the top 50,000 words by rank (stable: CSV order breaks ties);
 *   3. union with every exam-tagged word so no zk/gk/cet4/... vocabulary is lost.
 *
 * Data sources:
 * - ECDICT — https://github.com/skywind3000/ECDICT (MIT).
 * - lemma.en.txt — compiled by Lin Wei (skywind3000) from BNC frequency data;
 *   distributed with ECDICT for research/educational use.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildExchangeIndex,
  buildLemmaIndex,
  parseLemmaText,
} from '../src/lib/dict/lemma';
import type { DictRow, EcdictFile, EcdictMeta, LemmaFile } from '../src/lib/dict/db';

export type EcdictRow = {
  word: string;
  phonetic: string;
  definition: string;
  translation: string;
  pos: string;
  collins: string;
  oxford: string;
  tag: string;
  bnc: string;
  frq: string;
  exchange: string;
  detail: string;
  audio: string;
};

export type BuildOptions = {
  /** Number of frequency-ranked words to keep before the exam-tag union. */
  topN?: number;
  /** Hard cap for the cleaned translation text (117 chars + `...`). */
  maxTranslationChars?: number;
};

export type BuiltArtifacts = {
  ecdict: EcdictFile;
  lemmas: LemmaFile;
  ecdictJson: string;
  lemmasJson: string;
  stats: {
    ecdictBytes: number;
    lemmasBytes: number;
    entries: number;
    tagged: number;
    lemmas: number;
  };
};

const DEFAULT_TOP_N = 50_000;
const DEFAULT_MAX_TRANSLATION_CHARS = 120;
const REQUIRED_COLUMNS = [
  'word',
  'phonetic',
  'translation',
  'tag',
  'bnc',
  'frq',
  'exchange',
] as const;
const TAG_COLUMNS = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre'] as const;

/** Positions in the shipped positional row (see `src/lib/dict/db.ts`). */
export const DICT_ROW_FIELDS = [
  'word',
  'phonetic',
  'translation',
  'pos',
  'tag',
  'exchange',
] as const;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/**
 * RFC-4180-ish CSV parser: quoted fields, doubled quotes inside quotes, commas,
 * and LF/CRLF/CR line endings. Leading UTF-8 BOM removed. ECDICT has no embedded
 * real newlines but the parser supports them anyway.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] ?? '';
    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      endRow();
    } else if (character === '\r') {
      if (input[index + 1] === '\n') continue;
      endRow();
    } else {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

/** Parse `ecdict.csv` into typed rows, validating the header the build needs. */
export function parseEcdictCsv(text: string): EcdictRow[] {
  const rows = parseCsv(text);
  const [header, ...records] = rows;
  if (!header || header.length === 0) throw new Error('ECDICT CSV is empty');

  const indexByColumn = new Map<string, number>();
  header.forEach((column, index) => {
    const name = column.trim().toLowerCase();
    if (!indexByColumn.has(name)) indexByColumn.set(name, index);
  });
  const missing = REQUIRED_COLUMNS.filter((column) => !indexByColumn.has(column));
  if (missing.length > 0) {
    throw new Error(`ECDICT CSV is missing column(s): ${missing.join(', ')}`);
  }

  const field = (record: string[], column: string): string => {
    const index = indexByColumn.get(column);
    return index === undefined ? '' : (record[index] ?? '');
  };

  return records
    .filter((record) => record.some((value) => value.length > 0))
    .map((record) => ({
      word: field(record, 'word'),
      phonetic: field(record, 'phonetic'),
      definition: field(record, 'definition'),
      translation: field(record, 'translation'),
      pos: field(record, 'pos'),
      collins: field(record, 'collins'),
      oxford: field(record, 'oxford'),
      tag: field(record, 'tag'),
      bnc: field(record, 'bnc'),
      frq: field(record, 'frq'),
      exchange: field(record, 'exchange'),
      detail: field(record, 'detail'),
      audio: field(record, 'audio'),
    }));
}

function rankOf(row: EcdictRow): number {
  const ranks = [row.frq, row.bnc]
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  return ranks.length > 0 ? Math.min(...ranks) : Number.POSITIVE_INFINITY;
}

/**
 * Select the trimmed entry set: top-N by frequency rank, union every exam-tagged
 * word. Keeps the CSV order inside each part, so the output is deterministic.
 */
export function selectEcdictRows(
  rows: EcdictRow[],
  options: BuildOptions = {},
): EcdictRow[] {
  const topN = options.topN ?? DEFAULT_TOP_N;
  const seen = new Set<string>();
  const ranked: EcdictRow[] = [];
  for (const row of rows
    .filter((candidate) => Number.isFinite(rankOf(candidate)))
    .sort((left, right) => rankOf(left) - rankOf(right))) {
    if (ranked.length >= topN) break;
    const key = row.word.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push(row);
  }

  const tagged: EcdictRow[] = [];
  for (const row of rows) {
    if (!row.tag.trim()) continue;
    const key = row.word.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tagged.push(row);
  }
  return [...ranked, ...tagged];
}

function unescapeNewlines(value: string): string {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n');
}

function stripBracketLabel(line: string): string {
  return line.replace(/^\[[^\]]*\]\s*/, '').trim();
}

/**
 * Clean ECDICT's machine-translation-heavy `translation` value:
 * - literal `\r\n` / `\n` -> real newlines;
 * - drop `[网络]` / `[计]` noise lines, keep at most two lines;
 * - clamp to `maxTranslationChars` (117 + `...`);
 * - if every line was noise, keep the first line's content without its label.
 */
export function normalizeTranslation(value: string, maxTranslationChars = DEFAULT_MAX_TRANSLATION_CHARS): string {
  const lines = unescapeNewlines(value)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const kept = lines.filter((line) => !line.startsWith('[网络]') && !line.startsWith('[计]'));
  if (kept.length === 0) {
    const fallback = lines.map(stripBracketLabel).find((line) => line.length > 0);
    if (fallback) kept.push(fallback);
  }

  let text = kept.slice(0, 2).join('\n');
  if (text.length > maxTranslationChars) {
    text = `${text.slice(0, Math.max(0, maxTranslationChars - 3))}...`;
  }
  return text;
}

const POS_BY_PREFIX: Record<string, string> = {
  n: 'n.',
  pl: 'n.',
  v: 'v.',
  vt: 'v.',
  vi: 'v.',
  a: 'adj.',
  adj: 'adj.',
  ad: 'adv.',
  adv: 'adv.',
  prep: 'prep.',
  pron: 'pron.',
  pn: 'pron.',
  conj: 'conj.',
  num: 'num.',
  art: 'art.',
  int: 'int.',
  aux: 'aux.',
  abbr: 'abbr.',
  pref: 'pref.',
  suf: 'suf.',
  suff: 'suf.',
  comb: 'comb.',
};

/**
 * ECDICT's `pos` column is empty in every row, so derive a coarse POS list from
 * the translation line prefixes (`n.` / `vt.` / `a.` / `ad.` / ...), in order of
 * first appearance without duplicates.
 */
export function derivePos(translation: string): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const line of unescapeNewlines(translation).split('\n')) {
    const match = /^\s*([A-Za-z]{1,5})\./.exec(line);
    if (!match?.[1]) continue;
    const pos = POS_BY_PREFIX[match[1].toLowerCase()];
    if (!pos || seen.has(pos)) continue;
    seen.add(pos);
    parts.push(pos);
  }
  return parts.join(' ');
}

function normalizeTags(tag: string): string {
  const known = new Set<string>(TAG_COLUMNS);
  return tag
    .trim()
    .split(/\s+/)
    .filter((value) => known.has(value))
    .join(' ');
}

function rowToDictRow(
  row: EcdictRow,
  maxTranslationChars: number,
): DictRow {
  return [
    row.word.trim(),
    row.phonetic.trim(),
    normalizeTranslation(row.translation, maxTranslationChars),
    derivePos(row.translation),
    normalizeTags(row.tag),
    row.exchange.trim(),
  ];
}

/**
 * Build both shipped artifacts from in-memory source text. Pure and
 * deterministic: no timestamps, sorted lemma keys, content-hash versions.
 */
export function buildArtifacts(
  sources: { csvText: string; lemmaText: string },
  options: BuildOptions = {},
): BuiltArtifacts {
  const topN = options.topN ?? DEFAULT_TOP_N;
  const maxTranslationChars = options.maxTranslationChars ?? DEFAULT_MAX_TRANSLATION_CHARS;

  const sourceRows = parseEcdictCsv(sources.csvText);
  const selected = selectEcdictRows(sourceRows, { topN });
  const entries = selected.map((row) => rowToDictRow(row, maxTranslationChars));

  const ecdictMeta: EcdictMeta = {
    schema: 1,
    version: `ecdict-${sha256(JSON.stringify(entries))}`,
    count: entries.length,
    sourceRows: sourceRows.length,
    tagged: entries.filter((entry) => entry[4].length > 0).length,
    withPhonetic: entries.filter((entry) => entry[1].length > 0).length,
    withTranslation: entries.filter((entry) => entry[2].length > 0).length,
    withPos: entries.filter((entry) => entry[3].length > 0).length,
    withExchange: entries.filter((entry) => entry[5].length > 0).length,
    topN,
    maxTranslationChars,
  };
  const ecdict: EcdictFile = { meta: ecdictMeta, entries };

  const knownWords = entries.map((entry) => entry[0].toLowerCase());
  const exchangeIndex = buildExchangeIndex(
    selected.map((row) => [row.word, row.exchange] as const),
  );
  const groups = parseLemmaText(sources.lemmaText);
  const lemmaIndex = buildLemmaIndex(groups, knownWords, exchangeIndex);
  const lemmaMap = Object.fromEntries(
    [...lemmaIndex.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
  const lemmaMeta: LemmaFile['meta'] = {
    schema: 1,
    version: `lemma-${sha256(JSON.stringify(lemmaMap))}`,
    count: Object.keys(lemmaMap).length,
    groups: groups.length,
  };
  const lemmas: LemmaFile = { meta: lemmaMeta, map: lemmaMap };

  const ecdictJson = JSON.stringify(ecdict);
  const lemmasJson = JSON.stringify(lemmas);

  return {
    ecdict,
    lemmas,
    ecdictJson,
    lemmasJson,
    stats: {
      ecdictBytes: byteLength(ecdictJson),
      lemmasBytes: byteLength(lemmasJson),
      entries: ecdictMeta.count,
      tagged: ecdictMeta.tagged,
      lemmas: lemmaMeta.count,
    },
  };
}

export type RunBuildOptions = {
  csvPath?: string;
  lemmaPath?: string;
  outputDir?: string;
  build?: BuildOptions;
};

/** Read the real inputs, build both artifacts and write them to `public/data`. */
export function runBuild(options: RunBuildOptions = {}): BuiltArtifacts {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const csvPath = path.resolve(options.csvPath ?? path.join(repositoryRoot, 'data/ecdict.csv'));
  const lemmaPath = path.resolve(options.lemmaPath ?? path.join(repositoryRoot, 'data/lemma.en.txt'));
  const outputDir = path.resolve(options.outputDir ?? path.join(repositoryRoot, 'public/data'));

  const artifacts = buildArtifacts(
    {
      csvText: readFileSync(csvPath, 'utf8'),
      lemmaText: readFileSync(lemmaPath, 'utf8'),
    },
    options.build,
  );

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, 'ecdict.json'), artifacts.ecdictJson);
  writeFileSync(path.join(outputDir, 'lemmas.json'), artifacts.lemmasJson);

  const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);
  console.log(
    `[earworm] ecdict.json: ${artifacts.stats.entries.toLocaleString('en-US')} entries, ` +
      `${artifacts.stats.tagged.toLocaleString('en-US')} tagged, ` +
      `${megabytes(artifacts.stats.ecdictBytes)} MB (${artifacts.ecdict.meta.version})`,
  );
  console.log(
    `[earworm] lemmas.json: ${artifacts.stats.lemmas.toLocaleString('en-US')} mappings, ` +
      `${megabytes(artifacts.stats.lemmasBytes)} MB (${artifacts.lemmas.meta.version})`,
  );
  console.log(`[earworm] wrote ${path.relative(process.cwd(), outputDir)}/{ecdict,lemmas}.json`);
  return artifacts;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    runBuild({
      csvPath: process.env.ECDICT_CSV,
      lemmaPath: process.env.LEMMA_TXT,
    });
  } catch (error) {
    console.error('[earworm] build:ecdict failed:', error);
    process.exitCode = 1;
  }
}
