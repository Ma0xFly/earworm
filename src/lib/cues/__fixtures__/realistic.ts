import type { Cue, Sentence } from '@/lib/contracts';

/**
 * A realistic slice of a YouTube tutorial's manual English track: ~1.3–2.3 s
 * cues, continuation cues that carry no punctuation, mid-cue dotted
 * abbreviations and a decimal number, ending on an unterminated cue.
 */
export const REALISTIC_CUES: Cue[] = [
  { start: 0.32, end: 2.08, text: 'Hey everyone, welcome back to the channel.' },
  { start: 2.08, end: 3.6, text: "Today I'm going to show you" },
  { start: 3.6, end: 5.92, text: 'how to set up a local LLM gateway.' },
  { start: 5.92, end: 7.4, text: "It's easier than you think." },
  { start: 7.4, end: 8.12, text: 'First, install the CLI.' },
  { start: 8.12, end: 9.8, text: 'Then run the setup command, e.g. magpie setup.' },
  { start: 9.8, end: 11.4, text: 'It only takes about 2.5 minutes.' },
  { start: 11.4, end: 12.9, text: "Let's get started" },
];

export const REALISTIC_SENTENCES: Sentence[] = [
  {
    id: 0,
    start: 0.32,
    end: 2.08,
    text: 'Hey everyone, welcome back to the channel.',
    cueStart: 0,
    cueEnd: 0,
  },
  {
    id: 1,
    start: 2.08,
    end: 5.92,
    text: "Today I'm going to show you how to set up a local LLM gateway.",
    cueStart: 1,
    cueEnd: 2,
  },
  {
    id: 2,
    start: 5.92,
    end: 7.4,
    text: "It's easier than you think.",
    cueStart: 3,
    cueEnd: 3,
  },
  {
    id: 3,
    start: 7.4,
    end: 8.12,
    text: 'First, install the CLI.',
    cueStart: 4,
    cueEnd: 4,
  },
  {
    id: 4,
    start: 8.12,
    end: 9.8,
    text: 'Then run the setup command, e.g. magpie setup.',
    cueStart: 5,
    cueEnd: 5,
  },
  {
    id: 5,
    start: 9.8,
    end: 11.4,
    text: 'It only takes about 2.5 minutes.',
    cueStart: 6,
    cueEnd: 6,
  },
  {
    id: 6,
    start: 11.4,
    end: 12.9,
    text: "Let's get started",
    cueStart: 7,
    cueEnd: 7,
  },
];
