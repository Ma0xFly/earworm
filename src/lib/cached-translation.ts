import type { CachedTranslation } from '@/lib/contracts';
import { isPlainRecord } from '@/lib/utils/is-record';

/**
 * Structural validator for a cached translation, shared by the background
 * cache (commit/read) and the runtime message router.
 *
 * One validator means a payload accepted by `earworm:commit` is exactly the
 * payload the cache can later read back: non-empty Chinese lines, a column
 * array aligned 1:1 with them, valid collocations, and a model/timestamp.
 */
export function isValidCachedTranslation(value: unknown): value is CachedTranslation {
  if (!isPlainRecord(value)) return false;

  const zh = value.zh;
  if (!Array.isArray(zh) || zh.length === 0) return false;
  if (!zh.every((line) => typeof line === 'string' && line.trim().length > 0)) return false;

  const cols = value.cols;
  if (!Array.isArray(cols) || cols.length !== zh.length) return false;
  for (const sentenceCols of cols) {
    if (!Array.isArray(sentenceCols)) return false;
    for (const collocation of sentenceCols) {
      if (!isPlainRecord(collocation)) return false;
      if (typeof collocation.text !== 'string' || collocation.text.length === 0) return false;
      if (collocation.note !== undefined && typeof collocation.note !== 'string') return false;
    }
  }

  return (
    typeof value.model === 'string' &&
    value.model.length > 0 &&
    typeof value.ts === 'number' &&
    Number.isFinite(value.ts) &&
    value.ts >= 0
  );
}
