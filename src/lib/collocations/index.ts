/**
 * Offline collocations: shipped bigram table, lemma-aware matching, and the
 * offline ∪ LLM union with LLM priority.
 *
 * Stable surfaces consumed by later tickets:
 * - [`loadCollocationTable`] — fetch/cache `public/data/collocations.json`;
 * - [`computeOfflineSpans`] — synchronous spans for one sentence, using the
 *   loaded table and the active dictionary's `lemmatize`;
 * - [`unionSpans`] — merge offline and LLM spans (LLM wins overlaps).
 */

export {
  computeOfflineSpans,
  decodeCollocationFile,
  getCollocationMeta,
  loadCollocationTable,
  resetCollocationTable,
  setCollocationTable,
  type CollocationEntry,
  type CollocationFile,
  type CollocationMeta,
  type DecodedCollocationFile,
  type LoadCollocationOptions,
} from './data';

export {
  buildCollocationIndex,
  matchCollocations,
  matchIndexedCollocations,
  MAX_COLLOCATION_TOKENS,
  type CollocationIndex,
} from './matcher';

export { unionSpans } from './union';
