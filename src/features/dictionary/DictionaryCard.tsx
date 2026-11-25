/**
 * Presentational card inside the dictionary popup.
 *
 * Kept free of lookup/state/DOM plumbing so the popup component owns the
 * delegation and async lifecycle. The collocation card is rendered above the
 * dictionary entry when the clicked word sits inside a phrase span.
 */

import { XIcon } from 'lucide-react';
import type { CollocationSpan, WordEntry } from '@/lib/contracts';
import { examTagLabel, formatTranslation } from './selection';

export type DictionaryLookupView = {
  /** Surface form the user clicked (`running`, `hold`). */
  surface: string;
  status: 'loading' | 'ready' | 'miss';
  entry: WordEntry | null;
  span: CollocationSpan | null;
};

export type DictionaryCardProps = {
  view: DictionaryLookupView;
  onClose: () => void;
};

/** ECDICT phonetics usually come without delimiters; render them in slashes. */
function displayPhonetic(phonetic: string | undefined): string | null {
  const trimmed = phonetic?.trim();
  if (!trimmed) return null;
  const clean = trimmed
    .replace(/^[/[]+/, '')
    .replace(/[/\]]+$/, '')
    .trim();
  if (!clean) return null;
  return `/${clean}/`;
}

/** Part of speech and exam tags share a neutral 11px/600 pill: purple is reserved for collocations. */
const NEUTRAL_PILL_CLASS =
  'inline-flex items-center rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[11px] font-semibold leading-none text-secondary-foreground';

function CollocationCard({ span }: { span: CollocationSpan }) {
  return (
    <div
      data-ew-dict-collocation
      data-source={span.source}
      className="mb-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-collocation"
    >
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-[11px] font-semibold tracking-wide uppercase">搭配</span>
        <span data-ew-dict-phrase className="text-[13px] font-semibold text-collocation">
          {span.text}
        </span>
      </div>
      <p data-ew-dict-note className="mt-0.5 text-[13px] leading-snug text-collocation/80">
        {span.note ?? '离线搭配'}
      </p>
    </div>
  );
}

function EntryDetails({ entry }: { entry: WordEntry }) {
  const phonetic = displayPhonetic(entry.phonetic);
  const translation = formatTranslation(entry.translation);
  const inflected =
    entry.matchedForm !== undefined && entry.matchedForm !== entry.word
      ? entry.matchedForm
      : null;

  return (
    <>
      <div className="flex items-baseline gap-1.5 pr-5">
        {inflected ? (
          <>
            <span
              data-ew-dict-surface
              className="min-w-0 truncate text-sm text-muted-foreground"
            >
              {inflected}
            </span>
            <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground">
              →
            </span>
          </>
        ) : null}
        <span
          data-ew-dict-headword
          className="min-w-0 break-words text-[22px] font-bold leading-tight"
        >
          {entry.word}
        </span>
      </div>

      {phonetic || entry.pos ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground">
          {phonetic ? <span data-ew-dict-phonetic>{phonetic}</span> : null}
          {entry.pos ? (
            <span data-ew-dict-pos className={NEUTRAL_PILL_CLASS}>
              {entry.pos}
            </span>
          ) : null}
        </div>
      ) : null}

      {entry.tags.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {entry.tags.map((tag) => (
            <span key={tag} data-ew-dict-tag="" data-tag={tag} className={NEUTRAL_PILL_CLASS}>
              {examTagLabel(tag)}
            </span>
          ))}
        </div>
      ) : null}

      {translation ? (
        <div
          data-ew-dict-translation
          className="mt-2 max-h-40 overflow-y-auto overscroll-contain whitespace-pre-line text-sm leading-[1.6]"
        >
          {translation}
        </div>
      ) : null}
    </>
  );
}

/** Card body: collocation first, then the dictionary entry (or its states). */
export function DictionaryCard({ view, onClose }: DictionaryCardProps) {
  return (
    <div className="flex max-h-full min-h-0 flex-col overflow-hidden p-3">
      <button
        type="button"
        aria-label="关闭词典弹窗"
        title="关闭词典弹窗"
        onClick={onClose}
        className="absolute top-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <XIcon className="size-3.5" />
      </button>

      {view.span ? <CollocationCard span={view.span} /> : null}

      {view.status === 'ready' && view.entry ? (
        <EntryDetails entry={view.entry} />
      ) : null}

      {view.status === 'loading' ? (
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-base font-medium">{view.surface}</span>
          <span data-ew-dict-loading role="status" className="text-xs text-muted-foreground">
            查询中…
          </span>
        </div>
      ) : null}

      {view.status === 'miss' ? (
        <div data-ew-dict-miss className="text-sm">
          <span data-ew-dict-headword className="font-medium">
            {view.surface}
          </span>
          <span className="ml-1 text-muted-foreground">「未收录」</span>
        </div>
      ) : null}
    </div>
  );
}
