/**
 * Adapted for Earworm (MIT) from Gythiro/yt-dual-subs (MIT) — Copyright (c) 2026 Gythiro.
 * Upstream: https://github.com/Gythiro/yt-dual-subs (v3.7.0, inject.js).
 * Adapted: 2026-11-24. Full upstream MIT permission text: see NOTICE.
 *
 * MAIN world, document_start. Hooks XMLHttpRequest + fetch (with a
 * PerformanceObserver fallback) to capture the YouTube player's OWN
 * `/api/timedtext` request URL, which carries a valid poToken. That exact URL
 * is re-fetched with `fmt=json3`, parsed into normalized `Cue[]`, and posted to
 * the isolated-world client over the validated window bridge.
 *
 * Earworm v1 accepts English tracks with human captions preferred and
 * YouTube's auto-generated (ASR) English track as the fallback. When no usable
 * capture shows up, the fallback chain reads the player response's
 * `captionTracks`, nudges the player onto the selected English track, and only
 * then reports a classified failure (`no-captions` / `nudge-failed` /
 * `timeout` / `http`).
 *
 * NEVER throw into the page and never block playback: every hook body and every
 * async continuation is wrapped, and the captured URL is only reused as-is
 * (pot + signature preserved).
 */

import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import type { Cue, CueTrackKind } from '@/lib/contracts';
import { PAGE_SELECTORS, PLAYER_DOM_ID } from '@/lib/ui/selectors';
import {
  parseContentEvent,
  postCuesFailed,
  postCuesReady,
} from '@/lib/transcript/bridge';
import { parseJson3 } from '@/lib/transcript/parse';
import type { TranscriptFailureReason } from '@/lib/transcript/client';
import {
  baseLang,
  buildUrl,
  captionTrackDescriptor,
  classifyCapturedTrack,
  classifyHttpStatus,
  hasTlang,
  isEnglishCapturedTrack,
  isShortsHref,
  isTimedtextUrl,
  normKey,
  selectEnglishTrack,
  stripTlang,
  trackKindOf,
  trackLangOf,
  videoIdFromHref,
  vidOfUrl,
  type CaptionTrack,
} from '@/lib/transcript/url';

/* -------------------------------------------------------------------------- */
/* constants                                                                   */
/* -------------------------------------------------------------------------- */

/** How long to wait for the player to fetch timedtext before falling back. */
export const NOCUES_TIMEOUT_MS = 8000;
/** How long the nudge (select the English track / click CC) may take to be sniffed. */
export const NUDGE_GRACE_MS = 3000;
/** Upper bound for one timedtext fetch; without it a hung fetch wedges state. */
export const FETCH_TIMEOUT_MS = 8000;
/** One retry for a transient hiccup (network, empty body, 5xx). */
export const HTTP_RETRY_DELAY_MS = 500;
/** A 429 is endpoint-level and sticky; do not hammer it for this long. */
export const RATE_LIMIT_MEMORY_MS = 25000;
/**
 * Best-effort screen-text fallback window after a nudge/timeout: how long we
 * keep reading the rendered caption DOM before conceding failure.
 */
export const SCREEN_TEXT_WINDOW_MS = 4000;
/** How often the fallback samples the caption DOM. */
export const SCREEN_TEXT_SAMPLE_MS = 250;
/** Minimum duration of one synthetic screen-text cue, in seconds. */
const SCREEN_TEXT_MIN_CUE_SECONDS = 0.5;
/** Tail duration when the captured line never changes, in seconds. */
const SCREEN_TEXT_TAIL_SECONDS = 2;
/**
 * How long our own json3 URL stays "ours". The PerformanceObserver reports a
 * resource only after its body finished (later than the fetch `finally`), so a
 * map cleared there would echo our own request back as a player capture.
 */
export const SELF_URL_LINGER_MS = 5000;

/* -------------------------------------------------------------------------- */
/* page/player types                                                           */
/* -------------------------------------------------------------------------- */

type CaptionTrackListRenderer = { captionTracks?: CaptionTrack[] };

