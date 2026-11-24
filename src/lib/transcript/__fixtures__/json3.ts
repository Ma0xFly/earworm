/**
 * A realistic `fmt=json3` response for a human English track. Manual tracks
 * usually carry no `tOffsetMs` and their events are already sentence-sized.
 * The blank window event and the zero duration exercise the normalization.
 */
export const manualEnglishJson3 = {
  wireMagic: 'pb3',
  events: [
    {
      tStartMs: 0,
      dDurationMs: 2000,
      wWinId: 1,
      segs: [{ utf8: 'Hello ' }, { utf8: 'world.' }],
    },
    {
      tStartMs: 2000,
      dDurationMs: 2500,
      segs: [{ utf8: 'This is ' }, { utf8: 'a test.' }],
    },
    {
      // Styling/window event with no text: skipped.
      tStartMs: 4500,
      dDurationMs: 0,
      wWinId: 1,
      segs: [{ utf8: '\n' }],
    },
    {
      tStartMs: 4500,
      dDurationMs: 0,
      segs: [{ utf8: 'No final punctuation' }],
    },
  ],
  pens: [],
  wsWinStyles: [],
};

/** Cues identical in time and text except the start (same-start overlap). */
export const sameStartJson3 = {
  events: [
    { tStartMs: 500, dDurationMs: 1000, segs: [{ utf8: 'A' }] },
    { tStartMs: 500, dDurationMs: 2500, segs: [{ utf8: 'B' }] },
  ],
};

/** ASR-style rolling captions: exact duplicate lines and an overlap. */
export const duplicateLinesJson3 = {
  events: [
    { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Hello' }] },
    { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'Hello' }] },
    { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'Bye' }] },
    { tStartMs: 5000, dDurationMs: 1000, segs: [{ utf8: 'Bye' }] },
  ],
};

/** Out-of-order events with overlapping durations. */
export const overlappingJson3 = {
  events: [
    { tStartMs: 1000, dDurationMs: 3000, segs: [{ utf8: 'Second' }] },
    { tStartMs: 0, dDurationMs: 2500, segs: [{ utf8: 'First' }] },
  ],
};

/** Missing/zero durations and a final cue with no duration at all. */
export const zeroDurationJson3 = {
  events: [
    { tStartMs: 0, segs: [{ utf8: 'Missing duration' }] },
    { tStartMs: 2000, dDurationMs: 0, segs: [{ utf8: 'Zero duration' }] },
    { tStartMs: 3000, dDurationMs: 1000, segs: [{ utf8: 'Final timed' }] },
    { tStartMs: 4000, dDurationMs: 0, segs: [{ utf8: 'Final zero' }] },
  ],
};

/** Speaker markers, newlines and whitespace inside segments. */
export const messySegmentsJson3 = {
  events: [
    {
      tStartMs: 0,
      dDurationMs: 2000,
      segs: [
        { utf8: '>> ', tOffsetMs: 0 },
        { utf8: 'Hello\n', tOffsetMs: 100 },
        { utf8: '  world  ', tOffsetMs: 900 },
        { utf8: ' >>> Topic', tOffsetMs: 1500 },
      ],
    },
  ],
};

export const emptyJson3 = {
  events: [
    {},
    { tStartMs: 0, dDurationMs: 1000 },
    { tStartMs: 0, dDurationMs: 1000, segs: [] },
    { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '   ' }] },
    { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: '>>>' }, { utf8: '  ' }] },
    { tStartMs: 2000, dDurationMs: 1000, segs: [{ notUtf8: 'x' }] },
  ],
};
