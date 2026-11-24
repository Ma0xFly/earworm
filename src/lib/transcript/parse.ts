/**
 * Adapted for Earworm (MIT) from Gythiro/yt-dual-subs v3.7.0
 * (inject.js `parseJson3`, content.js `computeCueEnds`).
 * Copyright (c) 2026 Gythiro — MIT License (see NOTICE).
 * Upstream: https://github.com/Gythiro/yt-dual-subs
 * Adapted: 2026-11-24.
 *
 * Normalize a `fmt=json3` timedtext response into the shared `Cue[]` shape
 * (seconds, `end` exclusive). This is deliberately stricter than upstream:
 * Earworm has no translation leg to pair by event index, so events may be
 * sorted, duplicate lines merged and overlaps resolved.
 */

import type { Cue } from '@/lib/contracts';

/** Duration used for a trailing cue whose json3 duration is zero/missing. */
export const ZERO_DURATION_FLOOR_MS = 1000;

type RawCue = { start: number; end: number; text: string; order: number };

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function normalizeText(raw: string): string {
  return (
    raw
      // YouTube's own `utf8` strings carry their spacing; collapse whatever is
      // left (newlines inside a segment are line breaks, not pauses).
      .replace(/\s+/g, ' ')
      // Speaker-change markers (`>>`, `>>>`) mean nothing to a learner and
      // must not reach the overlay or the sentence merger.
      .replace(/(^|\s)>{2,}\s*/g, '$1')
      .trim()
  );
}

function cueText(event: Record<string, unknown>): string {
  const segs = event.segs;
  if (!Array.isArray(segs)) return '';
  let text = '';
  for (const seg of segs) {
    const record = asRecord(seg);
    if (record && typeof record.utf8 === 'string') text += record.utf8;
  }
  return normalizeText(text);
}

/**
 * Parse a json3 payload into normalized cues:
 * - events without `segs` (style/window events) and events whose text is empty
 *   after whitespace collapse / speaker-marker strip are dropped;
 * - `tStartMs`/`dDurationMs` are converted to seconds;
 * - events are sorted by start (stable within equal starts);
 * - cues sharing a start and consecutive cues with identical text are merged;
 * - a missing/zero duration is filled from the next cue, or a 1s floor for the
 *   final cue; overlaps are clamped to the next cue's start so the shared
 *   `Cue` stream is non-overlapping.
 */
export function parseJson3(json: unknown): Cue[] {
  const root = asRecord(json);
  if (!root || !Array.isArray(root.events)) return [];

  const raw: RawCue[] = [];
  let order = 0;
  for (const event of root.events) {
    const record = asRecord(event);
    if (!record) continue;
    const text = cueText(record);
    if (!text) continue;
    const startMs = asFiniteNumber(record.tStartMs) ?? 0;
    const durationMs = Math.max(0, asFiniteNumber(record.dDurationMs) ?? 0);
    raw.push({
      start: startMs / 1000,
      end: (startMs + durationMs) / 1000,
      text,
      order: order++,
    });
  }

  if (raw.length === 0) return [];

  raw.sort((a, b) => a.start - b.start || a.order - b.order);

  const merged: RawCue[] = [];
  for (const cue of raw) {
    const previous = merged[merged.length - 1];
    if (previous && previous.start === cue.start) {
      // Two events starting together (rolling windows, duplicated windows):
      // one cue carrying both texts, spanning the union of their windows.
      if (!previous.text.includes(cue.text)) {
        previous.text = `${previous.text} ${cue.text}`.trim();
      }
      previous.end = Math.max(previous.end, cue.end);
      continue;
    }
    if (previous && previous.text === cue.text && cue.start <= previous.end) {
      // Adjacent duplicate line ("scrolling caption" repeats). A later repeat
      // after a real gap is a new utterance and stays.
      previous.end = Math.max(previous.end, cue.end);
      continue;
    }
    merged.push({ ...cue });
  }

  for (let i = 0; i < merged.length; i += 1) {
    const cue = merged[i];
    if (!cue) continue;
    const next = merged[i + 1];
    if (!(cue.end > cue.start)) {
      cue.end = next ? next.start : cue.start + ZERO_DURATION_FLOOR_MS / 1000;
    }
    if (next && cue.end > next.start) cue.end = next.start;
    // After same-start merging `next.start` is strictly greater than
    // `cue.start`, so the clamp above can never produce a zero window.
    if (!(cue.end > cue.start)) cue.end = cue.start + ZERO_DURATION_FLOOR_MS / 1000;
  }

  return merged.map(({ start, end, text }) => ({ start, end, text }));
}
