import { useMemo, type KeyboardEvent, type ReactNode } from 'react';
import type { CollocationSpan } from '@/lib/contracts';
import { normalizeWord, tokenizeWords, type TextToken } from '@/lib/text/tokenize';

/**
 * Sentence renderer with clickable words and collocation highlighting.
 *
 * T1 scaffold: a small, working implementation that T6 replaces. Contract kept
 * for later tickets:
 * - `text` is rendered losslessly (`textContent === text`);
 * - the root carries `data-lang`;
 * - word tokens are `<span data-word="..." data-offset="...">` and call
 *   `onWordClick(surface, wordIndex, element)`;
 * - collocation ranges become `<mark data-collocation>`, never reordering or
 *   dropping characters.
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

function normalizeSpans(
  cols: readonly CollocationSpan[] | undefined,
  text: string,
): CollocationSpan[] {
  if (!cols || cols.length === 0) return [];
  return cols
    .map((span) => clampSpan(span, text))
    .filter((span): span is CollocationSpan => span !== null)
    .sort((a, b) => a.start - b.start || b.end - a.end);
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
    let index = 0;
    let wordIndex = 0;

    while (index < tokens.length) {
      const token = tokens[index];
      if (!token) break;
      const span = spans.find(
        (candidate) => token.start >= candidate.start && token.end <= candidate.end,
      );

      if (!span) {
        nodes.push(
          renderToken(token, token.kind === 'word' ? wordIndex : -1, onWordClick),
        );
        if (token.kind === 'word') wordIndex += 1;
        index += 1;
        continue;
      }

      const marked: ReactNode[] = [];
      while (index < tokens.length) {
        const current = tokens[index];
        if (!current || current.start < span.start || current.end > span.end) break;
        marked.push(
          renderToken(current, current.kind === 'word' ? wordIndex : -1, onWordClick),
        );
        if (current.kind === 'word') wordIndex += 1;
        index += 1;
      }
      nodes.push(
        <mark
          key={`c-${span.start}`}
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
