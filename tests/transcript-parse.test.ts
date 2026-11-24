import { describe, expect, it } from 'vitest';
import { parseJson3 } from '@/lib/transcript/parse';
import {
  duplicateLinesJson3,
  emptyJson3,
  manualEnglishJson3,
  messySegmentsJson3,
  overlappingJson3,
  sameStartJson3,
  zeroDurationJson3,
} from '@/lib/transcript/__fixtures__/json3';

describe('parseJson3', () => {
  it('normalizes a manual English response into second-based Cue[]', () => {
    expect(parseJson3(manualEnglishJson3)).toEqual([
      { start: 0, end: 2, text: 'Hello world.' },
      { start: 2, end: 4.5, text: 'This is a test.' },
      { start: 4.5, end: 5.5, text: 'No final punctuation' },
    ]);
  });

  it('returns [] for missing events or non-object input', () => {
    expect(parseJson3(null)).toEqual([]);
    expect(parseJson3(undefined)).toEqual([]);
    expect(parseJson3({})).toEqual([]);
    expect(parseJson3({ events: 'nope' })).toEqual([]);
    expect(parseJson3([])).toEqual([]);
  });

  it('skips events without usable text (empty segs, blanks, speaker markers)', () => {
    expect(parseJson3(emptyJson3)).toEqual([]);
  });

  it('merges consecutive duplicate lines but keeps a later repeat', () => {
    expect(parseJson3(duplicateLinesJson3)).toEqual([
      { start: 0, end: 2, text: 'Hello' },
      { start: 2, end: 3, text: 'Bye' },
      { start: 5, end: 6, text: 'Bye' },
    ]);
  });

  it('sorts out-of-order events and clamps overlapping ends', () => {
    expect(parseJson3(overlappingJson3)).toEqual([
      { start: 0, end: 1, text: 'First' },
      { start: 1, end: 4, text: 'Second' },
    ]);
  });

  it('merges cues that share a start instead of leaving a zero window', () => {
    expect(parseJson3(sameStartJson3)).toEqual([{ start: 0.5, end: 3, text: 'A B' }]);
  });

  it('fills missing and zero durations from the next cue or a 1s floor', () => {
    expect(parseJson3(zeroDurationJson3)).toEqual([
      { start: 0, end: 2, text: 'Missing duration' },
      { start: 2, end: 3, text: 'Zero duration' },
      { start: 3, end: 4, text: 'Final timed' },
      { start: 4, end: 5, text: 'Final zero' },
    ]);
  });

  it('collapses whitespace/newlines and strips >2-char speaker markers', () => {
    expect(parseJson3(messySegmentsJson3)).toEqual([
      { start: 0, end: 2, text: 'Hello world Topic' },
    ]);
  });

  it('does not expose tOffsetMs in the shared Cue contract', () => {
    const cues = parseJson3(messySegmentsJson3);
    expect(cues[0]).not.toHaveProperty('lastOff');
    expect(cues[0]).not.toHaveProperty('dur');
    expect(Object.keys(cues[0] ?? {}).sort()).toEqual(['end', 'start', 'text']);
  });
});
