import type { CachedTranslation, Cue, LlmCollocation } from '../src/lib/contracts';

/**
 * Offline fixtures for the playground (T14).
 *
 * One English "lesson" worth of manually-transcribed sentences, each with a
 * Chinese translation and a few idiomatic collocations. The cue list is derived
 * from the sentence list so `mergeCuesToSentences()` (T2) reconstructs exactly
 * these sentences — the smoke script asserts that invariant.
 *
 * The fixture intentionally contains:
 * - multi-cue sentences (no punctuation on the leading cue);
 * - colloquial phrases the offline bigram table / LLM spans can highlight;
 * - a decimal (`2.5`) and an abbreviation (`e.g.`) that must not split a cue;
 * - a sentence a normal-scene run fails to translate once (`FLAKY_SENTENCE_TEXT`),
 *   which demonstrates the per-sentence retry path.
 */

export type FixtureSentence = {
  /** Cue texts for this sentence; joined with single spaces. */
  cues: readonly string[];
  zh: string;
  cols?: readonly LlmCollocation[];
};

export const FIXTURE_SENTENCES: readonly FixtureSentence[] = [
  {
    cues: ['Hey everyone, welcome back to the channel.'],
    zh: '大家好，欢迎回到频道。',
    cols: [
      { text: 'welcome back', note: '欢迎回来' },
      { text: 'to the channel', note: '回到频道' },
    ],
  },
  {
    cues: ["Today we're going to talk about", 'how to learn English with subtitles.'],
    zh: '今天我们要聊聊如何用字幕学英语。',
    cols: [
      { text: 'talk about', note: '谈论；聊聊' },
      { text: 'with subtitles', note: '借助字幕' },
    ],
  },
  {
    cues: ["It's easier than you think."],
    zh: '这比你想的要简单。',
    cols: [{ text: 'easier than', note: '比……更容易' }],
  },
  {
    cues: ['First, pause the video whenever you see a new word.'],
    zh: '首先，每当看到生词就暂停视频。',
    cols: [
      { text: 'pause the video', note: '暂停视频' },
      { text: 'a new word', note: '一个生词' },
    ],
  },
  {
    cues: ['Then look it up in the dictionary, e.g. with one click.'],
    zh: '然后查一下词典，比如点一下就行。',
    cols: [
      { text: 'look it up', note: '查阅（代词放在中间）' },
      { text: 'in the dictionary', note: '在词典里' },
    ],
  },
  {
    cues: ["Don't give up when a sentence is hard to follow."],
    zh: '句子跟不上时别放弃。',
    cols: [
      { text: 'give up', note: '放弃' },
      { text: 'hard to follow', note: '难以跟上' },
    ],
  },
  {
    cues: ['Write down the phrases that keep showing up.'],
    zh: '把反复出现的短语记下来。',
    cols: [
      { text: 'Write down', note: '记下' },
      { text: 'keep showing up', note: '不断出现' },
    ],
  },
  {
    cues: ['It only takes about 2.5 minutes a day.'],
    zh: '每天只需大约 2.5 分钟。',
    cols: [{ text: 'It only takes', note: '只需要' }],
  },
  {
    cues: ['You will get the hang of it', 'soon.'],
    zh: '你很快就会掌握窍门。',
    cols: [{ text: 'get the hang of', note: '掌握……的窍门' }],
  },
  {
    cues: ["Let's get started with the first sentence."],
    zh: '我们从第一句开始吧。',
    cols: [{ text: 'get started', note: '开始' }],
  },
  {
    cues: ['Listen carefully to the rhythm of the speaker.'],
    zh: '仔细听说话人的节奏。',
    cols: [
      { text: 'Listen carefully', note: '仔细听' },
      { text: 'the rhythm', note: '节奏' },
    ],
  },
  {
    cues: ['Shadow the audio and copy the intonation.'],
    zh: '跟着音频影子跟读，模仿语调。',
    cols: [
      { text: 'Shadow the audio', note: '影子跟读音频' },
      { text: 'copy the intonation', note: '模仿语调' },
    ],
  },
  {
    cues: ['Remember that progress comes from small habits.'],
    zh: '记住，进步来自小习惯。',
    cols: [{ text: 'progress comes from', note: '进步来自' }],
  },
  {
    cues: ['See you in the next lesson.'],
    zh: '下节课见。',
    cols: [{ text: 'See you', note: '再见' }],
  },
];

const LEAD_IN_SECONDS = 0.4;
const CUE_GAP_SECONDS = 0.06;
const MODEL_NAME = 'earworm-playground/mock-llm';

function cueDuration(text: string): number {
  return 0.55 + text.length * 0.045;
}

function roundTime(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/** The sentence text T2 will produce from a fixture sentence's cues. */
export function fixtureSentenceText(sentence: FixtureSentence): string {
  return sentence.cues.join(' ');
}

export const FIXTURE_SENTENCE_TEXTS: readonly string[] = FIXTURE_SENTENCES.map(
  fixtureSentenceText,
);

/** Build a contiguous manual-English cue track from the sentence fixtures. */
export function buildFixtureCues(
  sentences: readonly FixtureSentence[] = FIXTURE_SENTENCES,
): Cue[] {
  const cues: Cue[] = [];
  let cursor = LEAD_IN_SECONDS;

  for (const sentence of sentences) {
    for (const text of sentence.cues) {
      const duration = cueDuration(text);
      const start = roundTime(cursor);
      const end = roundTime(cursor + duration);
      cues.push({ start, end, text });
      cursor = end + CUE_GAP_SECONDS;
    }
  }

  return cues;
}

export const FIXTURE_CUES: Cue[] = buildFixtureCues();

const lastCue = FIXTURE_CUES[FIXTURE_CUES.length - 1];

/** Mock video duration: a little past the last cue so the clamp never bites. */
export const FIXTURE_DURATION = lastCue ? Math.ceil(lastCue.end + 6) : 45;

export type FixtureTranslation = {
  zh: string;
  cols: readonly LlmCollocation[];
};

/** Translation lookup keyed by the merged sentence text (not by index). */
export const FIXTURE_TRANSLATIONS: ReadonlyMap<string, FixtureTranslation> = new Map(
  FIXTURE_SENTENCES.map((sentence, index) => [
    FIXTURE_SENTENCE_TEXTS[index] ?? fixtureSentenceText(sentence),
    { zh: sentence.zh, cols: sentence.cols ?? [] },
  ]),
);

/**
 * The sentence the normal scene deliberately fails on the first translation
 * attempt; its per-sentence retry succeeds immediately afterwards.
 */
export const FLAKY_SENTENCE_TEXT = FIXTURE_SENTENCE_TEXTS[6] ?? '';

/** A fully translated cache payload, aligned with the merged fixture sentences. */
export function buildFixtureCachedTranslation(ts = Date.now()): CachedTranslation {
  return {
    zh: FIXTURE_SENTENCES.map((sentence) => sentence.zh),
    cols: FIXTURE_SENTENCES.map((sentence) =>
      (sentence.cols ?? []).map((collocation) =>
        collocation.note === undefined
          ? { text: collocation.text }
          : { text: collocation.text, note: collocation.note },
      ),
    ),
    model: MODEL_NAME,
    ts,
  };
}

export const FIXTURE_MODEL = MODEL_NAME;
