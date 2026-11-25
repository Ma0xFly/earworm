import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCREEN_TEXT_WINDOW_MS, startInjectRuntime } from '@/entrypoints/inject';
import { createInjectEnvelope, INJECT_MESSAGE, type InjectEnvelope } from '@/lib/messages';
import type { Cue } from '@/lib/contracts';
import type { TranscriptFailureReason } from '@/lib/transcript/client';

type FakeResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

function response(body: unknown, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function networkError(status?: number): Error {
  const error = new Error(status === undefined ? 'network' : `http ${status}`) as Error & {
    status?: number;
  };
  if (status !== undefined) error.status = status;
  return error;
}

function setVideo(videoId: string): void {
  window.history.replaceState({}, '', videoId ? `/watch?v=${videoId}` : '/');
}

function captured(videoId: string, extra = 'lang=en&kind=&pot=POT1&signature=SIG1'): string {
  return `https://www.youtube.com/api/timedtext?v=${videoId}&${extra}&fmt=srv3`;
}

function produce(videoId: string, force?: boolean): void {
  const data = createInjectEnvelope('content-to-inject', INJECT_MESSAGE.produce, {
    videoId,
    ...(force ? { force: true } : {}),
  });
  window.dispatchEvent(new MessageEvent('message', { source: window, data }));
}

function playerResponse(videoId: string, tracks?: unknown[]): unknown {
  return {
    videoDetails: { videoId },
    ...(tracks === undefined
      ? {}
      : { captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } }),
  };
}

type FakePlayer = {
  loadModule: ReturnType<typeof vi.fn>;
  setOption: ReturnType<typeof vi.fn>;
  getPlayerResponse: ReturnType<typeof vi.fn>;
  querySelector: ReturnType<typeof vi.fn>;
};

type FakePage = {
  captions?: () => Array<{ textContent: string }>;
  time?: () => number;
};

function fakeDocument(player: FakePlayer, page: FakePage = {}): Document {
  return {
    getElementById: (id: string) => (id === 'movie_player' ? player : null),
    querySelector: (selector: string) =>
      selector === 'video' ? { currentTime: page.time?.() ?? 0 } : null,
    querySelectorAll: (_selector: string) => page.captions?.() ?? [],
  } as unknown as Document;
}

function makePlayer(responseValue: unknown = null): FakePlayer {
  return {
    loadModule: vi.fn(),
    setOption: vi.fn(),
    getPlayerResponse: vi.fn(() => responseValue),
    querySelector: vi.fn(() => null),
  };
}

const emptyJson = { events: [] };
const englishJson = {
  events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Hello ' }, { utf8: 'world.' }] },
    { tStartMs: 2000, dDurationMs: 1500, segs: [{ utf8: 'Second line.' }] },
  ],
};

const expectedCues: Cue[] = [
  { start: 0, end: 2, text: 'Hello world.' },
  { start: 2, end: 3.5, text: 'Second line.' },
];

