import type { CollocationSpan, Sentence } from '@/lib/contracts';

/**
 * Offline collocation table (T1 stub).
 *
 * T6 replaces this directory with `data.ts` / `matcher.ts` / `union.ts`:
 * OpenSubtitles bigram cleaning, lemma-aware matching, and the offline ∪ LLM
 * union with LLM priority on overlap. Keep `computeOfflineSpans`,
 * `unionSpans` and `loadCollocationTable` stable for T13.
 */

/** A raw bigram entry, e.g. `"give up"`. */
export type CollocationEntry = { text: string; score?: number; type?: string };

/** Spans found in the offline table; empty until T6 loads the data. */
export function computeOfflineSpans(_sentence: Sentence): CollocationSpan[] {
  return [];
}

/** Merge offline and LLM spans; the stub simply sorts without overlap logic. */
export function unionSpans(
  offline: CollocationSpan[],
  llm: CollocationSpan[],
): CollocationSpan[] {
  return [...offline, ...llm].sort((a, b) => a.start - b.start || b.end - a.end);
}

/** Load and cache the collocation table; empty until T6. */
export async function loadCollocationTable(): Promise<CollocationEntry[]> {
  return [];
}
