import { describe, expect, it } from 'vitest';
import {
  baseLang,
  buildUrl,
  classifyCapturedTrack,
  classifyHttpStatus,
  hasTlang,
  isManualEnglishTrack,
  isTimedtextUrl,
  normKey,
  selectEnglishTrack,
  stripTlang,
  trackKindOf,
  trackLangOf,
  videoIdFromHref,
  vidOfUrl,
} from '@/lib/transcript/url';

const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const CAPTURED =
  'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en&kind=&pot=abc123&signature=xyz789&fmt=srv3&tlang=es';

describe('videoIdFromHref', () => {
  it('reads the watch ?v= id', () => {
    expect(videoIdFromHref(WATCH)).toBe('dQw4w9WgXcQ');
    expect(videoIdFromHref('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toBe(
      'dQw4w9WgXcQ',
    );
  });

  it('reads the id from shorts / embed / live paths', () => {
    expect(videoIdFromHref('https://www.youtube.com/shorts/abc_123-XYZ')).toBe('abc_123-XYZ');
    expect(videoIdFromHref('https://www.youtube.com/embed/abc_123-XYZ')).toBe('abc_123-XYZ');
    expect(videoIdFromHref('https://www.youtube.com/live/abc_123-XYZ')).toBe('abc_123-XYZ');
  });

  it('rejects playlist embeddings and non-video pages', () => {
    expect(videoIdFromHref('https://www.youtube.com/embed/videoseries?list=PL1')).toBe('');
    expect(videoIdFromHref('https://www.youtube.com/embed/live_stream?channel=UC1')).toBe('');
    expect(videoIdFromHref('https://www.youtube.com/')).toBe('');
    expect(videoIdFromHref('https://www.youtube.com/results?search_query=cat')).toBe('');
    expect(videoIdFromHref('not a url')).toBe('');
  });
});

describe('timedtext URL helpers', () => {
  it('recognizes player timedtext URLs and ignores other resources', () => {
    expect(isTimedtextUrl(CAPTURED)).toBe(true);
    expect(isTimedtextUrl('https://www.youtube.com/api/timedtext?v=x')).toBe(true);
    expect(isTimedtextUrl('https://www.youtube.com/api/timedtextfoo')).toBe(false);
    expect(isTimedtextUrl('https://www.youtube.com/watch?v=x')).toBe(false);
    expect(isTimedtextUrl(undefined)).toBe(false);
  });

  it('detects and strips tlang without touching pot/signature', () => {
    expect(hasTlang(CAPTURED)).toBe(true);
    const stripped = new URL(stripTlang(CAPTURED));
    expect(stripped.searchParams.get('tlang')).toBeNull();
    expect(stripped.searchParams.get('pot')).toBe('abc123');
    expect(stripped.searchParams.get('signature')).toBe('xyz789');
    expect(stripped.searchParams.get('v')).toBe('dQw4w9WgXcQ');
  });

  it('builds a json3 URL that keeps pot and signature and drops tlang', () => {
    const built = new URL(buildUrl(CAPTURED));
    expect(built.searchParams.get('fmt')).toBe('json3');
    expect(built.searchParams.get('tlang')).toBeNull();
    expect(built.searchParams.get('pot')).toBe('abc123');
    expect(built.searchParams.get('signature')).toBe('xyz789');
    expect(built.searchParams.get('lang')).toBe('en');
    expect(built.searchParams.get('v')).toBe('dQw4w9WgXcQ');
  });

  it('can re-add an explicit tlang target', () => {
    const built = new URL(buildUrl(CAPTURED, 'zh-Hans'));
    expect(built.searchParams.get('fmt')).toBe('json3');
    expect(built.searchParams.get('tlang')).toBe('zh-Hans');
    expect(built.searchParams.get('pot')).toBe('abc123');
  });

  it('tracks identity by stripping pot/fmt/tlang only', () => {
    const rotated =
      'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en&kind=&pot=rotated&signature=xyz789&fmt=json3';
    expect(normKey(rotated)).toBe(normKey(CAPTURED));

    const otherLang = CAPTURED.replace('lang=en', 'lang=fr');
    expect(normKey(otherLang)).not.toBe(normKey(CAPTURED));
    const asr = CAPTURED.replace('kind=', 'kind=asr');
    expect(normKey(asr)).not.toBe(normKey(CAPTURED));
  });

  it('reads track kind and language', () => {
    expect(trackKindOf(CAPTURED)).toBe('manual');
    expect(trackKindOf(CAPTURED.replace('kind=', 'kind=asr'))).toBe('asr');
    expect(trackLangOf(CAPTURED)).toBe('en');
    expect(trackLangOf(CAPTURED.replace('lang=en', 'lang=en-US'))).toBe('en-US');
    expect(trackLangOf('https://www.youtube.com/api/timedtext?v=x')).toBe('');
  });

  it('falls back to the page id when the captured URL has no v param', () => {
    expect(vidOfUrl('https://www.youtube.com/api/timedtext?lang=en', WATCH)).toBe('dQw4w9WgXcQ');
    expect(vidOfUrl(CAPTURED, WATCH)).toBe('dQw4w9WgXcQ');
  });

  it('normalizes a language code to its base', () => {
    expect(baseLang('en-US')).toBe('en');
    expect(baseLang('EN-gb')).toBe('en');
    expect(baseLang(undefined)).toBe('');
    expect(baseLang('')).toBe('');
  });
});

describe('manual English track selection', () => {
  const manualEn = { languageCode: 'en', kind: '' };
  const manualEnGb = { languageCode: 'en-GB' };
  const asrEn = { languageCode: 'en', kind: 'asr' };
  const manualEs = { languageCode: 'es' };

  it('accepts en and en-* tracks only when they are not ASR', () => {
    expect(isManualEnglishTrack(manualEn)).toBe(true);
    expect(isManualEnglishTrack(manualEnGb)).toBe(true);
    expect(isManualEnglishTrack(asrEn)).toBe(false);
    expect(isManualEnglishTrack(manualEs)).toBe(false);
  });

  it('prefers the first manual English track over an ASR track', () => {
    expect(selectEnglishTrack([asrEn, manualEnGb, manualEn])).toEqual({
      kind: 'manual-en',
      track: manualEnGb,
    });
  });

  it('reports asr-only when English exists only as auto-generated', () => {
    expect(selectEnglishTrack([asrEn, manualEs])).toEqual({ kind: 'asr-only' });
  });

  it('reports no-captions for absent, empty and non-English track lists', () => {
    expect(selectEnglishTrack(null)).toEqual({ kind: 'no-captions' });
    expect(selectEnglishTrack(undefined)).toEqual({ kind: 'no-captions' });
    expect(selectEnglishTrack([])).toEqual({ kind: 'no-captions' });
    expect(selectEnglishTrack([manualEs])).toEqual({ kind: 'no-captions' });
  });

  it('classifies a captured URL into manual-en / asr / other', () => {
    expect(classifyCapturedTrack(CAPTURED)).toBe('manual-en');
    expect(classifyCapturedTrack(CAPTURED.replace('kind=', 'kind=asr'))).toBe('asr');
    expect(classifyCapturedTrack(CAPTURED.replace('lang=en', 'lang=fr'))).toBe('other');
  });
});

describe('HTTP failure classification', () => {
  it('treats network/5xx as retryable, 429 as rate limited, other 4xx as fatal', () => {
    expect(classifyHttpStatus(undefined)).toBe('retryable');
    expect(classifyHttpStatus(500)).toBe('retryable');
    expect(classifyHttpStatus(503)).toBe('retryable');
    expect(classifyHttpStatus(429)).toBe('rate-limited');
    expect(classifyHttpStatus(404)).toBe('fatal');
    expect(classifyHttpStatus(403)).toBe('fatal');
  });
});
