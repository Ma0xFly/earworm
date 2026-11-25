/**
 * Earworm — OpenSubtitles collocation build script.
 *
 * Cleans the 15,000-row `opensubs-collocations` export into the compact bigram
 * table shipped as `public/data/collocations.json`:
 *
 *   pnpm build:collocations
 *   OPENSUBS_JSONL=/path/to/en.jsonl pnpm build:collocations
 *
 * Input (gitignored, not committed): `data/en.jsonl`, env override
 * `OPENSUBS_JSONL`. Output (committed, ships in the extension):
 * `public/data/collocations.json`.
 *
 * Cleaning rule (measured on the 15k source: 14,866 clean rows → 9,289 unique):
 *   1. reject bigrams containing non-ASCII characters, digits, or ASS markup
 *      (`{...}`, backslashes such as `\fad`);
 *   2. keep rows with `npmi >= 0.35` OR `count >= 1000` — the count arm is what
 *      preserves useful phrasal verbs like `give up`, `run out`, `put up`;
 *   3. dedupe by bigram, keeping the highest score;
 *   4. sort by score descending (bigram ascending on ties) for deterministic output.
 *
 * Data sources:
 * - opensubs-collocations — https://huggingface.co/datasets/vladvlasov256/opensubs-collocations
 * - OpenSubtitles, Lison & Tiedemann 2016 — CC-BY 4.0. Attribution lives in the
 *   generated file meta and `NOTICE`.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import type { CollocationFile, CollocationMeta } from '../src/lib/collocations/data';

/** One parsed row of the `en.jsonl` source. */
export type CollocationSourceRow = {
  bigram: string;
  type: string;
  count: number;
  pmi: number;
  npmi: number;
  score: number;
};

/** Rows dropped by each cleaning rule (checked in this order). */
export type CollocationRejections = {
  nonAscii: number;
  digit: number;
  markup: number;
};

export type BuildStats = {
  sourceRows: number;
  cleanedRows: number;
  /** Rows that survived the npmi/count filter (before dedupe). */
  filteredRows: number;
  uniqueBigrams: number;
  bytes: number;
  gzipBytes: number;
};

export type BuiltCollocations = {
  file: CollocationFile;
  json: string;
  stats: BuildStats;
};

export const MIN_NPMI = 0.35;
export const MIN_COUNT = 1000;
export const COLLOCATION_SOURCE = 'opensubs-collocations';
export const COLLOCATION_SOURCE_URL =
  'https://huggingface.co/datasets/vladvlasov256/opensubs-collocations';
export const COLLOCATION_LICENSE = 'CC-BY-4.0';
export const COLLOCATION_ATTRIBUTION = 'OpenSubtitles — Lison & Tiedemann 2016';
export const COLLOCATION_FILTER = `npmi >= ${MIN_NPMI} or count >= ${MIN_COUNT}`;

const NON_ASCII = /[^\x00-\x7F]/;
const DIGIT = /[0-9]/;
const ASS_MARKUP = /[{}\\]/;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function toNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/**
 * Parse the JSON-lines source. Blank lines are skipped; malformed JSON or a
 * missing/empty `bigram` throws with the offending line number.
 */
export function parseCollocationRows(text: string): CollocationSourceRow[] {
  const rows: CollocationSourceRow[] = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? '';
    if (line.length === 0) continue;

    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      throw new Error(`Invalid collocation JSON on line ${index + 1}`);
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error(`Invalid collocation row on line ${index + 1}`);
    }

    const record = payload as Record<string, unknown>;
    const bigram = typeof record.bigram === 'string' ? record.bigram.trim() : '';
    if (bigram.length === 0) {
      throw new Error(`Collocation row on line ${index + 1} has no bigram`);
    }

    rows.push({
      bigram,
      type: typeof record.type === 'string' ? record.type : '',
      count: toNumber(record.count),
      pmi: toNumber(record.pmi),
      npmi: toNumber(record.npmi),
      score: toNumber(record.score),
    });
  }

  return rows;
}

/** True when a bigram passes the ASCII / digit / ASS-markup cleaning rules. */
export function isCleanBigram(bigram: string): boolean {
  return !NON_ASCII.test(bigram) && !DIGIT.test(bigram) && !ASS_MARKUP.test(bigram);
}

