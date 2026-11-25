/**
 * Cue → sentence merging for the overlay/sidebar/navigation pipeline.
 *
 * Pure function: no DOM, no chrome APIs. Consumes YouTube's 2–3 s cues and
 * emits the "字幕句" (Sentence) unit defined in `GLOSSARY.md` and
 * `src/lib/contracts.ts`.
 *
 * Contract highlights (see `docs/adr/` and `GLOSSARY.md`):
 * - `text` is exactly the normalized cue text(s) joined with single spaces, so
 *   collocation span offsets computed on it stay stable.
 * - `cueStart`/`cueEnd` are inclusive indexes into the *input* `cues` array.
 * - times are seconds; a sentence spans min(start)…max(end) of its cues.
 */

import type { Cue, Sentence } from '@/lib/contracts';

/** ASR sentence break: silence between adjacent cues, in seconds (spec §5). */
export const ASR_PAUSE_SECONDS = 0.8;
/** ASR sentence break: word cap, applied on a cue/fragment boundary (spec §5). */
export const ASR_MAX_WORDS = 20;

/** Tunable ASR sentence rules; absent fields fall back to the spec defaults. */
export type MergeOptions = {
  /** Apply the ASR pause/word-count rules in addition to punctuation. */
  asr?: boolean;
  /** Pause between adjacent cues that ends a sentence (ASR only). */
  pauseSeconds?: number;
  /** Sentence word cap (ASR only). */
  maxWords?: number;
};

/** Invisible characters that must never reach sentence text. */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;

/** Sentence-terminal punctuation and the closers that may follow it. */
const TERMINAL_CHARS = new Set(['.', '!', '?', '…']);
const CLOSING_CHARS = new Set(['"', "'", '”', '’', ')', ']']);

/**
 * Heuristic abbreviation list for a `.` that is followed by more text. Only
 * a *single* dot mid-cue is ever ambiguous: `...` is an ellipsis (terminal),
 * `3.14` is caught by the "no space after the dot" rule, and a dot at the very
 * end of the cue always closes the sentence.
 *
 * A word-initial followed by more text (`J. Smith`) and dotted acronyms or
 * multi-word abbreviations (`U.S`, `e.g`, `Ph.D`) are matched structurally
 * below, so only plain word abbreviations need to be listed.
 */
const WORD_ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'ave', 'blvd', 'rd',
  'etc', 'eg', 'ie', 'vs', 'approx', 'dept', 'est', 'fig', 'al', 'inc', 'ltd',
  'co', 'corp', 'gov', 'sen', 'rep', 'gen', 'col', 'capt', 'lt', 'sgt', 'rev',
  'hon', 'pres', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept',
  'oct', 'nov', 'dec', 'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs',
  'fri', 'sat', 'sun', 'min', 'max',
]);

/** Case-sensitive abbreviations whose lowercase form is an ordinary word. */
const CASED_ABBREVIATIONS = new Set(['No', 'Nos']);

/** Normalize one cue's text: strip zero-width chars, collapse whitespace. */
function normalizeCueText(text: string): string {
  return text.replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();
}

/** True when text has at least one letter or digit (punctuation-only cues are junk). */
function hasContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/** Whitespace-separated word count of one fragment (normalized text). */
function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** One piece of a cue that belongs to exactly one sentence. */
type Fragment = {
  text: string;
  start: number;
  end: number;
  cueIndex: number;
  /** True when this piece ends with sentence-terminal punctuation. */
  closes: boolean;
};

type Piece = { text: string; closes: boolean };

/** Letters/dots immediately before a dot: `Mr`, `U.S`, `e.g`, `Ph.D`. */
function abbreviationToken(text: string, dotIndex: number): string {
  let start = dotIndex;
  while (start > 0 && /[A-Za-z.]/.test(text[start - 1]!)) start -= 1;
  return text.slice(start, dotIndex);
}

/** Heuristic: is this single `.` an abbreviation/initial rather than a sentence end? */
function isAbbreviationDot(text: string, dotIndex: number): boolean {
  const token = abbreviationToken(text, dotIndex);
  if (token === '') return false;
  if (WORD_ABBREVIATIONS.has(token.toLowerCase())) return true;
  if (CASED_ABBREVIATIONS.has(token)) return true;
  // Word-initial (`J. Smith`) or dotted abbreviation/acronym (`U.S`, `e.g`, `Ph.D`).
  if (/^[A-Za-z]$/.test(token)) return true;
  if (/^(?:[A-Za-z]+\.)+[A-Za-z]+$/.test(token)) return true;
  return false;
}

/**
 * Indexes just past every sentence-terminal punctuation run (plus any closing
 * quotes/brackets). A terminator only counts when whitespace or end-of-text
 * follows, so `3.14`, `example.com` or `Mr.Smith` are not split here.
 */
