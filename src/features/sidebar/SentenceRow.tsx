/**
 * Sidebar row adapts the easysubs transcript row behaviour: one row per
 * subtitle line, `data-id` hook, role=button + Enter/Space seek, and a
 * stop-propagation wrapper so player clicks are not affected.
 *
 * Adapted from easysubs (https://github.com/Nitrino/easysubs)
 * Copyright (c) 2022 Seo Jong Hak
 * MIT License — see NOTICE.
 */
import { memo, type KeyboardEvent, type MouseEvent } from 'react';
import type { LearningSentence } from '@/lib/contracts';
import { SentenceText } from '@/features/reading/SentenceText';
import { cn } from '@/lib/utils';

export type SentenceRowProps = {
  sentence: LearningSentence;
  isCurrent: boolean;
  onSeek: (id: number) => void;
  onRetry: (id: number) => void;
};

/**
 * One sentence row.
 *
 * Memoized because a 500+ sentence list re-renders on every playback tick that
 * changes `currentIndex`: without memo every row's `SentenceText` would
 * re-tokenize its text, with memo only the old and new current rows re-render
 * (the sentence objects and callbacks are stable). We intentionally skip a
 * virtual list for v1: rows are cheap (~1–2 lexical tokens per word), 500–1500
 * rows is acceptable, and `scrollIntoView({block:'center'})` plus browser find
 * need real mounted rows. Revisit with `content-visibility: auto` if a 3h
 * video measures poorly.
 */
function SentenceRowImpl({ sentence, isCurrent, onSeek, onRetry }: SentenceRowProps) {
  const handleClick = (_event: MouseEvent<HTMLDivElement>): void => {
    onSeek(sentence.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Keys from the nested retry button belong to that button.
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSeek(sentence.id);
  };

  const handleRetry = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    onRetry(sentence.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-sentence-id={sentence.id}
      aria-current={isCurrent ? 'true' : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'cursor-pointer rounded-md border-l-2 px-2.5 py-2 outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        isCurrent
          ? 'border-amber-500 bg-amber-100/80'
          : 'border-transparent hover:bg-muted/70',
      )}
    >
      <p className="text-sm leading-snug text-foreground">
        <SentenceText text={sentence.text} lang="en" />
      </p>

      {sentence.status === 'done' && sentence.zh ? (
        <p
          data-lang="zh"
          className="mt-0.5 text-xs leading-snug text-muted-foreground"
        >
          {sentence.zh}
        </p>
      ) : null}

      {sentence.status === 'pending' ? (
        <p
          data-translation-pending
          className="mt-0.5 text-xs leading-snug text-muted-foreground/80 italic"
        >
          翻译中…
        </p>
      ) : null}

      {sentence.status === 'failed' ? (
        <p className="mt-0.5 flex items-center gap-2 text-xs leading-snug text-muted-foreground">
          <span data-translation-failed>翻译失败</span>
          <button
            type="button"
            onClick={handleRetry}
            className="rounded px-1.5 py-0.5 font-medium text-red-600 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            重试
          </button>
        </p>
      ) : null}
    </div>
  );
}

export const SentenceRow = memo(SentenceRowImpl);
