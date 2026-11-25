/**
 * Pure subtitle export formatters (F7 / ticket #35).
 *
 * Inputs are `LearningSentence`s from the session, whose `start`/`end` are
 * floating-point seconds. Nothing here reads the translation cache or issues
 * LLM requests: callers pass already cache-derived session state.
 */
import type { LearningSentence } from '@/lib/contracts';

function formatMs(totalMs: number): string {
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(ms, 3)}`;
}

/** Seconds (float) -> SRT `HH:MM:SS,mmm`. Convert to integer ms first so a
 * rounded 59.9996s rolls into the next second instead of emitting `59,1000`. */
export function formatTimestamp(seconds: number): string {
  return formatMs(Math.max(0, Math.round(seconds * 1000)));
}

/** Cues are joined into sentences, but an LLM `zh` may still contain newlines;
 * one physical line per language keeps each SRT block at exactly two lines. */
function oneLine(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Bilingual SRT: one cue per 字幕句, EN first, ZH second (empty when 未译). */
export function formatSrt(sentences: readonly LearningSentence[]): string {
  const blocks = sentences.map((sentence, index) => {
    const startMs = Math.max(0, Math.round(sentence.start * 1000));
    // A zero or inverted span still needs a valid, nonzero SRT duration.
    const endMs = Math.max(startMs + 1, Math.round(sentence.end * 1000));
    return [
      String(index + 1),
      `${formatMs(startMs)} --> ${formatMs(endMs)}`,
      oneLine(sentence.text),
      oneLine(sentence.zh),
    ].join('\n');
  });
  return blocks.length ? `${blocks.join('\n\n')}\n` : '';
}

/** Bilingual plain text: EN then ZH per 字幕句, no timestamps. */
export function formatTxt(sentences: readonly LearningSentence[]): string {
  return sentences.map((s) => `${oneLine(s.text)}\n${oneLine(s.zh)}\n`).join('\n');
}

const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]+/g;
const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const MAX_FILENAME_LENGTH = 100;

/** Video title -> safe download basename (extension is added by the caller). */
export function sanitizeFileName(title: string, fallback = ''): string {
  const normalize = (value: string): string => {
    const cleaned = value
      .replace(ILLEGAL_FILENAME_CHARS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '');
    // Slice by code point so a long emoji title never gets a split surrogate.
    return [...cleaned].slice(0, MAX_FILENAME_LENGTH).join('').replace(/[. ]+$/g, '');
  };
  const name = normalize(title) || normalize(fallback) || 'earworm-subtitles';
  return WINDOWS_RESERVED.test(name) ? `_${name}` : name;
}
