import { describe, expect, it } from 'vitest';
import type { Cue } from '@/lib/contracts';
import { REALISTIC_CUES, REALISTIC_SENTENCES } from './__fixtures__/realistic';
import { ASR_MAX_WORDS, ASR_PAUSE_SECONDS, mergeCuesToSentences } from './merge';

describe('mergeCuesToSentences', () => {
  it('keeps one punctuated cue as one sentence', () => {
    const cues: Cue[] = [{ start: 1.2, end: 3.4, text: 'Hello world.' }];

    expect(mergeCuesToSentences(cues)).toEqual([
      {
        id: 0,
        start: 1.2,
        end: 3.4,
        text: 'Hello world.',
        cueStart: 0,
        cueEnd: 0,
      },
    ]);
  });

  it('folds unpunctuated cues into the next sentence and spans their times', () => {
    const cues: Cue[] = [
      { start: 0, end: 2, text: 'I was' },
      { start: 2, end: 4.5, text: 'walking home' },
      { start: 4.5, end: 6, text: 'when it started raining.' },
      { start: 6, end: 8, text: 'I ran.' },
    ];

    expect(mergeCuesToSentences(cues)).toEqual([
      {
        id: 0,
        start: 0,
        end: 6,
        text: 'I was walking home when it started raining.',
        cueStart: 0,
        cueEnd: 2,
      },
      { id: 1, start: 6, end: 8, text: 'I ran.', cueStart: 3, cueEnd: 3 },
    ]);
  });

  it('splits a multi-sentence cue by character proportion', () => {
    const cues: Cue[] = [
      { start: 10, end: 14, text: 'We left early. The traffic was terrible. Nobody complained.' },
    ];

    const sentences = mergeCuesToSentences(cues);

    // 14 / 25 / 18 characters ⇒ split points at 14/57 and 39/57 of the 4 s span.
    expect(sentences.map(({ id, text, cueStart, cueEnd }) => ({ id, text, cueStart, cueEnd }))).toEqual([
      { id: 0, text: 'We left early.', cueStart: 0, cueEnd: 0 },
      { id: 1, text: 'The traffic was terrible.', cueStart: 0, cueEnd: 0 },
      { id: 2, text: 'Nobody complained.', cueStart: 0, cueEnd: 0 },
    ]);
    expect(sentences[0]!.start).toBe(10);
    expect(sentences[0]!.end).toBeCloseTo(10 + (4 * 14) / 57, 5);
    expect(sentences[1]!.start).toBeCloseTo(sentences[0]!.end, 10);
    expect(sentences[1]!.end).toBeCloseTo(10 + (4 * 39) / 57, 5);
    expect(sentences[2]!.end).toBe(14);
  });

  it('keeps a trailing unterminated cue as its own sentence', () => {
    const cues: Cue[] = [
      { start: 0, end: 2, text: 'I was walking.' },
      { start: 2, end: 4.25, text: 'then I stopped' },
    ];

    expect(mergeCuesToSentences(cues)).toEqual([
      { id: 0, start: 0, end: 2, text: 'I was walking.', cueStart: 0, cueEnd: 0 },
      { id: 1, start: 2, end: 4.25, text: 'then I stopped', cueStart: 1, cueEnd: 1 },
    ]);
  });

  it('does not split on decimals and common abbreviations', () => {
    const cues: Cue[] = [
      { start: 0, end: 3, text: 'Mr. Smith moved to the U.S. in 2019.' },
      { start: 3, end: 5, text: 'He paid 3.14 dollars, i.e. less than expected.' },
    ];

    expect(mergeCuesToSentences(cues)).toEqual([
      {
        id: 0,
        start: 0,
        end: 3,
        text: 'Mr. Smith moved to the U.S. in 2019.',
        cueStart: 0,
        cueEnd: 0,
      },
      {
        id: 1,
        start: 3,
        end: 5,
        text: 'He paid 3.14 dollars, i.e. less than expected.',
        cueStart: 1,
        cueEnd: 1,
      },
    ]);
  });

  it('treats an abbreviation at the very end of a cue as the sentence end', () => {
    const cues: Cue[] = [
      { start: 0, end: 2, text: 'I live in the U.S.' },
      { start: 2, end: 4, text: 'It is big.' },
    ];

    expect(mergeCuesToSentences(cues).map(({ text, cueStart, cueEnd }) => ({ text, cueStart, cueEnd }))).toEqual([
      { text: 'I live in the U.S.', cueStart: 0, cueEnd: 0 },
      { text: 'It is big.', cueStart: 1, cueEnd: 1 },
    ]);
  });

  it('normalizes whitespace and zero-width characters, and drops empty cues', () => {
    const cues: Cue[] = [
      { start: 0, end: 1, text: '  Hel\u200Blo   there, ' },
      { start: 1, end: 1.5, text: '   ' },
      { start: 1.5, end: 2, text: '\u200B\uFEFF' },
      { start: 2, end: 3, text: "don't\tstop" },
      { start: 3, end: 4, text: '  me.  ' },
    ];

    expect(mergeCuesToSentences(cues)).toEqual([
      {
        id: 0,
        start: 0,
        end: 4,
        text: "Hello there, don't stop me.",
        cueStart: 0,
        cueEnd: 4,
      },
    ]);
  });

  it('splits on ! ? … and keeps closing quotes with the sentence', () => {
    const cues: Cue[] = [
      { start: 0, end: 4, text: 'Are you serious?! "Yes, I am." Wait…' },
    ];

    expect(mergeCuesToSentences(cues).map(({ text }) => text)).toEqual([
      'Are you serious?!',
      '"Yes, I am."',
      'Wait…',
    ]);
  });

  it('merges a continuation cue into the first fragment of a split cue', () => {
    const cues: Cue[] = [
      { start: 0, end: 2, text: 'I was' },
      { start: 2, end: 4, text: 'walking. Then I stopped.' },
    ];

    const sentences = mergeCuesToSentences(cues);

    expect(sentences.map(({ id, text, cueStart, cueEnd }) => ({ id, text, cueStart, cueEnd }))).toEqual([
      { id: 0, text: 'I was walking.', cueStart: 0, cueEnd: 1 },
      { id: 1, text: 'Then I stopped.', cueStart: 1, cueEnd: 1 },
    ]);
    // "walking." is 8 of the cue's 23 characters.
    expect(sentences[0]!.start).toBe(0);
    expect(sentences[0]!.end).toBeCloseTo(2 + (2 * 8) / 23, 5);
    expect(sentences[1]!.start).toBeCloseTo(sentences[0]!.end, 10);
    expect(sentences[1]!.end).toBe(4);
  });

  it('folds the unterminated tail of a split cue into the next cue', () => {
    const cues: Cue[] = [
      { start: 0, end: 2, text: 'First. Second' },
      { start: 2, end: 3, text: 'part.' },
    ];

    const sentences = mergeCuesToSentences(cues);

    expect(sentences.map(({ text, cueStart, cueEnd }) => ({ text, cueStart, cueEnd }))).toEqual([
      { text: 'First.', cueStart: 0, cueEnd: 0 },
      { text: 'Second part.', cueStart: 0, cueEnd: 1 },
    ]);
    expect(sentences[0]!.end).toBeCloseTo(1, 10);
    expect(sentences[1]!.start).toBeCloseTo(1, 10);
    expect(sentences[1]!.end).toBe(3);
  });

  it('does not split on a word-initial followed by a surname', () => {
    const cues: Cue[] = [{ start: 0, end: 3, text: 'J. Smith wrote the note.' }];

    expect(mergeCuesToSentences(cues).map(({ text }) => text)).toEqual(['J. Smith wrote the note.']);
  });

  it('returns no sentences for empty or content-free input', () => {
    expect(mergeCuesToSentences([])).toEqual([]);
    expect(
      mergeCuesToSentences([
        { start: 0, end: 1, text: '   ' },
        { start: 1, end: 2, text: '\u200B\uFEFF' },
        { start: 2, end: 3, text: '...' },
      ]),
    ).toEqual([]);
  });

  it('merges a realistic YouTube cue cadence fixture', () => {
    expect(mergeCuesToSentences(REALISTIC_CUES)).toEqual(REALISTIC_SENTENCES);
  });

  it('keeps sentence ids ascending and cue ranges monotonic on the fixture', () => {
    const sentences = mergeCuesToSentences(REALISTIC_CUES);

    expect(sentences.map(({ id }) => id)).toEqual(sentences.map((_, index) => index));
    for (let index = 0; index < sentences.length; index += 1) {
      const sentence = sentences[index]!;
      expect(sentence.text).toBe(sentence.text.trim());
      expect(sentence.text).not.toMatch(/\s{2,}/);
      expect(sentence.start).toBeLessThanOrEqual(sentence.end);
      if (index > 0) {
        expect(sentence.start).toBeGreaterThanOrEqual(sentences[index - 1]!.start);
        expect(sentence.cueStart).toBeGreaterThanOrEqual(sentences[index - 1]!.cueEnd);
      }
    }
  });
});

