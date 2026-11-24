/**
 * Pure building blocks of the session pipeline.
 *
 * These helpers deliberately keep every transformation synchronous and
 * side-effect free: the engine owns timing, concurrency and React state, while
 * this module owns the "cue → sentence → offline spans → cached/LLM merge"
 * data shapes. Keeping them pure makes the merge rules (offline ∪ LLM, LLM
 * priority, literal-substring alignment) straightforward to test.
 */

import type {
  CachedTranslation,
  CollocationSpan,
  LearningSentence,
  LlmSentenceResult,
  Sentence,
} from '@/lib/contracts';
import type { TranslateBatchItem } from '@/lib/messages';
import { unionSpans } from '@/lib/collocations';
import { alignCollocations } from '@/lib/llm/parse';
import type { SessionState, TranslationProgress } from './types';

export const IDLE_TRANSLATION: TranslationProgress = {
  state: 'idle',
  done: 0,
  total: 0,
  failed: 0,
};

export function createInitialState(videoId: string | null): SessionState {
  return {
    videoId,
    meta: null,
    status: videoId ? 'acquiring' : 'idle',
    sentences: [],
    currentIndex: 0,
    translation: { ...IDLE_TRANSLATION },
  };
}

/** Attach the offline spans computed at conversation time to every sentence. */
export function toLearningSentences(
  sentences: readonly Sentence[],
  offline: readonly CollocationSpan[][],
): LearningSentence[] {
  return sentences.map((sentence, index) => ({
    ...sentence,
    cols: offline[index] ?? [],
    status: 'pending',
  }));
}

/**
 * Batch items for the global sentence indices `indices`. `i` is always the
 * global index, and prev/next are the neighbouring merged sentences even when
 * they belong to another request batch — the model needs cross-batch context.
 */
export function buildBatchItems(
  sentences: readonly Pick<LearningSentence, 'text'>[],
  indices: readonly number[],
): TranslateBatchItem[] {
  return indices.map((index) => {
    const item: TranslateBatchItem = {
      i: index,
      text: sentences[index]?.text ?? '',
    };
    const prev = sentences[index - 1]?.text;
    const next = sentences[index + 1]?.text;
    if (prev !== undefined && prev.length > 0) item.prev = prev;
    if (next !== undefined && next.length > 0) item.next = next;
    return item;
  });
}

/** LLM collocations: literal-substring alignment, then LLM-priority union. */
export function llmSpans(
  sentenceText: string,
  cols: readonly { text: string; note?: string }[] | undefined,
): CollocationSpan[] {
  return alignCollocations(sentenceText, cols ?? []).map((span) => {
    const aligned: CollocationSpan = {
      start: span.start,
      end: span.end,
      text: span.text,
      source: 'llm',
    };
    if (span.note !== undefined) aligned.note = span.note;
    return aligned;
  });
}

/**
 * One translated sentence. Invalid/unmatched LLM spans are dropped by the
 * aligner but the translation is kept: a bad annotation never hides `zh`.
 */
export function applyLlmResult(
  offline: readonly CollocationSpan[],
  sentence: LearningSentence,
  result: LlmSentenceResult,
): LearningSentence {
  const zh = typeof result.zh === 'string' ? result.zh.trim() : '';
  if (zh.length === 0) {
    return sentence.status === 'done' ? sentence : { ...sentence, status: 'failed' };
  }
  return {
    ...sentence,
    zh,
    cols: unionSpans(offline, llmSpans(sentence.text, result.cols)),
    status: 'done',
  };
}

/** Apply one cached (all-batches-successful) row to its sentence. */
export function applyCachedSentence(
  offline: readonly CollocationSpan[],
  sentence: LearningSentence,
  zh: string | undefined,
  cols: readonly { text: string; note?: string }[] | undefined,
): LearningSentence {
  const text = typeof zh === 'string' ? zh.trim() : '';
  if (text.length === 0) {
    return sentence.status === 'done' ? sentence : { ...sentence, status: 'failed' };
  }
  return {
    ...sentence,
    zh: text,
    cols: unionSpans(offline, llmSpans(sentence.text, cols)),
    status: 'done',
  };
}

export function progressOf(sentences: readonly LearningSentence[]): {
  done: number;
  failed: number;
  pending: number;
} {
  let done = 0;
  let failed = 0;
  let pending = 0;
  for (const sentence of sentences) {
    if (sentence.status === 'done') done += 1;
    else if (sentence.status === 'failed') failed += 1;
    else pending += 1;
  }
  return { done, failed, pending };
}

/** Cache payload for a fully successful run (LLM spans only; offline recomputes). */
export function cachedTranslationFrom(
  sentences: readonly LearningSentence[],
  model: string,
  ts: number,
): CachedTranslation {
  return {
    zh: sentences.map((sentence) => sentence.zh ?? ''),
    cols: sentences.map((sentence) =>
      sentence.cols
        .filter((span) => span.source === 'llm')
        .map((span) => (span.note !== undefined ? { text: span.text, note: span.note } : { text: span.text })),
    ),
    model,
    ts,
  };
}

/**
 * Index of the sentence containing `time`, or the nearest previous one.
 *
 * Sentences are sorted by `start` (contract), so this is a binary search for
 * the last sentence that started at or before the playhead. Before the first
 * sentence the result clamps to 0; inside a gap it keeps the previous sentence.
 */
export function currentSentenceIndex(
  sentences: readonly Pick<LearningSentence, 'start'>[],
  time: number,
): number {
  if (sentences.length === 0) return 0;
  if (!Number.isFinite(time)) return 0;

  let low = 0;
  let high = sentences.length - 1;
  let candidate = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const start = sentences[middle]?.start ?? 0;
    if (start <= time) {
      candidate = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return candidate;
}

/**
 * Run `limit` tasks at a time, preserving no particular completion order.
 * Each task must handle its own failures; a rejection escapes to the caller.
 */
export async function runPool(
  tasks: readonly (() => Promise<void>)[],
  limit: number,
): Promise<void> {
  const width = Math.max(1, Math.min(Math.trunc(limit) || 1, tasks.length));
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= tasks.length) return;
      await tasks[index]!();
    }
  }

  await Promise.all(Array.from({ length: width }, () => worker()));
}

/** Structural equality for one sentence's span list (recompute guard). */
export function sameSpans(
  left: readonly CollocationSpan[],
  right: readonly CollocationSpan[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (
      a.start !== b.start ||
      a.end !== b.end ||
      a.text !== b.text ||
      a.source !== b.source ||
      a.note !== b.note
    ) {
      return false;
    }
  }
  return true;
}

/** True when every sentence of the track has been translated successfully. */
export function isFullyTranslated(sentences: readonly LearningSentence[]): boolean {
  return (
    sentences.length > 0 &&
    sentences.every(
      (sentence) =>
        sentence.status === 'done' &&
        typeof sentence.zh === 'string' &&
        sentence.zh.trim().length > 0,
    )
  );
}
