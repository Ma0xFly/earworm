/**
 * Adapted for Earworm (MIT) from Gythiro/yt-dual-subs (MIT) — Copyright (c) 2026 Gythiro.
 * Upstream: https://github.com/Gythiro/yt-dual-subs (v3.7.0: inject.js
 * `videoIdFromLocation`, `isTimedtext`, `hasTlang`, `normKey`, `trackKindOf`,
 * `trackLangOf`, `vidOfUrl`, `buildUrl`).
 * Adapted: 2026-11-24. Full upstream MIT permission text: see NOTICE.
 *
 * Pure URL / track-selection helpers for the player-runtime timedtext
 * acquisition. DOM-free so Vitest can exercise every rule directly.
 */

/** Path fragment that identifies YouTube's caption endpoint. */
export const TIMEDTEXT_MARK = '/api/timedtext';

const FALLBACK_BASE = 'https://www.youtube.com/';

/** The parts of a `captionTracks[]` entry Earworm cares about. */
export type CaptionTrack = {
  languageCode?: string;
  kind?: string;
  vssId?: string;
  [key: string]: unknown;
};

/** A small, defensive wrapper around the page URL used as a resolution base. */
function pageBase(pageHref?: string): string {
  if (pageHref) return pageHref;
  try {
    return location.href;
  } catch {
    return FALLBACK_BASE;
  }
}

function parse(url: string, pageHref?: string): URL | null {
  try {
    return new URL(url, pageBase(pageHref));
  } catch {
    return null;
  }
}

/**
 * The current video id, derived exactly like the isolated-world content
 * script (the two must agree or they disagree about what is playing).
 * `/shorts/<id>`, `/embed/<id>` and `/live/<id>` carry the id in the path;
 * `/embed/videoseries` and `/embed/live_stream` are excluded because both are
 * eleven legal id characters that are not an id. Everything else falls back to
 * `?v=`.
 */
export function videoIdFromHref(href: string): string {
  try {
    const u = new URL(href);
    const m = u.pathname.match(
      /^\/(?:shorts|embed|live)\/(?!videoseries\b|live_stream\b)([A-Za-z0-9_-]{6,})/,
    );
    if (m?.[1]) return m[1];
    return u.searchParams.get('v') || '';
  } catch {
    return '';
  }
}

export function videoIdFromLocation(): string {
  return videoIdFromHref(pageBase());
}

export function isShortsHref(href: string): boolean {
  try {
    return /^\/shorts\//.test(new URL(href).pathname);
  } catch {
    return false;
  }
}

export function isTimedtextUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url.includes(TIMEDTEXT_MARK)) return false;
  // A real endpoint uses exactly this path; reject lookalikes such as
  // `/api/timedtextfoo` that also contain the marker.
  return parse(url)?.pathname === TIMEDTEXT_MARK;
}

export function hasTlang(url: string, pageHref?: string): boolean {
  const u = parse(url, pageHref);
  if (u) return u.searchParams.has('tlang');
  return /[?&]tlang=/.test(url);
}

/**
 * Drop the auto-translate target and keep every other parameter. When the
 * player's selected track is one of YouTube's own auto-translate tracks, every
 * request it makes carries `tlang=`; the URL minus `tlang` is still the source
 * track, and its pot holds for the source leg.
 */
export function stripTlang(url: string, pageHref?: string): string {
  const u = parse(url, pageHref);
  if (!u) return url;
  u.searchParams.delete('tlang');
  return u.toString();
}

/**
 * Build the re-fetch URL from a captured player URL: preserve every parameter
 * (notably `pot` and `signature`), force `fmt=json3`, and always drop `tlang`.
 *
 * ADR-0002: translation tracks are out of scope for v1, so no caller may ask
 * YouTube to machine-translate the track; every fetched payload is the source
 * (manual English) track and the Chinese translation comes only from our LLM.
 */