describe('MAIN-world inject runtime', () => {
  let stop: (() => void) | null;
  let postMessage: ReturnType<typeof vi.spyOn>;
  let originalFetch: typeof fetch;
  let player: FakePlayer;

  beforeEach(() => {
    vi.useFakeTimers();
    setVideo('vid1');
    stop = null;
    player = makePlayer(null);
    delete (window as Window & { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse;
    delete (window as Window & { ytcfg?: unknown }).ytcfg;
    postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    originalFetch = window.fetch;
  });

  afterEach(() => {
    stop?.();
    stop = null;
    window.fetch = originalFetch;
    postMessage.mockRestore();
    vi.useRealTimers();
    setVideo('');
    delete (window as Window & { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse;
    delete (window as Window & { ytcfg?: unknown }).ytcfg;
  });

  function start(
    fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<FakeResponse>,
    options: { tracks?: unknown[]; response?: unknown; page?: FakePage } = {},
  ): void {
    if (options.response !== undefined) player.getPlayerResponse.mockReturnValue(options.response);
    else if (options.tracks !== undefined) {
      player.getPlayerResponse.mockReturnValue(playerResponse('vid1', options.tracks));
    }
    // The page's own fetch is replaced by a harmless stub; the runtime captures
    // it as the original when it installs its hook.
    window.fetch = vi.fn(async () => response({})) as unknown as typeof fetch;
    stop = startInjectRuntime({
      pageDocument: fakeDocument(player, options.page),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
  }

  function posted(): InjectEnvelope[] {
    return postMessage.mock.calls.map((call: unknown[]) => call[0] as InjectEnvelope);
  }

  function postedFailure(): TranscriptFailureReason | undefined {
    const failure = posted().find(
      (message) => message.type === INJECT_MESSAGE.cuesFailed,
    );
    return (failure?.payload as { reason?: TranscriptFailureReason } | undefined)?.reason;
  }

  async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }

  it('captures the player URL, re-fetches json3 and posts normalized cues', async () => {
    const fetchImpl = vi.fn(async () => response(englishJson));
    start(fetchImpl);

    produce('vid1');
    await window.fetch(captured('vid1'));
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const requested = new URL(String((fetchImpl.mock.calls[0] as unknown[] | undefined)?.[0]));
    expect(requested.searchParams.get('fmt')).toBe('json3');
    expect(requested.searchParams.get('pot')).toBe('POT1');
    expect(requested.searchParams.get('signature')).toBe('SIG1');
    expect(requested.searchParams.get('lang')).toBe('en');

    expect(posted()).toContainEqual({
      __earworm: true,
      dir: 'inject-to-content',
      type: INJECT_MESSAGE.cuesReady,
      payload: { videoId: 'vid1', lang: 'en', kind: 'manual', cues: expectedCues },
    });
  });

  it('strips tlang from an auto-translate capture but keeps pot/signature', async () => {
    const fetchImpl = vi.fn(async () => response(englishJson));
    start(fetchImpl);

    produce('vid1');
    await window.fetch(captured('vid1', 'lang=en&kind=&pot=POT2&signature=SIG2&tlang=es'));
    await flush();

    const requested = new URL(String((fetchImpl.mock.calls[0] as unknown[] | undefined)?.[0]));
    expect(requested.searchParams.get('tlang')).toBeNull();
    expect(requested.searchParams.get('fmt')).toBe('json3');
    expect(requested.searchParams.get('pot')).toBe('POT2');
    expect(requested.searchParams.get('signature')).toBe('SIG2');
  });

  it('captures the player ASR English track and posts it with kind asr', async () => {
    const fetchImpl = vi.fn(async () => response(englishJson));
    start(fetchImpl);

    produce('vid1');
    await window.fetch(captured('vid1', 'lang=en&kind=asr&pot=POT-ASR&signature=SIG-ASR'));
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const requested = new URL(String((fetchImpl.mock.calls[0] as unknown[] | undefined)?.[0]));
    expect(requested.searchParams.get('kind')).toBe('asr');
    expect(requested.searchParams.get('pot')).toBe('POT-ASR');
    expect(requested.searchParams.get('fmt')).toBe('json3');

    expect(posted()).toContainEqual({
      __earworm: true,
      dir: 'inject-to-content',
      type: INJECT_MESSAGE.cuesReady,
      payload: { videoId: 'vid1', lang: 'en', kind: 'asr', cues: expectedCues },
    });
  });

  it('ignores an early ASR capture when a manual English track exists', async () => {
    const fetchImpl = vi.fn(async () => response(englishJson));
    start(fetchImpl, {
      tracks: [
        { languageCode: 'en', kind: 'asr', vssId: 'a.en' },
        { languageCode: 'en', vssId: '.en' },
      ],
    });

    produce('vid1');
    await window.fetch(captured('vid1', 'lang=en&kind=asr&pot=POT-ASR&signature=SIG-ASR'));
    await flush();

    // The ASR capture must not steal the source or start a session.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(posted().filter((message) => message.type === INJECT_MESSAGE.cuesReady)).toHaveLength(0);

    // The player is nudged onto the human track instead.
    expect(player.loadModule).toHaveBeenCalledWith('captions');
    await vi.advanceTimersByTimeAsync(300);
    expect(player.setOption).toHaveBeenCalledWith('captions', 'track', {
      languageCode: 'en',
      vssId: '.en',
    });

    // The human capture that follows is the one that produces cues.
    await window.fetch(captured('vid1'));
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(posted()).toContainEqual({
      __earworm: true,
      dir: 'inject-to-content',
      type: INJECT_MESSAGE.cuesReady,
      payload: { videoId: 'vid1', lang: 'en', kind: 'manual', cues: expectedCues },
    });
  });

  it('ignores a later ASR capture once the manual track was captured', async () => {
    const fetchImpl = vi.fn(async () => response(englishJson));
    start(fetchImpl, {
      tracks: [
        { languageCode: 'en', kind: 'asr', vssId: 'a.en' },
        { languageCode: 'en', vssId: '.en' },
      ],
    });

    produce('vid1');
    await window.fetch(captured('vid1'));
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(posted().filter((message) => message.type === INJECT_MESSAGE.cuesReady)).toHaveLength(1);

    await window.fetch(captured('vid1', 'lang=en&kind=asr&pot=POT-ASR&signature=SIG-ASR'));
    await flush();

    // No second fetch and no session replacement: the manual track keeps winning.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(posted().filter((message) => message.type === INJECT_MESSAGE.cuesReady)).toHaveLength(1);
    expect(posted()[0]?.payload).toMatchObject({ kind: 'manual' });
  });

  it('accepts an ASR capture when the readable track list has no manual English track', async () => {
    const fetchImpl = vi.fn(async () => response(englishJson));
    start(fetchImpl, { tracks: [{ languageCode: 'en', kind: 'asr', vssId: 'a.en' }] });

    produce('vid1');
    await window.fetch(captured('vid1', 'lang=en&kind=asr&pot=POT-ASR&signature=SIG-ASR'));
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(posted()).toContainEqual({
      __earworm: true,
      dir: 'inject-to-content',
      type: INJECT_MESSAGE.cuesReady,
      payload: { videoId: 'vid1', lang: 'en', kind: 'asr', cues: expectedCues },
    });
  });

  it('ignores non-English and other-video captures', async () => {
    const fetchImpl = vi.fn(async () => response(englishJson));
    start(fetchImpl);
    produce('vid1');

    // A manual or ASR track in another language is never an English track.
    await window.fetch(captured('vid1', 'lang=fr&kind=&pot=POT1'));
    await window.fetch(captured('vid1', 'lang=fr&kind=asr&pot=POT1'));
    await window.fetch(captured('vid2', 'lang=en&kind=&pot=POT1'));
    await flush();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(posted()).toHaveLength(0);
  });

  it('nudges the ASR English track when the video has no manual track', async () => {
    const fetchImpl = vi.fn(async () => response(englishJson));
    start(fetchImpl, {
      tracks: [{ languageCode: 'en', kind: 'asr', vssId: 'a.en' }],
    });

    produce('vid1');
    await vi.advanceTimersByTimeAsync(8000);
    expect(player.loadModule).toHaveBeenCalledWith('captions');

    await vi.advanceTimersByTimeAsync(300);
    // The descriptor keeps kind/vssId so the player selects the ASR track
    // rather than leaving captions off or picking another language.
    expect(player.setOption).toHaveBeenCalledWith('captions', 'track', {
      languageCode: 'en',
      kind: 'asr',
      vssId: 'a.en',
    });

    await vi.advanceTimersByTimeAsync(3000 + SCREEN_TEXT_WINDOW_MS);
    expect(postedFailure()).toBe('nudge-failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports no-captions when the player response lists no English track', async () => {
    const fetchImpl = vi.fn(async () => response(englishJson));
    start(fetchImpl, { tracks: [{ languageCode: 'es' }] });

    produce('vid1');
    await vi.advanceTimersByTimeAsync(8000);

    expect(postedFailure()).toBe('no-captions');
  });

  it('nudges a manual English track, then reports nudge-failed if nothing is sniffed', async () => {
    const fetchImpl = vi.fn(async () => response(englishJson));
    start(fetchImpl, { tracks: [{ languageCode: 'en-GB' }] });

    produce('vid1');
    await vi.advanceTimersByTimeAsync(8000);
    expect(player.loadModule).toHaveBeenCalledWith('captions');

    await vi.advanceTimersByTimeAsync(300);
    expect(player.setOption).toHaveBeenCalledWith('captions', 'track', { languageCode: 'en-GB' });

    await vi.advanceTimersByTimeAsync(3000);
    // The nudge window ends, then the bounded screen-text fallback runs and
    // (with no painted captions in the fake page) concedes the same failure.
    expect(postedFailure()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(SCREEN_TEXT_WINDOW_MS);
    expect(postedFailure()).toBe('nudge-failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('synthesizes cues from painted screen text when nudging cannot be sniffed', async () => {
    const fetchImpl = vi.fn(async () => response(englishJson));
    const captions: Array<{ textContent: string }> = [];
    let time = 10;
    start(fetchImpl, {
      tracks: [{ languageCode: 'en-GB' }],
      page: { captions: () => captions, time: () => time },
    });

    produce('vid1');
    await vi.advanceTimersByTimeAsync(8000 + 300 + 3000);

    captions.push({ textContent: 'Hello there.' });
    time = 10.5;
    await vi.advanceTimersByTimeAsync(250);
    captions[0] = { textContent: 'Second line.' };
    time = 13;
    await vi.advanceTimersByTimeAsync(250);
    captions.length = 0;
    await vi.advanceTimersByTimeAsync(SCREEN_TEXT_WINDOW_MS);

    expect(posted().filter((message) => message.type === INJECT_MESSAGE.cuesFailed)).toHaveLength(0);
    const ready = posted().find((message) => message.type === INJECT_MESSAGE.cuesReady);
    expect(ready?.payload).toEqual({
      videoId: 'vid1',
      lang: 'en',
      kind: 'manual',
      cues: [
        { start: 10.5, end: 13, text: 'Hello there.' },
        { start: 13, end: 15, text: 'Second line.' },
      ],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('marks synthesized screen-text cues as ASR when the nudge chose an ASR track', async () => {
    const fetchImpl = vi.fn(async () => response(englishJson));
    const captions: Array<{ textContent: string }> = [];
    let time = 10;
    start(fetchImpl, {
      tracks: [{ languageCode: 'en', kind: 'asr' }],
      page: { captions: () => captions, time: () => time },
    });

    produce('vid1');
    await vi.advanceTimersByTimeAsync(8000 + 300 + 3000);

    captions.push({ textContent: 'Hello there.' });
    time = 10.5;
    await vi.advanceTimersByTimeAsync(250);
    captions[0] = { textContent: 'Second line.' };
    time = 13;
    await vi.advanceTimersByTimeAsync(250);
    captions.length = 0;
    await vi.advanceTimersByTimeAsync(SCREEN_TEXT_WINDOW_MS);

    const ready = posted().find((message) => message.type === INJECT_MESSAGE.cuesReady);
    expect(ready?.payload).toEqual({
      videoId: 'vid1',
      lang: 'en',
      kind: 'asr',
      cues: [
        { start: 10.5, end: 13, text: 'Hello there.' },
        { start: 13, end: 15, text: 'Second line.' },
      ],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lets a real timedtext capture win over the screen-text fallback', async () => {
    const fetchImpl = vi.fn(async () => response(englishJson));
    const captions: Array<{ textContent: string }> = [{ textContent: 'Heard on screen.' }];
    start(fetchImpl, {
      tracks: [{ languageCode: 'en-GB' }],
      page: { captions: () => captions, time: () => 4 },
    });

    produce('vid1');
    await vi.advanceTimersByTimeAsync(8000 + 300 + 3000);
    await vi.advanceTimersByTimeAsync(250);

    await window.fetch(captured('vid1'));
    await flush();
    expect(posted().filter((message) => message.type === INJECT_MESSAGE.cuesReady)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(SCREEN_TEXT_WINDOW_MS);
    expect(posted().filter((message) => message.type === INJECT_MESSAGE.cuesReady)).toHaveLength(1);
    expect(postedFailure()).toBeUndefined();
  });

  it('retries one transient HTTP failure before posting cues', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(response(englishJson));
    start(fetchImpl);

    produce('vid1');
    await window.fetch(captured('vid1'));
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(posted()).toContainEqual({
      __earworm: true,
      dir: 'inject-to-content',
      type: INJECT_MESSAGE.cuesReady,
      payload: { videoId: 'vid1', lang: 'en', kind: 'manual', cues: expectedCues },
    });
  });

  it('does not retry a fatal 4xx and classifies it as http', async () => {
    const fetchImpl = vi.fn(async () => {
      throw networkError(404);
    });
    start(fetchImpl);

    produce('vid1');
    await window.fetch(captured('vid1'));
    await flush();
    await vi.advanceTimersByTimeAsync(2000);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(postedFailure()).toBe('http');
  });

  it('resets on SPA navigation and re-produces under the new videoId', async () => {
    const fetchImpl = vi.fn(async () => response(englishJson));
    start(fetchImpl);

    produce('vid1');
    await window.fetch(captured('vid1'));
    await flush();
    expect(posted()).toHaveLength(1);

    setVideo('vid2');
    window.dispatchEvent(new Event('yt-navigate-finish'));
    // A stale produce for the previous video is dropped.
    produce('vid1');
    await flush();
    expect(posted()).toHaveLength(1);

    // The content client's SPA request for the new video is accepted.
    produce('vid2', true);
    await window.fetch(captured('vid2', 'lang=en&kind=&pot=POT2&signature=SIG2'));
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const requested = new URL(String((fetchImpl.mock.calls[1] as unknown[] | undefined)?.[0]));
    expect(requested.searchParams.get('v')).toBe('vid2');
    expect(posted()).toHaveLength(2);
    expect(posted()[1]?.payload).toMatchObject({ videoId: 'vid2' });
  });

  it('posts no-captions when a valid track response has no events', async () => {
    const fetchImpl = vi.fn(async () => response(emptyJson));
    start(fetchImpl);

    produce('vid1');
    await window.fetch(captured('vid1'));
    await flush();

    expect(postedFailure()).toBe('no-captions');
  });

  it('falls back to an innertube player request when the page response is unavailable', async () => {
    (window as Window & { ytcfg?: unknown }).ytcfg = {
      get: (key: string) => {
        if (key === 'INNERTUBE_API_KEY') return 'KEY';
        if (key === 'INNERTUBE_CONTEXT') return { client: { clientName: 'WEB', clientVersion: '2.0' } };
        return undefined;
      },
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/youtubei/v1/player')) {
        return response(playerResponse('vid1', [{ languageCode: 'en' }]));
      }
      return response(englishJson);
    });
    start(fetchImpl);

    produce('vid1');
    await vi.advanceTimersByTimeAsync(8000);
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as unknown[] | undefined;
    const requested = new URL(String(call?.[0]));
    expect(requested.pathname).toBe('/youtubei/v1/player');
    expect(requested.searchParams.get('key')).toBe('KEY');
    const init = call?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(init?.body))).toEqual({
      videoId: 'vid1',
      context: { client: { clientName: 'WEB', clientVersion: '2.0' } },
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(player.setOption).toHaveBeenCalledWith('captions', 'track', { languageCode: 'en' });
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(SCREEN_TEXT_WINDOW_MS);
    expect(postedFailure()).toBe('nudge-failed');
  });

  it('nudges the ASR track learned from the innertube player response', async () => {
    (window as Window & { ytcfg?: unknown }).ytcfg = {
      get: (key: string) => {
        if (key === 'INNERTUBE_API_KEY') return 'KEY';
        if (key === 'INNERTUBE_CONTEXT') return { client: { clientName: 'WEB', clientVersion: '2.0' } };
        return undefined;
      },
    };
    const fetchImpl = vi.fn(async () =>
      response(playerResponse('vid1', [{ languageCode: 'en', kind: 'asr' }])),
    );
    start(fetchImpl);

    produce('vid1');
    await vi.advanceTimersByTimeAsync(8000);
    await flush();

    expect(player.loadModule).toHaveBeenCalledWith('captions');
    await vi.advanceTimersByTimeAsync(300);
    expect(player.setOption).toHaveBeenCalledWith('captions', 'track', {
      languageCode: 'en',
      kind: 'asr',
    });
    await vi.advanceTimersByTimeAsync(3000 + SCREEN_TEXT_WINDOW_MS);
    expect(postedFailure()).toBe('nudge-failed');
  });
});
