/**
 * Merge offline table spans with LLM-annotated spans.
 *
 * The model has semantic context the 9k bigram table lacks, so it wins every
 * overlap: an offline span fully covered by an LLM span is dropped, and a
 * partially covered one is trimmed into the surviving left/right fragments.
 * The result is always sorted by start and non-overlapping so the renderer can
 * wrap every span independently.
 *
 * Trimming uses `span.text`, the original slice the contract requires; no
 * sentence text is needed.
 */

import type { CollocationSpan } from '@/lib/contracts';

type Range = { start: number; end: number };

function isUsable(span: CollocationSpan): boolean {
  return (
    Number.isFinite(span.start) &&
    Number.isFinite(span.end) &&
    span.start >= 0 &&
    span.end > span.start &&
    typeof span.text === 'string'
  );
}

function overlaps(left: Range, right: Range): boolean {
  return left.start < right.end && right.start < left.end;
}

function byStart(left: CollocationSpan, right: CollocationSpan): number {
  return left.start - right.start || right.end - left.end;
}

/** Clamp the LLM set itself: first (earlier/longer) span wins an LLM overlap. */
function keepNonOverlappingLlm(spans: readonly CollocationSpan[]): CollocationSpan[] {
  const kept: CollocationSpan[] = [];
  for (const span of [...spans].filter(isUsable).sort(byStart)) {
    if (kept.some((accepted) => overlaps(accepted, span))) continue;
    kept.push(span);
  }
  return kept;
}

/**
 * Cut one range around all cuts, returning the surviving ranges. The cut list
 * is non-overlapping, which makes a single subtraction pass sufficient.
 */
function subtractCuts(range: Range, cuts: readonly CollocationSpan[]): Range[] {
  let pieces: Range[] = [{ start: range.start, end: range.end }];
  for (const cut of cuts) {
    const next: Range[] = [];
    for (const piece of pieces) {
      if (!overlaps(piece, cut)) {
        next.push(piece);
        continue;
      }
      if (cut.start > piece.start) next.push({ start: piece.start, end: cut.start });
      if (cut.end < piece.end) next.push({ start: cut.end, end: piece.end });
    }
    pieces = next;
  }
  return pieces;
}

/**
 * Slice an offline fragment out of its original span text, trimming edge
 * whitespace introduced by the cut. Returns null when the fragment is empty or
 * contains no letters (a punctuation-only remnant).
 */
function offlineFragment(
  span: CollocationSpan,
  range: Range,
): CollocationSpan | null {
  const base = span.start;
  let from = range.start - base;
  let to = range.end - base;
  if (from < 0 || to > span.text.length || from >= to) return null;

  while (from < to && /\s/.test(span.text[from] ?? '')) from += 1;
  while (to > from && /\s/.test(span.text[to - 1] ?? '')) to -= 1;
  if (from >= to) return null;

  const text = span.text.slice(from, to);
  if (!/[A-Za-z]/.test(text)) return null;

  return { start: base + from, end: base + to, text, source: 'offline' };
}

/**
 * Union offline and LLM spans with LLM priority on overlap. Inputs are not
 * mutated; the result is sorted by `start` and non-overlapping.
 */
export function unionSpans(
  offline: readonly CollocationSpan[],
  llm: readonly CollocationSpan[],
): CollocationSpan[] {
  const llmKept = keepNonOverlappingLlm(llm);

  const fragments: CollocationSpan[] = [];
  for (const span of offline) {
    if (!isUsable(span)) continue;
    for (const piece of subtractCuts(span, llmKept)) {
      const fragment = offlineFragment(span, piece);
      if (fragment) fragments.push(fragment);
    }
  }

  const ordered = [...llmKept, ...fragments].sort(byStart);

  const result: CollocationSpan[] = [];
  for (const span of ordered) {
    const previous = result[result.length - 1];
    if (previous && span.start < previous.end) continue;
    result.push(span);
  }
  return result;
}