function sentenceEndPositions(text: string): number[] {
  const ends: number[] = [];
  let index = 0;

  while (index < text.length) {
    if (!TERMINAL_CHARS.has(text[index]!)) {
      index += 1;
      continue;
    }

    let runEnd = index + 1;
    while (runEnd < text.length && TERMINAL_CHARS.has(text[runEnd]!)) runEnd += 1;
    let end = runEnd;
    while (end < text.length && CLOSING_CHARS.has(text[end]!)) end += 1;

    // Mid-token dots (`3.14`, `U.S.A` without a space) are not sentence ends.
    if (end < text.length && !/\s/.test(text[end]!)) {
      index = end;
      continue;
    }

    // A single `.` is ambiguous mid-cue; at the cue's end it always closes.
    const singleDot = runEnd - index === 1 && text[index] === '.';
    const hasFollowingText = /\S/.test(text.slice(end));
    if (singleDot && hasFollowingText && isAbbreviationDot(text, index)) {
      index = end;
      continue;
    }

    ends.push(end);
    index = end;
  }

  return ends;
}

/** Split one normalized cue at its sentence ends, keeping text exactly covered. */
function cuePieces(text: string): Piece[] {
  const ends = sentenceEndPositions(text);
  if (ends.length === 0) return [{ text, closes: false }];

  const pieces: Piece[] = [];
  let cursor = 0;
  for (const end of ends) {
    pieces.push({ text: text.slice(cursor, end).trim(), closes: true });
    cursor = end;
  }

  // An unterminated tail folds into the next cue as part of the same sentence.
  const tail = text.slice(cursor).trim();
  if (tail) pieces.push({ text: tail, closes: false });

  return pieces.filter((piece) => piece.text && hasContent(piece.text));
}

/** Turn a cue into fragments, splitting its [start, end] proportionally to characters. */
function cueFragments(cue: Cue, cueIndex: number): Fragment[] {
  const text = normalizeCueText(cue.text);
  if (!text || !hasContent(text)) return [];

  const pieces = cuePieces(text);
  if (pieces.length === 0) return [];
  if (pieces.length === 1) {
    return [{ ...pieces[0]!, start: cue.start, end: cue.end, cueIndex }];
  }

  const span = cue.end - cue.start;
  const total = pieces.reduce((sum, piece) => sum + piece.text.length, 0);
  let consumed = 0;

  return pieces.map((piece) => {
    const start = cue.start + (span * consumed) / total;
    consumed += piece.text.length;
    const end = cue.start + (span * consumed) / total;
    return { ...piece, start, end, cueIndex };
  });
}

/**
 * Merge YouTube cues into complete sentences.
 *
 * Manual tracks (the default) use punctuation only: a sentence ends at `. ! ? …`
 * optionally followed by closing quotes/brackets. A single `.` is ignored when
 * it belongs to a decimal (`3.14`), a common abbreviation (`Mr.`, `etc.`), a
 * dotted acronym (`U.S.`, `e.g.`) or a word-initial (`J. Smith`); a cue-final
 * dot always closes the sentence. Cues without a sentence end fold into the
 * next one, and a cue holding several sentences is split in time proportion to
 * each fragment's character count.
 *
 * ASR tracks (`{ asr: true }`) additionally end a sentence at a pause between
 * adjacent cues of at least `pauseSeconds` (default
 * {@link ASR_PAUSE_SECONDS}), and cap a sentence at `maxWords` words (default
 * {@link ASR_MAX_WORDS}), breaking on a fragment boundary. Punctuation rules
 * still apply first; every break lands between fragments, so `text` stays
 * exactly the in-order cue text joined with single spaces.
 */
export function mergeCuesToSentences(cues: Cue[], options: MergeOptions = {}): Sentence[] {
  const asr = options.asr === true;
  const pauseSeconds = options.pauseSeconds ?? ASR_PAUSE_SECONDS;
  const maxWords = options.maxWords ?? ASR_MAX_WORDS;
  const sentences: Sentence[] = [];
  let group: Fragment[] = [];
  let groupWords = 0;

  const flush = (): void => {
    if (group.length === 0) return;
    sentences.push({
      id: sentences.length,
      start: Math.min(...group.map((fragment) => fragment.start)),
      end: Math.max(...group.map((fragment) => fragment.end)),
      text: group.map((fragment) => fragment.text).join(' '),
      cueStart: group[0]!.cueIndex,
      cueEnd: group[group.length - 1]!.cueIndex,
    });
    group = [];
    groupWords = 0;
  };

  cues.forEach((cue, cueIndex) => {
    for (const fragment of cueFragments(cue, cueIndex)) {
      if (asr && group.length > 0) {
        const previousCue = cues[group[group.length - 1]!.cueIndex];
        // ASR pause rule: a gap since the previous contributing cue's end.
        // Cues with no text never reach here, so an empty cue cannot fake a
        // pause by widening the gap to the previous real cue.
        if (previousCue && cue.start - previousCue.end >= pauseSeconds) flush();
      }
      if (asr && group.length > 0) {
        // Word cap: never let the accumulated sentence grow past `maxWords`.
        // A single fragment longer than the cap still stands alone.
        if (groupWords + wordCount(fragment.text) > maxWords) flush();
      }
      group.push(fragment);
      groupWords += wordCount(fragment.text);
      // Punctuation always closes first; the ASR rules only add boundaries.
      if (fragment.closes) flush();
    }
  });

  // A trailing group without terminal punctuation still becomes its own sentence.
  flush();

  return sentences;
}
