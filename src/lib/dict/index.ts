/**
 * Offline ECDICT dictionary: build artifacts, lookup and IndexedDB cache.
 *
 * Boot code calls `preloadDictionary()` once (fire-and-forget) so the first
 * click has a warm in-memory map; `lookupWord` / `lemmatize` are the stable
 * surfaces used by the dictionary popup and the collocation matcher.
 */

export {
  getActiveDictionary,
  lemmatize,
  lookupInDictionary,
  lookupWord,
  preloadDictionary,
  resetDictionary,
  setActiveDictionary,
} from './lookup';

export {
  createDictionary,
  decodeEcdictFile,
  decodeLemmaFile,
  dictionaryAssetUrl,
  importDictionaryToIdb,
  loadDictionary,
  rowToEntry,
  type Dictionary,
  type ImportDictionaryOptions,
  type ImportProgress,
  type ImportResult,
  type LoadDictionaryOptions,
} from './import';

export {
  DICT_DB_NAME,
  DICT_DB_VERSION,
  DICT_META_KEY,
  DICT_META_STORE,
  DICT_PROGRESS_KEY,
  DICT_WORDS_STORE,
  openDictDatabase,
  type DictMetaRecord,
  type DictProgressRecord,
  type DictRow,
  type EcdictFile,
  type EcdictMeta,
  type LemmaFile,
  type LemmaMeta,
  type StoredWord,
} from './db';

export {
  buildExchangeIndex,
  buildLemmaIndex,
  exchangeRoot,
  parseExchange,
  parseLemmaText,
  type ExchangeForm,
  type LemmaGroup,
} from './lemma';
