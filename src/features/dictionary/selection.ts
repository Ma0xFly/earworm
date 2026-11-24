/**
 * Clicked-word → phrase resolution for the dictionary popup.
 *
 * A word can sit inside more than one `CollocationSpan` in theory (the union in
 * T6 guarantees non-overlap, but the popup should still behave predictably).
 * Priority, highest first:
 *   1. LLM spans over offline spans — the LLM note is the in-context gloss;
 *   2. a span that carries a note over a bare span;
 *   3. the shorter span (a more specific phrase);
 *   4. the earlier span.
 */

import type { CollocationSpan } from '@/lib/contracts';

type RankedSpan = { span: CollocationSpan; rank: number; length: number };

function sourceRank(span: CollocationSpan): number {
  return span.source === 'llm' ? 2 : 1;
}

function noteRank(span: CollocationSpan): number {
  return span.note ? 1 : 0;
}

/** Find the phrase the clicked word belongs to, or `null` when it is bare. */
export function findCollocationAtOffset(
  spans: readonly CollocationSpan[] | undefined,
  offset: number,
): CollocationSpan | null {
  if (!spans || spans.length === 0) return null;
  if (!Number.isFinite(offset)) return null;

  const candidates: RankedSpan[] = [];
  for (const span of spans) {
    if (offset < span.start || offset >= span.end) continue;
    candidates.push({
      span,
      rank: sourceRank(span) * 2 + noteRank(span),
      length: span.end - span.start,
    });
  }
  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) =>
      b.rank - a.rank ||
      a.length - b.length ||
      a.span.start - b.span.start ||
      a.span.end - b.span.end,
  );
  return candidates[0]?.span ?? null;
}

/** Exam tag codes shipped by ECDICT, mapped to the chips shown in the card. */
export const EXAM_TAG_LABELS: Readonly<Record<string, string>> = {
  zk: '中考',
  gk: '高考',
  cet4: '四级',
  cet6: '六级',
  ky: '考研',
  toefl: '托福',
  ielts: '雅思',
  gre: 'GRE',
};

/** Human label for an ECDICT exam tag; unknown tags are shown verbatim. */
export function examTagLabel(tag: string): string {
  return EXAM_TAG_LABELS[tag] ?? tag;
}

/** Normalize ECDICT's newline-separated, multi-sense translation for display. */
export function formatTranslation(translation: string | undefined): string {
  if (!translation) return '';
  return translation
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}
