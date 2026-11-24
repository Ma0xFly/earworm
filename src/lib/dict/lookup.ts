/**
 * Offline dictionary lookup.
 *
 * Resolution order:
 *   1. exact headword (case-insensitive, curly apostrophes normalized);
 *   2. lemma reverse map from `lemma.en.txt`;
 *   3. ECDICT `exchange` forms.
 *
 * For an exact hit that is itself an inflected form (`running`, `better`) the
 * headword is preferred and `matchedForm` records the surface, which is what the
 * dictionary popup shows. `lookupWord` never throws: an unavailable offline data
 * file degrades to `null` so the popup can show 「未收录」.
 */

import type { WordEntry } from '@/lib/contracts';
import { normalizeWord } from '@/lib/text/tokenize';
import type { LoadDictionaryOptions, Dictionary } from './import';
import { loadDictionary } from './import';
import { exchangeRoot } from './lemma';

let activeDictionary: Dictionary | null = null;
let dictionaryLoading: Promise<Dictionary | null> | null = null;

export function getActiveDictionary(): Dictionary | null {
  return activeDictionary;
}

/** Inject a parsed dictionary (boot wiring, tests). */
export function setActiveDictionary(dictionary: Dictionary | null): void {
  activeDictionary = dictionary;
  dictionaryLoading = null;
}

/** Drop the cached dictionary so the next lookup loads it again. */
export function resetDictionary(): void {
  setActiveDictionary(null);
}

function withMatchedForm(entry: WordEntry, surface: string): WordEntry {
  if (entry.word.toLowerCase() === surface) return entry;
  return { ...entry, matchedForm: surface };
}

/**
 * Pure lookup against one dictionary instance. Exported for tests and for
 * callers that manage their own `Dictionary` (e.g. the playground).
 */
export function lookupInDictionary(dictionary: Dictionary, surface: string): WordEntry | null {
  const key = normalizeWord(surface);
  if (!key) return null;

  const exact = dictionary.byWord.get(key);
  if (exact) {
    // A headword can also be an inflected form (running, better, saw): show the
    // base entry but remember the surface the user clicked.
    const lemma = dictionary.byLemma.get(key);
    if (lemma && lemma !== key) {
      const headword = dictionary.byWord.get(lemma);
      if (headword) return withMatchedForm(headword, key);
    }
    const root = exchangeRoot(exact.exchange);
    if (root && root !== key) {
      const headword = dictionary.byWord.get(root);
      if (headword) return withMatchedForm(headword, key);
    }
    return exact;
  }

  const lemma = dictionary.byLemma.get(key);
  if (lemma && lemma !== key) {
    const headword = dictionary.byWord.get(lemma);
    if (headword) return withMatchedForm(headword, key);
  }

  const form = dictionary.byForm.get(key);
  if (form && form !== key) {
    const headword = dictionary.byWord.get(form);
    if (headword) return withMatchedForm(headword, key);
  }

  return null;
}

/**
 * Look a surface form up through the active dictionary. Loads the shipped JSON
 * on first use; a failed load resolves to `null` rather than throwing.
 */
export async function lookupWord(surface: string): Promise<WordEntry | null> {
  if (!activeDictionary) await preloadDictionary();
  if (!activeDictionary) return null;
  try {
    return lookupInDictionary(activeDictionary, surface);
  } catch {
    return null;
  }
}

/**
 * Start (or join) the dictionary load. Resolves with the dictionary, or `null`
 * when the offline assets are unavailable. Memory lookup becomes available as
 * soon as it resolves; the IndexedDB import continues in the background.
 */
export function preloadDictionary(
  options?: LoadDictionaryOptions,
): Promise<Dictionary | null> {
  if (activeDictionary) return Promise.resolve(activeDictionary);
  if (!dictionaryLoading) {
    dictionaryLoading = loadDictionary(options)
      .then((dictionary) => {
        activeDictionary = dictionary;
        return dictionary;
      })
      .catch((error: unknown) => {
        console.warn('[earworm] offline dictionary unavailable:', error);
        return null;
      });
  }
  return dictionaryLoading;
}

/**
 * Lowercase lemma for a surface form. Uses the lemma reverse map first, then
 * the ECDICT exchange root, else returns the lowercase surface. Synchronous: it
 * reads the dictionary already loaded by [`preloadDictionary`].
 */
export function lemmatize(surface: string): string {
  const key = normalizeWord(surface);
  if (!key) return '';
  if (!activeDictionary) return key;

  const lemma = activeDictionary.byLemma.get(key);
  if (lemma && activeDictionary.byWord.has(lemma)) return lemma;

  const exactRoot = exchangeRoot(activeDictionary.byWord.get(key)?.exchange);
  if (exactRoot && activeDictionary.byWord.has(exactRoot)) return exactRoot;

  const formRoot = activeDictionary.byForm.get(key);
  if (formRoot && activeDictionary.byWord.has(formRoot)) return formRoot;

  return key;
}