describe('mergeCuesToSentences (ASR)', () => {
  it('exports the spec defaults for ASR sentence boundaries', () => {
    expect(ASR_PAUSE_SECONDS).toBe(0.8);
    expect(ASR_MAX_WORDS).toBe(20);
  });

  it('does not pause-split manual cues (the default merge is unchanged)', () => {
    const cues: Cue[] = [
      { start: 0, end: 1.5, text: 'Hello there' },
      { start: 3, end: 4.5, text: 'how are you today' },
    ];

    expect(mergeCuesToSentences(cues)).toEqual([
      {
        id: 0,
        start: 0,
        end: 4.5,
        text: 'Hello there how are you today',
        cueStart: 0,
        cueEnd: 1,
      },
    ]);
  });

  it('splits ASR cues when the pause between them reaches 0.8s', () => {
    const cues: Cue[] = [
      { start: 0, end: 2, text: 'Hello there' },
      { start: 3, end: 5, text: 'how are you today' },
      { start: 6, end: 8, text: 'I am fine' },
    ];

    expect(mergeCuesToSentences(cues, { asr: true })).toEqual([
      { id: 0, start: 0, end: 2, text: 'Hello there', cueStart: 0, cueEnd: 0 },
      { id: 1, start: 3, end: 5, text: 'how are you today', cueStart: 1, cueEnd: 1 },
      { id: 2, start: 6, end: 8, text: 'I am fine', cueStart: 2, cueEnd: 2 },
    ]);
  });

  it('keeps ASR cues together below the pause threshold', () => {
    const cues: Cue[] = [
      { start: 0, end: 2, text: 'Hello there' },
      { start: 2.5, end: 4, text: 'how are you today' },
    ];

    expect(mergeCuesToSentences(cues, { asr: true })).toEqual([
      {
        id: 0,
        start: 0,
        end: 4,
        text: 'Hello there how are you today',
        cueStart: 0,
        cueEnd: 1,
      },
    ]);
  });

  it('still closes on punctuation before applying the ASR pause rule', () => {
    const cues: Cue[] = [
      { start: 0, end: 2, text: 'Hello there.' },
      { start: 2.1, end: 3.1, text: 'how are you' },
      { start: 3.2, end: 4.2, text: 'today.' },
      { start: 5.5, end: 6.5, text: 'I am fine' },
    ];

    expect(mergeCuesToSentences(cues, { asr: true })).toEqual([
      { id: 0, start: 0, end: 2, text: 'Hello there.', cueStart: 0, cueEnd: 0 },
      { id: 1, start: 2.1, end: 4.2, text: 'how are you today.', cueStart: 1, cueEnd: 2 },
      { id: 2, start: 5.5, end: 6.5, text: 'I am fine', cueStart: 3, cueEnd: 3 },
    ]);
  });

  it('caps an ASR sentence at 20 words, splitting on a cue boundary', () => {
    const cues: Cue[] = [
      { start: 0, end: 1, text: 'one two three four five six seven' },
      { start: 1, end: 2, text: 'eight nine ten eleven twelve thirteen fourteen' },
      { start: 2, end: 3, text: 'fifteen sixteen seventeen eighteen nineteen twenty twentyone' },
    ];

    expect(mergeCuesToSentences(cues, { asr: true })).toEqual([
      {
        id: 0,
        start: 0,
        end: 2,
        text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen',
        cueStart: 0,
        cueEnd: 1,
      },
      {
        id: 1,
        start: 2,
        end: 3,
        text: 'fifteen sixteen seventeen eighteen nineteen twenty twentyone',
        cueStart: 2,
        cueEnd: 2,
      },
    ]);
  });

  it('honours custom ASR pause and word thresholds', () => {
    const cues: Cue[] = [
      { start: 0, end: 1, text: 'one two three four' },
      { start: 1.5, end: 2.5, text: 'five six' },
    ];

    // maxWords is a hard cap: the 4-word cue is cut to two 2-word fragments
    // instead of standing alone, then the 0.4s gap splits the next cue.
    const capped = mergeCuesToSentences(cues, {
      asr: true,
      pauseSeconds: 0.4,
      maxWords: 2,
    });
    expect(capped.map(({ text }) => text)).toEqual(['one two', 'three four', 'five six']);
    expect(capped[2]!.start).toBe(1.5);
    expect(
      mergeCuesToSentences(cues, { asr: true, pauseSeconds: 0.6, maxWords: 99 }),
    ).toEqual([
      {
        id: 0,
        start: 0,
        end: 2.5,
        text: 'one two three four five six',
        cueStart: 0,
        cueEnd: 1,
      },
    ]);
  });

  it('splits a single ASR fragment longer than the hard word cap', () => {
    const words = Array.from({ length: 25 }, (_, index) => `word${index + 1}`);
    const cues: Cue[] = [{ start: 10, end: 20, text: words.join(' ') }];

    const sentences = mergeCuesToSentences(cues, { asr: true });

    expect(sentences).toHaveLength(2);
    expect(sentences[0]!.text.split(' ')).toHaveLength(20);
    expect(sentences[1]!.text.split(' ')).toHaveLength(5);
    // No word is lost or reordered by the split.
    expect(sentences.map(({ text }) => text).join(' ')).toBe(cues[0]!.text);
    expect(sentences.map(({ cueStart, cueEnd }) => ({ cueStart, cueEnd }))).toEqual([
      { cueStart: 0, cueEnd: 0 },
      { cueStart: 0, cueEnd: 0 },
    ]);
    // Contiguous, character-proportional time share across the cue.
    expect(sentences[0]!.start).toBe(10);
    expect(sentences[0]!.end).toBeCloseTo(sentences[1]!.start, 10);
    expect(sentences[1]!.end).toBe(20);
    const firstShare = sentences[0]!.end - sentences[0]!.start;
    const secondShare = sentences[1]!.end - sentences[1]!.start;
    expect(firstShare).toBeGreaterThan(secondShare);
  });

  it('keeps terminal punctuation on the last chunk of a split ASR fragment', () => {
    const words = Array.from({ length: 25 }, (_, index) => `word${index + 1}`);
    words[24] = 'last.';
    const cues: Cue[] = [{ start: 0, end: 25, text: words.join(' ') }];

    const sentences = mergeCuesToSentences(cues, { asr: true });

    expect(sentences).toHaveLength(2);
    expect(sentences[0]!.text.endsWith('.')).toBe(false);
    expect(sentences[1]!.text.endsWith('.')).toBe(true);
    expect(sentences[0]!.text.split(' ')).toHaveLength(20);
    expect(sentences[1]!.text.split(' ')).toHaveLength(5);
  });

  it('does not word-cap a long manual cue', () => {
    const words = Array.from({ length: 25 }, (_, index) => `word${index + 1}`);
    const cues: Cue[] = [{ start: 0, end: 10, text: words.join(' ') }];

    expect(mergeCuesToSentences(cues)).toEqual([
      {
        id: 0,
        start: 0,
        end: 10,
        text: words.join(' '),
        cueStart: 0,
        cueEnd: 0,
      },
    ]);
  });
});
