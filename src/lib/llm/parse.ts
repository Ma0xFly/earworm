import type { LlmCollocation } from '@/lib/contracts';
import type { TranslateBatchItem } from '@/lib/messages';

/**
 * Defensive parsing and span alignment for the strict JSON translation
 * contract.
 *
 * The model may wrap its answer in a fence or chatter; shape errors are
 * retryable while per-sentence problems degrade to a failed sentence.
 */

export class ParseError extends Error {
  readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export type AlignedLlmCollocation = LlmCollocation & {
  /** UTF-16 offset into the sentence text, inclusive. */
  start: number;
  /** UTF-16 offset into the sentence text, exclusive. */
  end: number;
};

export type ParsedSentenceResult = {
  i: number;
  zh?: string;
  cols: AlignedLlmCollocation[];
};

export type ParsedTranslation = {
  /** One entry per requested sentence, in request order; `zh` absent = failure. */
  results: ParsedSentenceResult[];
  /** Indices whose `zh` was missing or empty. */
  failed: number[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Locate `spanText` inside `sentenceText` and return its UTF-16 offsets.
 *
 * Exact (case-sensitive) matching wins. When that fails, a case-insensitive
 * regex is used as a fallback and the span is recomputed from the match so
 * offsets always point at real characters in the original sentence.
 */
export function alignCollocation(
  sentenceText: string,
  spanText: string,
): { start: number; end: number; text: string } | null {
  if (typeof spanText !== 'string') return null;
  const needle = spanText.trim();
  if (needle.length === 0) return null;

  const exactIndex = sentenceText.indexOf(needle);
  if (exactIndex >= 0) {
    return {
      start: exactIndex,
      end: exactIndex + needle.length,
      text: sentenceText.slice(exactIndex, exactIndex + needle.length),
    };
  }

  const match = new RegExp(escapeRegExp(needle), 'i').exec(sentenceText);
  if (!match) return null;
  return {
    start: match.index,
    end: match.index + match[0].length,
    text: match[0],
  };
}

/** Align every valid collocation, dropping unmatched/empty/duplicate spans. */
export function alignCollocations(
  sentenceText: string,
  cols: readonly LlmCollocation[],
): AlignedLlmCollocation[] {
  const aligned: AlignedLlmCollocation[] = [];
  const seen = new Set<string>();

  for (const collocation of cols) {
    if (!isRecord(collocation) || typeof collocation.text !== 'string') continue;
    const span = alignCollocation(sentenceText, collocation.text);
    if (!span) continue;

    const key = `${span.start}:${span.end}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const note =
      typeof collocation.note === 'string' && collocation.note.trim().length > 0
        ? collocation.note.trim()
        : undefined;
    aligned.push({
      text: span.text,
      ...(note !== undefined ? { note } : {}),
      start: span.start,
      end: span.end,
    });
  }

  return aligned;
}

/**
 * Extract a JSON array from raw model content, tolerating fenced blocks and
 * prose noise around the payload.
 */
export function extractJsonArray(raw: string): unknown[] {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new ParseError('Empty model response');
  }

  const trimmed = raw.trim();
  const candidates: string[] = [trimmed];

  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (let match = fencePattern.exec(trimmed); match; match = fencePattern.exec(trimmed)) {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  }

  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (Array.isArray(parsed)) return parsed;
  }

  throw new ParseError('Model response did not contain a JSON array');
}

/**
 * Validate a raw model answer against the requested batch.
 *
 * - unknown/duplicate/malformed indices are ignored;
 * - a missing or empty `zh` marks just that sentence failed;
 * - collocations must be literal substrings of their sentence and are
 *   aligned to UTF-16 offsets; unmatched spans are dropped without touching
 *   the translation;
 * - a response with no usable translation at all is a parse failure.
 */
export function parseTranslationContent(
  raw: string,
  batch: readonly TranslateBatchItem[],
): ParsedTranslation {
  if (batch.length === 0) return { results: [], failed: [] };

  const array = extractJsonArray(raw);
  const requested = new Map<number, string>();
  for (const item of batch) {
    if (!requested.has(item.i)) requested.set(item.i, item.text);
  }

  const translated = new Map<number, { zh: string; cols: AlignedLlmCollocation[] }>();
  const seen = new Set<number>();

  for (const entry of array) {
    if (!isRecord(entry)) continue;
    const i = entry.i;
    if (typeof i !== 'number' || !Number.isInteger(i) || seen.has(i)) continue;
    const sentenceText = requested.get(i);
    if (sentenceText === undefined) continue;
    seen.add(i);

    const zh = typeof entry.zh === 'string' ? entry.zh.trim() : '';
    if (zh.length === 0) continue;

    const cols = Array.isArray(entry.cols)
      ? alignCollocations(sentenceText, entry.cols as LlmCollocation[])
      : [];
    translated.set(i, { zh, cols });
  }

  if (translated.size === 0) {
    throw new ParseError('Model response contained no usable translations');
  }

  const results: ParsedSentenceResult[] = [];
  const failed: number[] = [];
  for (const item of batch) {
    const hit = translated.get(item.i);
    if (hit) {
      results.push({ i: item.i, zh: hit.zh, cols: hit.cols });
    } else {
      results.push({ i: item.i, cols: [] });
      failed.push(item.i);
    }
  }

  return { results, failed };
}