/**
 * Clean, filter, dedupe and sort parsed rows. Pure and deterministic.
 */
export function cleanCollocationRows(rows: readonly CollocationSourceRow[]): {
  bigrams: string[];
  rejections: CollocationRejections;
  cleanedRows: number;
  filteredRows: number;
} {
  const rejections: CollocationRejections = { nonAscii: 0, digit: 0, markup: 0 };
  let cleanedRows = 0;
  let filteredRows = 0;
  const deduped = new Map<string, CollocationSourceRow>();

  for (const row of rows) {
    const bigram = row.bigram.trim();
    if (NON_ASCII.test(bigram)) {
      rejections.nonAscii += 1;
      continue;
    }
    if (DIGIT.test(bigram)) {
      rejections.digit += 1;
      continue;
    }
    if (ASS_MARKUP.test(bigram)) {
      rejections.markup += 1;
      continue;
    }
    cleanedRows += 1;

    if (!(row.npmi >= MIN_NPMI || row.count >= MIN_COUNT)) continue;
    filteredRows += 1;

    const previous = deduped.get(bigram);
    if (!previous || row.score > previous.score) deduped.set(bigram, row);
  }

  const bigrams = [...deduped.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.bigram < right.bigram ? -1 : left.bigram > right.bigram ? 1 : 0),
    )
    .map((row) => row.bigram);

  return { bigrams, rejections, cleanedRows, filteredRows };
}

/**
 * Build the shipped file from source text. The meta carries provenance,
 * license, filter parameters and counts; no timestamps, so re-running on
 * unchanged input is byte-identical.
 */
export function buildCollocations(sourceText: string): BuiltCollocations {
  const rows = parseCollocationRows(sourceText);
  const { bigrams, rejections, cleanedRows, filteredRows } = cleanCollocationRows(rows);

  const meta: CollocationMeta = {
    schema: 1,
    version: `collocations-${sha256(JSON.stringify(bigrams))}`,
    count: bigrams.length,
    source: COLLOCATION_SOURCE,
    sourceUrl: COLLOCATION_SOURCE_URL,
    license: COLLOCATION_LICENSE,
    attribution: COLLOCATION_ATTRIBUTION,
    filter: COLLOCATION_FILTER,
    sourceRows: rows.length,
    cleanedRows,
    filteredRows,
    rejected: rejections,
  };

  const file: CollocationFile = { meta, bigrams };
  const json = JSON.stringify(file);

  return {
    file,
    json,
    stats: {
      sourceRows: rows.length,
      cleanedRows,
      filteredRows,
      uniqueBigrams: bigrams.length,
      bytes: byteLength(json),
      gzipBytes: gzipSync(Buffer.from(json, 'utf8')).byteLength,
    },
  };
}

export type RunBuildOptions = {
  sourcePath?: string;
  outputPath?: string;
};

/** Read the real input, build the artifact and write it under `public/data`. */
export function runBuild(options: RunBuildOptions = {}): BuiltCollocations {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const sourcePath = path.resolve(
    options.sourcePath ?? path.join(repositoryRoot, 'data/en.jsonl'),
  );
  const outputPath = path.resolve(
    options.outputPath ?? path.join(repositoryRoot, 'public/data/collocations.json'),
  );

  const built = buildCollocations(readFileSync(sourcePath, 'utf8'));
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, built.json);

  const kilobytes = (bytes: number): string => (bytes / 1024).toFixed(1);
  console.log(
    `[earworm] collocations.json: ${built.stats.uniqueBigrams.toLocaleString('en-US')} bigrams, ` +
      `${kilobytes(built.stats.bytes)} KB raw / ${kilobytes(built.stats.gzipBytes)} KB gzip ` +
      `(${built.file.meta.version})`,
  );
  console.log(
    `[earworm] source rows ${built.stats.sourceRows}, clean ${built.stats.cleanedRows}, ` +
      `filtered ${built.stats.filteredRows}`,
  );
  console.log(`[earworm] wrote ${path.relative(process.cwd(), outputPath)}`);
  return built;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    runBuild({ sourcePath: process.env.OPENSUBS_JSONL });
  } catch (error) {
    console.error('[earworm] build:collocations failed:', error);
    process.exitCode = 1;
  }
}
