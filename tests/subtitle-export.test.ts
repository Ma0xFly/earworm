import { describe, expect, it } from 'vitest';
import type { LearningSentence } from '@/lib/contracts';
import {
  formatSrt,
  formatTimestamp,
  formatTxt,
  sanitizeFileName,
} from '@/lib/export/subtitles';

function sentence(overrides: Partial<LearningSentence> = {}): LearningSentence {
  return {
    id: 0,
    start: 0,
    end: 2,
    text: 'Hello world.',
    cueStart: 0,
    cueEnd: 0,
    cols: [],
    status: 'done',
    ...overrides,
  };
}

describe('formatTimestamp', () => {
  it('renders SRT HH:MM:SS,mmm with rounded milliseconds and rollover', () => {
    expect(formatTimestamp(0)).toBe('00:00:00,000');
    expect(formatTimestamp(1.5)).toBe('00:00:01,500');
    // Rounding must roll into the next second/minute, not emit "59,1000".
    expect(formatTimestamp(59.9996)).toBe('00:01:00,000');
    expect(formatTimestamp(3661.234)).toBe('01:01:01,234');
  });
});

describe('formatSrt', () => {
  it('emits numbered cues with an EN line then a ZH line, separated by blank lines', () => {
    const output = formatSrt([
      sentence({ start: 0, end: 1.5, text: 'Hello world.', zh: '你好，世界。' }),
      sentence({ id: 1, start: 2, end: 3.25, text: 'Second line.', zh: '第二句。' }),
    ]);
    expect(output).toBe(
      [
        '1',
        '00:00:00,000 --> 00:00:01,500',
        'Hello world.',
        '你好，世界。',
        '',
        '2',
        '00:00:02,000 --> 00:00:03,250',
        'Second line.',
        '第二句。',
        '',
      ].join('\n'),
    );
  });

  it('keeps untranslated cues with an empty ZH line, collapses newlines and enforces a nonzero duration', () => {
    const output = formatSrt([
      sentence({ start: 3, end: 3, text: 'No translation yet.', status: 'pending' }),
      sentence({
        id: 1,
        start: 5,
        end: 4,
        text: 'Line one\nline two.',
        zh: '第一行\n第二行。',
      }),
    ]);
    expect(output).toBe(
      [
        '1',
        '00:00:03,000 --> 00:00:03,001',
        'No translation yet.',
        '',
        '',
        '2',
        '00:00:05,000 --> 00:00:05,001',
        'Line one line two.',
        '第一行 第二行。',
        '',
      ].join('\n'),
    );
  });
});

describe('formatTxt', () => {
  it('writes readable EN/ZH pairs without timestamps, separated by blank lines', () => {
    const output = formatTxt([
      sentence({ text: 'Hello world.', zh: '你好，世界。' }),
      sentence({ id: 1, text: 'Second line.', zh: '第二句。' }),
    ]);
    expect(output).toBe('Hello world.\n你好，世界。\n\nSecond line.\n第二句。\n');
    expect(output).not.toContain('-->');
  });

  it('keeps an empty ZH line for untranslated sentences and collapses newlines', () => {
    expect(formatTxt([sentence({ text: 'No translation yet.', status: 'pending' })]))
      .toBe('No translation yet.\n\n');
    expect(formatTxt([sentence({ text: 'A\nB.', zh: '甲\n乙。' })]))
      .toBe('A B.\n甲 乙。\n');
  });
});

describe('sanitizeFileName', () => {
  it('keeps readable titles, including Unicode, unchanged', () => {
    expect(sanitizeFileName('  My Video - YouTube  ')).toBe('My Video - YouTube');
    expect(sanitizeFileName('英语听力 1080p')).toBe('英语听力 1080p');
  });

  it('replaces illegal/control characters and strips trailing dots', () => {
    expect(sanitizeFileName('A/B:C*D?E"F<G>H|I')).toBe('A B C D E F G H I');
    expect(sanitizeFileName('bad\u0000name...')).toBe('bad name');
  });

  it('uses the video id then a fixed fallback, and avoids Windows reserved names', () => {
    expect(sanitizeFileName('', 'abc123')).toBe('abc123');
    expect(sanitizeFileName('   ', '')).toBe('earworm-subtitles');
    expect(sanitizeFileName('CON')).toBe('_CON');
    expect(sanitizeFileName('lpt1')).toBe('_lpt1');
    expect(sanitizeFileName('COM0')).toBe('COM0');
  });

  it('bounds long titles by Unicode code point without splitting surrogate pairs', () => {
    expect(sanitizeFileName('a'.repeat(120))).toHaveLength(100);
    const emoji = sanitizeFileName('😀'.repeat(80));
    expect([...emoji]).toHaveLength(80);
    expect(emoji.startsWith('😀')).toBe(true);
  });
});