export function buildUrl(baseUrl: string, pageHref?: string): string {
  const u = new URL(baseUrl, pageBase(pageHref));
  u.searchParams.delete('tlang');
  u.searchParams.set('fmt', 'json3');
  return u.toString();
}

/**
 * Stable track identity: strip the parameters that rotate or that WE vary.
 * `pot` is rotated by the player for the SAME track; leaving it in the key
 * would make every rotation look like a new source and re-produce cues (which
 * flickers the overlay and doubles traffic). `fmt`/`tlang` are ours. What
 * remains is video + language + manual/ASR + signature params.
 */
export function normKey(url: string, pageHref?: string): string {
  const u = parse(url, pageHref);
  if (!u) return url;
  u.searchParams.delete('fmt');
  u.searchParams.delete('tlang');
  u.searchParams.delete('pot');
  return u.toString();
}

/** `kind=asr` marks an auto-generated track; human tracks have no kind. */
export function trackKindOf(url: string, pageHref?: string): 'manual' | 'asr' {
  return parse(url, pageHref)?.searchParams.get('kind') === 'asr' ? 'asr' : 'manual';
}

/** The captured track's own language, e.g. `en`, `en-US`. */
export function trackLangOf(url: string, pageHref?: string): string {
  return parse(url, pageHref)?.searchParams.get('lang') || '';
}

/** `en-US` -> `en`, `EN` -> `en`. */
export function baseLang(code: string | null | undefined): string {
  return String(code || '')
    .toLowerCase()
    .split('-')[0] ?? '';
}

/** The `v` param of a captured URL, else the current page's video id. */
export function vidOfUrl(url: string, pageHref?: string): string {
  const u = parse(url, pageHref);
  return u?.searchParams.get('v') || videoIdFromHref(pageBase(pageHref));
}

/** Whether a `captionTracks[]` entry is a human English track. */
export function isManualEnglishTrack(track: CaptionTrack): boolean {
  return baseLang(track.languageCode) === 'en' && track.kind !== 'asr';
}

/** What the player's caption track list can offer Earworm v1. */
export type EnglishTrackSelection =
  | { kind: 'manual-en'; track: CaptionTrack }
  | { kind: 'asr-only' }
  | { kind: 'no-captions' };

/**
 * Select the track Earworm v1 may use: manual English only
 * (`languageCode` base `en`, `kind !== 'asr'`). If English exists only as ASR,
 * report `asr-only`; if there is no English track at all, `no-captions`.
 */
export function selectEnglishTrack(
  tracks: readonly CaptionTrack[] | null | undefined,
): EnglishTrackSelection {
  if (!Array.isArray(tracks) || tracks.length === 0) return { kind: 'no-captions' };
  let asrEnglish = false;
  for (const track of tracks) {
    if (!track || typeof track !== 'object') continue;
    if (baseLang(track.languageCode) !== 'en') continue;
    if (track.kind === 'asr') {
      asrEnglish = true;
      continue;
    }
    return { kind: 'manual-en', track };
  }
  return asrEnglish ? { kind: 'asr-only' } : { kind: 'no-captions' };
}

/** Classification of a sniffed timedtext URL. */
export type CapturedTrackClass = 'manual-en' | 'asr' | 'other';

export function classifyCapturedTrack(url: string, pageHref?: string): CapturedTrackClass {
  if (trackKindOf(url, pageHref) === 'asr') return 'asr';
  return baseLang(trackLangOf(url, pageHref)) === 'en' ? 'manual-en' : 'other';
}

/**
 * How an HTTP failure should be handled by the single-retry fetch:
 * - `retryable`: network error, empty body, bad JSON, 5xx — one retry.
 * - `rate-limited`: 429 — do not retry; remember the endpoint for 25s.
 * - `fatal`: other 4xx — an answer, not a hiccup.
 */
export type HttpFailureClass = 'retryable' | 'rate-limited' | 'fatal';

export function classifyHttpStatus(status: number | undefined): HttpFailureClass {
  if (status === undefined) return 'retryable';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'retryable';
  return 'fatal';
}
