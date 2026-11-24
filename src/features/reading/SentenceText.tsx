import { useMemo, type KeyboardEvent, type ReactNode } from 'react';
import type { CollocationSpan } from '@/lib/contracts';
import { normalizeWord, tokenizeWords, type TextToken } from '@/lib/text/tokenize';

/**
 * Sentence renderer with clickable words and collocation highlighting.
 *
 * Contract kept for overlay/sidebar/dictionary:
 * - `text` is rendered losslessly (`textContent === text`), including original
 *   spacing, punctuation, case and astral characters;
 * - the root carries `data-lang`;
 * - word tokens are `<span data-word="..." data-offset="...">` and call
 *   `onWordClick(surface, wordIndex, element)`; `wordIndex` counts words only,
 *   so it stays stable inside and outside marks;
 * - collocation ranges become `<mark data-collocation="...">` wrapping their
 *   original characters; overlapping spans are resolved before rendering, so a
 *   mark never nests inside another and no character is duplicated or dropped.
 */
export type SentenceTextProps = {
  text: string;
  cols?: CollocationSpan[];
  onWordClick?: (word: string, index: number, element: HTMLElement) => void;
  lang?: string;
  className?: string;
};

function clampSpan(span: CollocationSpan, text: string): CollocationSpan | null {
  const start = Math.max(0, Math.min(span.start, text.length));
  const end = Math.max(start, Math.min(span.end, text.length));
  if (end <= start) return null;
  return { ...span, start, end, text: text.slice(start, end) };
}

/**
 * Clamp to the sentence, sort, and drop overlaps. Earlier (then longer) spans
 * win; the runtime union already guarantees non-overlap, this is defence in
 * depth for direct callers (overlay/sidebar) and malformed fixtures.
 */
function normalizeSpans(
  cols: readonly CollocationSpan[] | undefined,
  text: string,
): CollocationSpan[] {
  if (!cols || cols.length === 0) return [];
  const sorted = cols
    .map((span) => clampSpan(span, text))
    .filter((span): span is CollocationSpan => span !== null)
    .sort((left, right) => left.start - right.start || right.end - left.end);

  const spans: CollocationSpan[] = [];
  for (const span of sorted) {
    const previous = spans[spans.length - 1];
    if (previous && span.start < previous.end) continue;
    spans.push(span);
  }
  return spans;
}

function wordClassName(interactive: boolean): string {
  return interactive ? 'cursor-pointer hover:underline hover:underline-offset-2' : '';
}

function renderToken(
  token: TextToken,
  wordIndex: number,
  onWordClick: SentenceTextProps['onWordClick'],
): ReactNode {
  if (token.kind !== 'word') {
    return <span key={`t-${token.start}`}>{token.text}</span>;
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    if (!onWordClick) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onWordClick(token.text, wordIndex, event.currentTarget);
  };

  return (
    <span
      key={`w-${token.start}`}
      data-word={normalizeWord(token.text)}
      data-offset={token.start}
      role={onWordClick ? 'button' : undefined}
      tabIndex={onWordClick ? 0 : undefined}
      className={wordClassName(Boolean(onWordClick))}
      onClick={
        onWordClick
          ? (event) => onWordClick(token.text, wordIndex, event.currentTarget)
          : undefined
      }
      onKeyDown={onWordClick ? handleKeyDown : undefined}
    >
      {token.text}
    </span>
  );
}

function renderTokenNode(
  token: TextToken,
  wordIndexRef: { current: number },
  onWordClick: SentenceTextProps['onWordClick'],
): ReactNode {
  const node = renderToken(
    token,
    token.kind === 'word' ? wordIndexRef.current : -1,
    onWordClick,
  );
  if (token.kind === 'word') wordIndexRef.current += 1;
  return node;
}

export function SentenceText({
  text,
  cols,
  onWordClick,
  lang = 'en',
  className,
}: SentenceTextProps) {
  const tokens = useMemo(() => tokenizeWords(text), [text]);
  const spans = useMemo(() => normalizeSpans(cols, text), [cols, text]);

  const content = useMemo(() => {
    const nodes: ReactNode[] = [];
    const wordIndex = { current: 0 };
    let index = 0;
    let spanIndex = 0;

    while (index < tokens.length) {
      const token = tokens[index];
      if (!token) break;

      // Skip spans that ended before this token; keep one that may cover it.
      while (spanIndex < spans.length) {
        const candidate = spans[spanIndex];
        if (candidate && candidate.end > token.start) break;
        spanIndex += 1;
      }
      const span = spans[spanIndex];

      // A token only joins a mark when it is fully inside the span. Partial
      // tokens at a boundary stay unmarked rather than being split, so word
      // identity (surface and index) is never broken.
      if (!span || token.start < span.start || token.end > span.end) {
        nodes.push(renderTokenNode(token, wordIndex, onWordClick));
        index += 1;
        continue;
      }

      const marked: ReactNode[] = [];
      while (index < tokens.length) {
        const current = tokens[index];
        if (!current || current.start < span.start || current.end > span.end) break;
        marked.push(renderTokenNode(current, wordIndex, onWordClick));
        index += 1;
      }

      nodes.push(
        <mark
          key={`c-${span.start}-${span.end}`}
          data-collocation={span.source}
          data-start={span.start}
          data-end={span.end}
          className="rounded-sm bg-yellow-200/70 text-inherit dark:bg-yellow-500/30"
          title={span.note}
        >
          {marked}
        </mark>,
      );
    }

    return nodes;
  }, [tokens, spans, onWordClick]);

  return (
    <span data-lang={lang} className={className}>
      {content}
    </span>
  );
}
