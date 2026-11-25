/**
 * Earworm — shared domain contracts.
 *
 * These types are the single source of truth for every feature. Later tickets
 * replace implementations but must keep these exported names, shapes and
 * units stable (see `docs/adr/` and `GLOSSARY.md`).
 *
 * Units:
 * - `Cue` / `Sentence` times are seconds (float).
 * - `CollocationSpan` offsets are UTF-16 code units into `Sentence.text`,
 *   `end` exclusive.
 */

export type Cue = { start: number; end: number; text: string };

/** Human-authored captions are preferred; YouTube ASR is the fallback. */
export type CueTrackKind = 'manual' | 'asr';

export type CueTrack = { videoId: string; lang: string; kind: CueTrackKind; cues: Cue[] };

export type Sentence = {
  /** 0-based, ascending within one video. */
  id: number;
  /** Covered cue range, seconds. */
  start: number;
  end: number;
  /** Cues joined with single spaces, trimmed. */
  text: string;
  /** Inclusive cue indexes covered by this sentence. */
  cueStart: number;
  cueEnd: number;
};

export type CollocationSpan = {
  /** UTF-16 offset into Sentence.text, inclusive. */
  start: number;
  /** UTF-16 offset into Sentence.text, exclusive. */
  end: number;
  /** Exactly `Sentence.text.slice(start, end)`. */
  text: string;
  source: 'offline' | 'llm';
  /** Chinese gloss; LLM spans only. */
  note?: string;
};

export type SentenceStatus = 'pending' | 'done' | 'failed';

export type LearningSentence = Sentence & {
  zh?: string;
  /** offline ∪ llm, LLM priority on overlap. */
  cols: CollocationSpan[];
  status: SentenceStatus;
};

export type VideoMeta = { videoId: string; title: string; channel: string };

export type LlmSettings = { baseUrl: string; apiKey: string; model: string };

export type Settings = {
  version: 1;
  llm: LlmSettings;
  /** Independent blur switches; default false/false. */
  blur: { en: boolean; zh: boolean };
  /** false = auto-pause at sentence end. */
  playback: { continuous: boolean };
  ui: {
    /** Global master switch: false restores native captions and yields shortcuts. */
    enabled: boolean;
    /** default true. */
    sidebar: boolean;
  };
};

/** Default LLM endpoint: local magpie gateway, group/free-ds model. */
export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  llm: {
    baseUrl: 'http://127.0.0.1:3425/v1',
    apiKey: '',
    model: 'group/free-ds',
  },
  blur: { en: false, zh: false },
  playback: { continuous: false },
  ui: { enabled: true, sidebar: true },
};

export type LlmCollocation = { text: string; note?: string };

export type LlmSentenceResult = { i: number; zh?: string; cols?: LlmCollocation[] };

/** Aligned by sentence index. Stored only for fully successful runs. */
export type CachedTranslation = {
  zh: string[];
  cols: LlmCollocation[][];
  model: string;
  ts: number;
};

export type WordEntry = {
  word: string;
  phonetic?: string;
  translation: string;
  pos?: string;
  /** Exam tags: zk / gk / cet4 / cet6 / ky / toefl / ielts / gre. */
  tags: string[];
  exchange?: string;
  /** Surface form when the headword was reached through lemmatization. */
  matchedForm?: string;
};