type PlayerResponse = {
  videoDetails?: { videoId?: string };
  captions?: { playerCaptionsTracklistRenderer?: CaptionTrackListRenderer };
};

type PlayerElement = HTMLElement & {
  getPlayerResponse?: () => unknown;
  getOption?: (module: string, option: string) => unknown;
  setOption?: (module: string, option: string, value: unknown) => void;
  loadModule?: (module: string) => void;
};

type Ytcfg = { get?: (key: string) => unknown };
type EarwormWindow = Window & { __earwormInjected?: boolean; ytcfg?: Ytcfg };
type XhrWithUrl = XMLHttpRequest & { __earwormUrl?: string };
type XhrOpen = (
  method: string,
  url: string | URL,
  async?: boolean,
  username?: string | null,
  password?: string | null,
) => void;
type XhrSend = (body?: Document | XMLHttpRequestBodyInit | null) => void;

export type InjectRuntimeDeps = {
  pageWindow?: Window;
  pageDocument?: Document;
  fetchImpl?: typeof fetch;
  now?: () => number;
  getHref?: () => string;
};

/* -------------------------------------------------------------------------- */
/* runtime                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Install the sniffer + acquisition state machine once per document. Returns a
 * teardown used by tests; the manifest entrypoint never tears down.
 */
export function startInjectRuntime(deps: InjectRuntimeDeps = {}): () => void {
  const pageWindow = deps.pageWindow ?? window;
  const pageDocument = deps.pageDocument ?? document;
  const now = deps.now ?? (() => Date.now());
  const getHref = deps.getHref ?? (() => pageWindow.location.href);

  // Double-injection guard: WXT development reloads and other extensions can
  // evaluate this file twice; the second copy must be inert.
  if ((pageWindow as EarwormWindow).__earwormInjected) return () => {};
  (pageWindow as EarwormWindow).__earwormInjected = true;

  /* ---- capture state ---------------------------------------------------- */

  const currentVid = (): string => videoIdFromHref(getHref());

  let currentVideoId = currentVid();
  // Most recently captured accepted-English (manual or ASR) source URL
  // (freshest pot wins).
  let sourceUrl = '';
  // The video that sourceUrl belongs to; a stale URL is never fetched/posted.
  let sourceVid = '';
  // Track identity ignoring pot/fmt/tlang; only a key change re-produces.
  let sourceKey = '';
  // Dedupe for one successful/attempted production of a given URL.
  let producedForUrl = '';
  // Set by a content `earworm:produce` message; cleared by an SPA video change.
  let wanted = false;

  let nocuesTimer: ReturnType<typeof setTimeout> | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // Screen-text fallback state (see startScreenTextCapture).
  let screenTimer: ReturnType<typeof setInterval> | null = null;
  let screenDeadline: ReturnType<typeof setTimeout> | null = null;
  let screenLines: Array<{ text: string; at: number }> = [];
  let screenLastText = '';

  // Our own json3 fetches, counted by exact URL (see SELF_URL_LINGER_MS).
  const selfUrls = new Map<string, number>();
  // Serialize production; force requests queue instead of racing.
  let producing = false;
  let produceAgain = false;
  let produceAgainForce = false;
  // Timedtext is sticky-rate-limited; remember it per document.
  let ttLimitedUntil = 0;

  const clearNocuesTimer = (): void => {
    if (nocuesTimer !== null) {
      clearTimeout(nocuesTimer);
      nocuesTimer = null;
    }
  };
  const clearGraceTimer = (): void => {
    if (graceTimer !== null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
  };

  const clearScreenTextTimers = (): void => {
    if (screenTimer !== null) {
      clearInterval(screenTimer);
      screenTimer = null;
    }
    if (screenDeadline !== null) {
      clearTimeout(screenDeadline);
      screenDeadline = null;
    }
  };

  const resetScreenTextCapture = (): void => {
    clearScreenTextTimers();
    screenLines = [];
    screenLastText = '';
  };

  const resetCaptureState = (): void => {
    sourceUrl = '';
    sourceVid = '';
    sourceKey = '';
    producedForUrl = '';
    clearNocuesTimer();
    clearGraceTimer();
    resetScreenTextCapture();
  };

  /**
   * Watch for an SPA video change. Returns true when the location id changed
   * and all capture state was reset. The 500ms poll is the belt to
   * `yt-navigate-finish`'s braces: Shorts swipes race the event.
   */
  const syncVideo = (): boolean => {
    const next = currentVid();
    if (!next || next === currentVideoId) return false;
    currentVideoId = next;
    resetCaptureState();
    // The isolated client sends a fresh produce for the new video; until then
    // an early capture must not fetch on the previous video's behalf.
    wanted = false;
    return true;
  };

  /* ---- player access ---------------------------------------------------- */

  const activePlayer = (): PlayerElement | null => {
    try {
      const id = isShortsHref(getHref()) ? PLAYER_DOM_ID.shorts : PLAYER_DOM_ID.movie;
      return pageDocument.getElementById(id) as PlayerElement | null;
    } catch {
      return null;
    }
  };

  const asPlayerResponse = (value: unknown): PlayerResponse | null =>
    typeof value === 'object' && value !== null ? (value as PlayerResponse) : null;

  const playerResponseFor = (videoId: string): PlayerResponse | null => {
    try {
      const initial = asPlayerResponse(
        (pageWindow as Window & { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse,
      );
      if (initial?.videoDetails?.videoId === videoId) return initial;
    } catch {
      /* ignore */
    }
    try {
      const player = activePlayer();
      if (player && typeof player.getPlayerResponse === 'function') {
        const fromPlayer = asPlayerResponse(player.getPlayerResponse());
        if (fromPlayer?.videoDetails?.videoId === videoId) return fromPlayer;
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  const tracksFromResponse = (value: unknown): CaptionTrack[] | null => {
    const response = asPlayerResponse(value);
    if (!response) return null;
    // A response without a captions block genuinely lists no tracks; an
    // unreadable response is unknown and must try the next source.
    if (!response.captions) return [];
    const tracks = response.captions.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks)) return [];
    return tracks.filter(
      (track): track is CaptionTrack => typeof track === 'object' && track !== null,
    );
  };

  /**
   * `captionTracks` for this video, or `null` when the player response cannot be
   * read at all (unknown, not "none"). An empty array means the response exists
   * and genuinely lists no tracks.
   */
  const captionTracksFor = (videoId: string): CaptionTrack[] | null => {
    const response = playerResponseFor(videoId);
    if (!response) return null;
    return tracksFromResponse(response);
  };

  /**
   * Last metadata route of the fallback chain: ask the innertube `player`
   * endpoint (asbplayer's idea, re-implemented here from its behaviour, no code
   * copied — it is AGPL). Only used to LEARN the track list; its `baseUrl`s
   * carry no pot and are never fetched for cues. Same-origin page-context
   * request, page cookies included.
   */
  const innertubeCaptionTracks = async (videoId: string): Promise<CaptionTrack[] | null> => {
    try {
      const ytcfg = (pageWindow as EarwormWindow).ytcfg;
      if (!ytcfg || typeof ytcfg.get !== 'function') return null;
      const apiKey = ytcfg.get('INNERTUBE_API_KEY');
      const context = ytcfg.get('INNERTUBE_CONTEXT');
      if (typeof apiKey !== 'string' || !apiKey) return null;
      if (typeof context !== 'object' || context === null) return null;

      const endpoint = new URL('/youtubei/v1/player', getHref());
      endpoint.searchParams.set('key', apiKey);
      const init: RequestInit = {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, context }),
      };
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        init.signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
      }
      const response = deps.fetchImpl
        ? await deps.fetchImpl(endpoint.toString(), init)
        : await pageWindow.fetch(endpoint.toString(), init);
      if (!response.ok) return null;
      const text = await response.text();
      if (!text) return null;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return null;
      }
      return tracksFromResponse(json);
    } catch {
      return null;
    }
  };

  /* ---- bridge ----------------------------------------------------------- */

  const postFailed = (videoId: string, reason: TranscriptFailureReason): void => {
    if (videoId !== currentVid()) return;
    postCuesFailed({ videoId, reason });
  };

  /* ---- fetch ------------------------------------------------------------ */

  const markSelfUrl = (url: string): void => {
    selfUrls.set(url, (selfUrls.get(url) ?? 0) + 1);
  };

  const scheduleSelfRelease = (url: string): void => {
    setTimeout(() => {
      try {
        const left = (selfUrls.get(url) ?? 1) - 1;
        if (left > 0) selfUrls.set(url, left);
        else selfUrls.delete(url);
      } catch {
        /* ignore */
      }
    }, SELF_URL_LINGER_MS);
  };

  const request = async (url: string): Promise<Response> => {
    const init: RequestInit = { method: 'GET', credentials: 'include' };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    }
    if (deps.fetchImpl) return deps.fetchImpl(url, init);
    return pageWindow.fetch(url, init);
  };

  const statusOf = (error: unknown): number | undefined => {
    if (typeof error !== 'object' || error === null) return undefined;
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  };

  const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const fetchJson3 = async (url: string): Promise<unknown> => {
    markSelfUrl(url);
    try {
      const response = await request(url);
      if (!response.ok) {
        const error = new Error(`timedtext http ${response.status}`) as Error & {
          status?: number;
        };
        error.status = response.status;
        throw error;
      }
      const text = await response.text();
      // YouTube answers 200 with an empty body when the pot/session is refused;
      // that is a retryable failure, not "this video has no cues".
      if (!text) throw new Error('timedtext empty body');
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error('timedtext invalid json');
      }
    } finally {
      scheduleSelfRelease(url);
    }
  };

  /** One HTTP retry for hiccups; a 429 is remembered instead of retried. */
  const fetchJson3Retry = async (url: string, wantVideoId: string): Promise<unknown> => {
    const maxRetries = now() < ttLimitedUntil ? 0 : 1;
    for (let attempt = 0; ; attempt += 1) {
      try {
        const json = await fetchJson3(url);
        ttLimitedUntil = 0;
        return json;
      } catch (error) {
        const status = statusOf(error);
        if (status === 429) ttLimitedUntil = now() + RATE_LIMIT_MEMORY_MS;
        const failure = classifyHttpStatus(status);
        if (attempt >= maxRetries || failure !== 'retryable') throw error;
        await delay(HTTP_RETRY_DELAY_MS);
        // Navigated away mid-retry: the caller discards the result anyway.
        if (wantVideoId !== currentVid()) throw error;
      }
    }
  };

  /* ---- production ------------------------------------------------------- */

  const produceCuesOnce = async (force: boolean): Promise<void> => {
    if (!wanted || !sourceUrl) return;
    const videoId = currentVid();
    if (!videoId || sourceVid !== videoId) return;
    if (!isEnglishCapturedTrack(classifyCapturedTrack(sourceUrl, getHref()))) return;
    if (!force && producedForUrl === sourceUrl) return;

    producedForUrl = sourceUrl;
    clearNocuesTimer();
    // Pin ONE pot-bearing URL: sourceUrl is refreshed on every rotation, so
    // reading it again after the await could pick a different token.
    const src = sourceUrl;
    const lang = trackLangOf(src, getHref());
    const kind = trackKindOf(src, getHref());
    try {
      const json = await fetchJson3Retry(buildUrl(src, getHref()), videoId);
      // Three independent checks: capture-time filter, produce-start guard and
      // this post-await guard. The last one is what keeps a slow response for
      // the previous video from being posted under the new videoId.
      if (videoId !== currentVid() || sourceVid !== currentVid()) return;
      const cues = parseJson3(json);
      if (cues.length === 0) {
        producedForUrl = '';
        postFailed(videoId, 'no-captions');
        return;
      }
      postCuesReady({ videoId, lang: lang || 'en', kind, cues });
    } catch (error) {
      if (videoId !== currentVid() || sourceVid !== currentVid()) return;
      // Allow a retry if the player rotates the pot / asks again later.
      producedForUrl = '';
      postFailed(videoId, statusOf(error) !== undefined ? 'http' : 'timeout');
    }
  };

  const produceCues = (force: boolean): void => {
    if (producing) {
      produceAgain = true;
      if (force) produceAgainForce = true;
      return;
    }
    producing = true;
    void produceCuesOnce(force)
      .catch(() => {
        /* never throw into the page */
      })
      .finally(() => {
        producing = false;
        if (!produceAgain) return;
        const again = produceAgainForce;
        produceAgain = false;
        produceAgainForce = false;
        produceCues(again);
      });
  };

  /* ---- fallback chain --------------------------------------------------- */

  const nudgeCaptions = (track: CaptionTrack | null): void => {
    try {
      const player = activePlayer();
      if (player) {
        try {
          player.loadModule?.('captions');
        } catch {
          /* ignore */
        }
        try {
          const button = player.querySelector(PAGE_SELECTORS.subtitlesButton);
          if (button instanceof HTMLElement) {
            const pressed = button.getAttribute('aria-pressed');
            const disabled = button.getAttribute('aria-disabled');
            if (pressed !== 'true' && disabled !== 'true') button.click();
          }
        } catch {
          /* ignore */
        }
      }
      if (!track) return;
      const videoId = currentVid();
      // loadModule makes the captions module/tracklist available; selecting the
      // track is what actually makes the player fetch it (module load alone was
      // measured not to arm captions upstream).
      setTimeout(() => {
        try {
          if (videoId !== currentVid() || sourceUrl) return;
          const current = activePlayer();
          if (current && typeof current.setOption === 'function') {
            current.setOption('captions', 'track', captionTrackDescriptor(track));
          }
        } catch {
          /* ignore */
        }
      }, 300);
    } catch {
      /* never throw */
    }
  };

  /* ---- screen-text fallback -------------------------------------------- */

  /** Caption text currently painted by the player, whitespace-normalized. */
  const readScreenCaptionText = (): string => {
    try {
      // Prefer the painted line nodes; `.caption-window` is the fallback when
      // the player renders a single window without segment children.
      let nodes = Array.from(pageDocument.querySelectorAll(PAGE_SELECTORS.captionSegment));
      if (nodes.length === 0) {
        nodes = Array.from(pageDocument.querySelectorAll(PAGE_SELECTORS.captionWindow));
      }
      const parts: string[] = [];
      for (const node of nodes) {
        const raw = (node as { textContent?: string | null }).textContent;
        if (typeof raw !== 'string') continue;
        const text = raw.replace(/\s+/g, ' ').trim();
        if (text.length > 0) parts.push(text);
      }
      return parts.join(' ').trim();
    } catch {
      return '';
    }
  };

  /** Player clock for synthetic cue timestamps (0 when unreadable). */
  const readScreenVideoTime = (): number => {
    try {
      const video = pageDocument.querySelector(PAGE_SELECTORS.video) as
        | (Element & { currentTime?: number })
        | null;
      const time = video?.currentTime;
      return typeof time === 'number' && Number.isFinite(time) ? Math.max(0, time) : 0;
    } catch {
      return 0;
    }
  };

  const buildScreenTextCues = (): Cue[] => {
    const cues: Cue[] = [];
    for (let index = 0; index < screenLines.length; index += 1) {
      const line = screenLines[index]!;
      const next = screenLines[index + 1];
      const start = Math.max(0, line.at);
      const end = next
        ? Math.max(next.at, start + SCREEN_TEXT_MIN_CUE_SECONDS)
        : start + SCREEN_TEXT_TAIL_SECONDS;
      cues.push({ start, end, text: line.text });
    }
    return cues;
  };

  const finalizeScreenText = (
    videoId: string,
    failure: TranscriptFailureReason,
    kind: CueTrackKind,
  ): void => {
    clearScreenTextTimers();
    // A real capture / navigation / teardown during the window wins.
    if (videoId !== currentVid() || !wanted || sourceUrl) {
      resetScreenTextCapture();
      return;
    }
    const cues = buildScreenTextCues();
    resetScreenTextCapture();
    if (cues.length === 0) {
      postFailed(videoId, failure);
      return;
    }
    postCuesReady({ videoId, lang: 'en', kind, cues });
  };

  /**
   * Best-effort fallback after the nudge/timeout: YouTube's caption DOM is
   * still rendered (we only make it transparent once the overlay is ready), so
   * read its text for a bounded window and synthesize cues.
   *
   * Limitations: only lines that are actually painted while the video plays
   * are captured, start times are sample wall-clock times (not true cue
   * starts), and a paused/blank caption window yields no text, in which case
   * the original classified failure is posted. The synthesized cues carry the
   * selected track's kind so ASR videos still use the ASR sentence rules. A
   * real timedtext capture aborts the scrape.
   */
  const startScreenTextCapture = (
    videoId: string,
    failure: TranscriptFailureReason,
    kind: CueTrackKind,
  ): void => {
    if (screenTimer !== null || screenDeadline !== null) return;
    if (videoId !== currentVid() || !wanted || sourceUrl) return;

    resetScreenTextCapture();
    const seen = new Set<string>();

    const sample = (): void => {
      try {
        if (videoId !== currentVid() || !wanted || sourceUrl) {
          resetScreenTextCapture();
          return;
        }
        const text = readScreenCaptionText();
        if (text.length === 0 || text === screenLastText) return;
        screenLastText = text;
        if (seen.has(text)) return;
        seen.add(text);
        screenLines.push({ text, at: readScreenVideoTime() });
      } catch {
        /* never throw into the page */
      }
    };

    sample();
    screenTimer = setInterval(sample, SCREEN_TEXT_SAMPLE_MS);
    screenDeadline = setTimeout(
      () => finalizeScreenText(videoId, failure, kind),
      SCREEN_TEXT_WINDOW_MS,
    );
  };

  const scheduleGrace = (
    videoId: string,
    failure: TranscriptFailureReason,
    kind: CueTrackKind = 'manual',
  ): void => {
    clearGraceTimer();
    resetScreenTextCapture();
    graceTimer = setTimeout(() => {
      graceTimer = null;
      if (videoId !== currentVid() || !wanted) return;
      if (sourceUrl) return; // a capture raced the grace window — all good
      // Best-effort: the player may still be painting captions even though we
      // could not sniff timedtext. Try the screen text before failing.
      startScreenTextCapture(videoId, failure, kind);
    }, NUDGE_GRACE_MS);
  };

  const fallbackFor = async (videoId: string): Promise<void> => {
    try {
      let tracks = captionTracksFor(videoId);
      if (tracks === null) {
        // The page's player response is unreadable (mid-swap, previous video,
        // flaky internal API): ask innertube before giving up on classification.
        tracks = await innertubeCaptionTracks(videoId);
      }
      if (videoId !== currentVid() || !wanted) return;
      if (tracks === null) {
        // Still unknown: ask CC on generically and concede `timeout` (we cannot
        // honestly say "no captions").
        nudgeCaptions(null);
        scheduleGrace(videoId, 'timeout');
        return;
      }
      const selection = selectEnglishTrack(tracks);
      if (selection.kind === 'no-captions') {
        postFailed(videoId, 'no-captions');
        return;
      }
      // Manual is preferred; when only ASR English exists, nudge that exact
      // track and let the screen-text fallback synthesize ASR-kind cues too.
      const kind: CueTrackKind = selection.kind === 'asr-en' ? 'asr' : 'manual';
      nudgeCaptions(selection.track);
      // A selected English track exists but the player still has not fetched it.
      scheduleGrace(videoId, 'nudge-failed', kind);
    } catch {
      if (videoId !== currentVid() || !wanted) return;
      nudgeCaptions(null);
      scheduleGrace(videoId, 'timeout');
    }
  };

  const runFallback = (videoId: string): void => {
    void fallbackFor(videoId);
  };

  const armNocuesTimer = (): void => {
    clearNocuesTimer();
    const videoId = currentVid();
    if (!videoId) return;
    nocuesTimer = setTimeout(() => {
      nocuesTimer = null;
      if (videoId !== currentVid() || !wanted) return;
      if (sourceUrl) return; // capture raced the timer; production is running
      runFallback(videoId);
    }, NOCUES_TIMEOUT_MS);
  };

  /* ---- capture ---------------------------------------------------------- */

  const noteTimedtext = (rawUrl: unknown): void => {
    try {
      if (typeof rawUrl !== 'string' || !isTimedtextUrl(rawUrl)) return;
      // This exact request is ours (we marked it before fetching); without this
      // our own json3 re-fetch looks like "the player asked again".
      if (selfUrls.has(rawUrl)) return;

      const pageHref = getHref();
      const videoIdHere = videoIdFromHref(pageHref);
      if (!videoIdHere) return;
      // Only this page's video. Hover-preview players and second players fetch
      // their own track through the same hook; adopting it would poison the
      // capture for the real video.
      if (vidOfUrl(rawUrl, pageHref) !== videoIdHere) return;

      const captured = classifyCapturedTrack(rawUrl, pageHref);
      // Manual English preferred, ASR English accepted; every other capture
      // (including non-English ASR) is ignored so we never produce wrong cues.
      if (!isEnglishCapturedTrack(captured)) return;

      if (captured === 'asr-en') {
        // The player may fetch its ASR track before the human one. Accepting
        // that capture would lock the session to ASR even when a manual track
        // exists, but spec §7.10 requires manual to win when both are offered.
        // Once the human track is captured, later ASR captures are ignored; if
        // the readable track list still offers a human track, ignore this
        // capture and nudge the player onto that track instead.
        if (
          sourceUrl &&
          sourceVid === videoIdHere &&
          classifyCapturedTrack(sourceUrl, pageHref) === 'manual-en'
        ) {
          return;
        }
        const tracks = captionTracksFor(videoIdHere);
        if (tracks !== null) {
          const selection = selectEnglishTrack(tracks);
          if (selection.kind === 'manual-en') {
            nudgeCaptions(selection.track);
            scheduleGrace(videoIdHere, 'nudge-failed', 'manual');
            return;
          }
        }
        // Unknown track list or no manual English track: ASR remains the
        // fallback source and this capture is accepted below.
      }

      // When the player's selected track is an auto-translate one, every
      // request it makes carries tlang=; the URL minus tlang is still the
      // source track and its pot holds for the source leg.
      const baseUrl = hasTlang(rawUrl, pageHref) ? stripTlang(rawUrl, pageHref) : rawUrl;
      const key = normKey(baseUrl, pageHref);
      sourceUrl = baseUrl; // always freshest pot
      sourceVid = videoIdHere;
      resetScreenTextCapture(); // a real capture wins over the scrape

      if (key !== sourceKey) {
        sourceKey = key;
        producedForUrl = '';
        if (wanted) produceCues(false);
        return;
      }
      // Same track, fresh pot, after a failed attempt: worth one more try with
      // the token the player itself just used. Pot rotations of a successful
      // production are a no-op (producedForUrl is non-empty).
      if (wanted && producedForUrl === '' && !producing) produceCues(false);
    } catch {
      /* never throw into the page */
    }
  };

  /* ---- content messages ------------------------------------------------- */

  const onContentMessage = (event: MessageEvent): void => {
    try {
      const message = parseContentEvent(event);
      if (!message) return;
      syncVideo();
      const videoId = currentVid();
      // MAIN world's source of truth is the URL `v=`/path id; a produce request
      // stamped with any other id (stale navigation) is dropped.
      if (!videoId || message.payload.videoId !== videoId) return;
      wanted = true;
      if (message.payload.force) producedForUrl = '';
      if (sourceUrl && sourceVid === videoId) {
        produceCues(message.payload.force === true);
      } else {
        armNocuesTimer();
      }
    } catch {
      /* never throw into the page */
    }
  };

  /* ---- hooks ------------------------------------------------------------ */

  const restorers: Array<() => void> = [];

  const installXhrHook = (): void => {
    try {
      const proto = XMLHttpRequest?.prototype;
      if (!proto) return;
      const originalOpen = proto.open as XhrOpen;
      const originalSend = proto.send as XhrSend;
      proto.open = function (
        this: XhrWithUrl,
        method: string,
        url: string | URL,
        ...rest: unknown[]
      ): void {
        try {
          this.__earwormUrl = typeof url === 'string' ? url : url.toString();
        } catch {
          /* ignore */
        }
        // Forward the caller's argument list verbatim: passing explicit
        // `undefined` for the optional async/user/password slots can change
        // WebIDL coercion (e.g. username becomes the string "undefined").
        (originalOpen as unknown as (...args: unknown[]) => void).apply(this, [method, url, ...rest]);
      } as unknown as typeof proto.open;
      proto.send = function (
        this: XhrWithUrl,
        body?: Document | XMLHttpRequestBodyInit | null,
      ): void {
        // Note BEFORE the native send: the URL is then captured even if the
        // request is aborted before it completes.
        try {
          noteTimedtext(this.__earwormUrl);
        } catch {
          /* ignore */
        }
        originalSend.call(this, body);
      } as typeof proto.send;
      restorers.push(() => {
        proto.open = originalOpen as unknown as typeof proto.open;
        proto.send = originalSend as unknown as typeof proto.send;
      });
    } catch {
      /* another extension may have locked the prototype; RT still works */
    }
  };

  const installFetchHook = (): void => {
    try {
      const originalFetch = pageWindow.fetch;
      if (typeof originalFetch !== 'function') return;
      pageWindow.fetch = function (
        this: unknown,
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> {
        try {
          let url = '';
          if (typeof input === 'string') url = input;
          else if (input && typeof (input as { url?: unknown }).url === 'string') {
            url = (input as { url: string }).url;
          } else if (typeof URL !== 'undefined' && input instanceof URL) {
            url = input.toString();
          }
          noteTimedtext(url);
        } catch {
          /* ignore */
        }
        // Delegate with the original `this`, arguments and return value.
        return originalFetch.call(pageWindow, input, init);
      } as typeof pageWindow.fetch;
      restorers.push(() => {
        pageWindow.fetch = originalFetch;
      });
    } catch {
      /* ignore */
    }
  };

  const installPerformanceObserver = (): void => {
    try {
      const scan = (entries: readonly PerformanceEntry[]): void => {
        for (const entry of entries) noteTimedtext(entry.name);
      };
      scan(pageWindow.performance.getEntriesByType('resource'));
      if (typeof PerformanceObserver === 'function') {
        const observer = new PerformanceObserver((list) => {
          try {
            scan(list.getEntries());
          } catch {
            /* ignore */
          }
        });
        observer.observe({ type: 'resource', buffered: true });
        restorers.push(() => observer.disconnect());
      }
    } catch {
      /* ignore */
    }
  };

  /* ---- wiring ----------------------------------------------------------- */

  installXhrHook();
  installFetchHook();
  installPerformanceObserver();

  const onNavigate = (): void => {
    try {
      syncVideo();
    } catch {
      /* ignore */
    }
  };

  pageWindow.addEventListener('message', onContentMessage, false);
  pageWindow.addEventListener('yt-navigate-finish', onNavigate, true);
  pollTimer = setInterval(() => {
    try {
      syncVideo();
    } catch {
      /* ignore */
    }
  }, 500);

  return () => {
    clearNocuesTimer();
    clearGraceTimer();
    resetScreenTextCapture();
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    try {
      pageWindow.removeEventListener('message', onContentMessage, false);
      pageWindow.removeEventListener('yt-navigate-finish', onNavigate, true);
    } catch {
      /* ignore */
    }
    for (const restore of restorers.splice(0)) {
      try {
        restore();
      } catch {
        /* ignore */
      }
    }
    (pageWindow as EarwormWindow).__earwormInjected = false;
  };
}

/* -------------------------------------------------------------------------- */
/* entrypoint                                                                  */
/* -------------------------------------------------------------------------- */

export default defineUnlistedScript({
  main() {
    startInjectRuntime();
  },
});
