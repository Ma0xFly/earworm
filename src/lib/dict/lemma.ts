/**
 * Lemma and `exchange` parsing shared by the build script and the runtime.
 *
 * ECDICT ships two independent sources of word forms:
 *
 * - `exchange` inside `ecdict.csv`, e.g. `p:was/3:is/d:been/i:being`, with the
 *   codes `p` (past), `d` (past participle), `i` (-ing), `3` (third person
 *   singular), `r` (comparative), `t` (superlative), `s` (plural), `f`
 *   (alternative plural) and `0` (the headword root). Codes `1`/`2`/`4`/`5`
 *   are not form lists and are ignored.
 * - `lemma.en.txt`, lines of `lemma/count -> form1,form2,...` compiled from BNC
 *   frequency data. The counts let us resolve forms claimed by several lemmas,
 *   and the same file supplies the occasional root (`0:run`) that `exchange`
 *   already records.
 *
 * All exported functions are pure so tests and the Node build script can use
 * them without the browser runtime.
 */

/** One parsed `lemma.en.txt` line. `count` is 0 when the file omits it. */
export type LemmaGroup = {
  lemma: string;
  count: number;
  forms: string[];
};

export type ExchangeForm = {
  /** One of `p,d,i,3,r,t,s,f`; unknown codes are dropped while parsing. */
  code: string;
  form: string;
};

/** Exchange codes that describe inflected forms (as opposed to the root). */
export const EXCHANGE_FORM_CODES: ReadonlySet<string> = new Set([
  'p',
  'd',
  'i',
  '3',
  'r',
  't',
  's',
  'f',
]);

/**
 * Parse a whole `lemma.en.txt` file. Comment/blank lines are skipped, lemma
 * and forms are lowercased, and forms keep their file order without duplicates.
 */
export function parseLemmaText(text: string): LemmaGroup[] {
  const groups: LemmaGroup[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;

    const arrow = line.indexOf('->');
    if (arrow < 0) continue;

    const head = line.slice(0, arrow).trim();
    const tail = line.slice(arrow + 2);
    const slash = head.lastIndexOf('/');
    const hasCount = slash >= 0 && /^\d+$/.test(head.slice(slash + 1).trim());

    const lemma = (hasCount ? head.slice(0, slash) : head).trim().toLowerCase();
    if (!lemma) continue;

    const count = hasCount ? Number.parseInt(head.slice(slash + 1).trim(), 10) : 0;
    const forms: string[] = [];
    const seen = new Set<string>();
    for (const rawForm of tail.split(',')) {
      const form = rawForm.trim().toLowerCase();
      if (!form || seen.has(form)) continue;
      seen.add(form);
      forms.push(form);
    }
    if (forms.length === 0) continue;
    groups.push({ lemma, count: Number.isFinite(count) ? count : 0, forms });
  }
  return groups;
}

/**
 * Split an `exchange` value into its known inflected forms. The root (`0:`) and
 * marker (`1:`) entries are excluded; [`exchangeRoot`] exposes the root.
 */
export function parseExchange(exchange: string | null | undefined): ExchangeForm[] {
  if (!exchange) return [];
  const forms: ExchangeForm[] = [];
  for (const part of exchange.split('/')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const code = part.slice(0, colon).trim().toLowerCase();
    if (!EXCHANGE_FORM_CODES.has(code)) continue;
    const form = part.slice(colon + 1).trim();
    if (!form) continue;
    forms.push({ code, form });
  }
  return forms;
}

/** The lemma/root recorded under exchange code `0` (`better` -> `good`). */
export function exchangeRoot(exchange: string | null | undefined): string | undefined {
  if (!exchange) return undefined;
  for (const part of exchange.split('/')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    if (part.slice(0, colon).trim() !== '0') continue;
    const root = part.slice(colon + 1).trim().toLowerCase();
    if (root) return root;
  }
  return undefined;
}

/**
 * Build the inflected-form -> headword index used as the last lookup fallback.
 * `entries` yields `[word, exchange]` pairs. When two headwords claim the same
 * form the first one wins, so callers must pass a deterministic order (the
 * build script passes ECDICT's own row order).
 */
export function buildExchangeIndex(
  entries: Iterable<readonly [string, string | null | undefined]>,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const [word, exchange] of entries) {
    const headword = word.trim().toLowerCase();
    if (!headword) continue;
    for (const { form } of parseExchange(exchange)) {
      const normalized = form.trim().toLowerCase();
      if (!normalized || normalized === headword || index.has(normalized)) continue;
      index.set(normalized, headword);
    }
  }
  return index;
}

/**
 * Build the surface-form -> lemma index shipped as `lemmas.json`.
 *
 * Rules:
 * - only lemmas that are themselves dictionary headwords are kept;
 * - multiword forms and identity mappings are skipped (lookup already tries the
 *   exact surface before the index);
 * - a form claimed by several lemmas is only kept when the ECDICT `exchange`
 *   index proves one of the candidates is the inflected root. This filters
 *   cross-paradigm noise such as `they -> he` / `they -> it`, while keeping
 *   `has -> have` (have's exchange lists `3:has`) and `better -> good`.
 */
export function buildLemmaIndex(
  groups: LemmaGroup[],
  knownWords: Iterable<string>,
  exchangeIndex?: ReadonlyMap<string, string>,
): Map<string, string> {
  const known = new Set<string>();
  for (const word of knownWords) known.add(word.trim().toLowerCase());

  const candidates = new Map<string, Set<string>>();
  for (const group of groups) {
    const lemma = group.lemma.trim().toLowerCase();
    if (!lemma || !known.has(lemma)) continue;
    for (const rawForm of group.forms) {
      const form = rawForm.trim().toLowerCase();
      if (!form || form === lemma || /\s/.test(form)) continue;
      const forms = candidates.get(form) ?? new Set<string>();
      forms.add(lemma);
      candidates.set(form, forms);
    }
  }

  const index = new Map<string, string>();
  for (const [form, lemmas] of candidates) {
    if (lemmas.size === 1) {
      const [lemma] = lemmas;
      if (lemma) index.set(form, lemma);
      continue;
    }
    const evidence = exchangeIndex?.get(form);
    if (evidence && lemmas.has(evidence)) index.set(form, evidence);
  }
  return index;
}
