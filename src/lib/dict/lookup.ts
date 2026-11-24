import type { WordEntry } from '@/lib/contracts';

/**
 * Offline dictionary lookup (T1 stub).
 *
 * T5 replaces this with the ECDICT-backed lookup: exact match, then lemma
 * reverse lookup, then `exchange` fallback. Returns `null` on a miss and never
 * throws (the popup shows 「未收录」 instead of crashing).
 */
export async function lookupWord(_surface: string): Promise<WordEntry | null> {
  return null;
}
