import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CueTrack } from '@/lib/contracts';
import type { InjectEnvelope } from '@/lib/messages';
import { INJECT_MESSAGE } from '@/lib/messages';
import { startTranscriptClient } from '@/lib/transcript/client';

type Posted = { data: InjectEnvelope; targetOrigin: string };

function setVideo(videoId: string): void {
  window.history.replaceState({}, '', videoId ? `/watch?v=${videoId}` : '/');
}

function validCues(videoId: string, kind: 'manual' | 'asr' = 'manual'): InjectEnvelope {
  return {
    __earworm: true,
    dir: 'inject-to-content',
    type: INJECT_MESSAGE.cuesReady,
    payload: {
      videoId,
      lang: 'en',
      kind,
      cues: [{ start: 0, end: 2, text: 'Hello' }],
    },
  };
}

function failed(videoId: string): InjectEnvelope {
  return {
    __earworm: true,
    dir: 'inject-to-content',
    type: INJECT_MESSAGE.cuesFailed,
    payload: { videoId, reason: 'no-captions' },
  };
}

function dispatchMessage(data: unknown, source: MessageEventSource | null = window): void {
  window.dispatchEvent(new MessageEvent('message', { data, source }));
}

function dispatchNav(): void {
  window.dispatchEvent(new Event('yt-navigate-finish'));
}

describe('startTranscriptClient', () => {
  let postMessage: ReturnType<typeof vi.spyOn>;
  let active: Array<() => void>;

  beforeEach(() => {
    setVideo('vid1');
    active = [];
    postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const stop of active.splice(0)) stop();
    postMessage.mockRestore();
    setVideo('');
  });

  function start(handlers: Parameters<typeof startTranscriptClient>[0]): () => void {
    const stop = startTranscriptClient(handlers);
    active.push(stop);
    return stop;
  }

  function posted(): Posted[] {
    return postMessage.mock.calls.map((call: unknown[]) => ({
      data: call[0] as InjectEnvelope,
      targetOrigin: String(call[1]),
    }));
  }

  it('asks the inject script to produce cues for the current video on start', () => {
    start({ onTrack: vi.fn(), onFailure: vi.fn() });

    const envelopes = posted();
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.targetOrigin).toBe('*');
    expect(envelopes[0]?.data).toEqual({
      __earworm: true,
      dir: 'content-to-inject',
      type: INJECT_MESSAGE.produce,
      payload: { videoId: 'vid1' },
    });
  });

  it('does not post on a non-video page', () => {
    setVideo('');
    start({ onTrack: vi.fn(), onFailure: vi.fn() });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('delivers a validated manual cue track', () => {
    const onTrack = vi.fn<(track: CueTrack) => void>();
    start({ onTrack, onFailure: vi.fn() });

    dispatchMessage(validCues('vid1'));

    expect(onTrack).toHaveBeenCalledTimes(1);
    expect(onTrack).toHaveBeenCalledWith({
      videoId: 'vid1',
      lang: 'en',
      kind: 'manual',
      cues: [{ start: 0, end: 2, text: 'Hello' }],
    });
  });

  it('delivers a validated automatic (ASR) cue track', () => {
    const onTrack = vi.fn<(track: CueTrack) => void>();
    start({ onTrack, onFailure: vi.fn() });

    dispatchMessage(validCues('vid1', 'asr'));

    expect(onTrack).toHaveBeenCalledWith({
      videoId: 'vid1',
      lang: 'en',
      kind: 'asr',
      cues: [{ start: 0, end: 2, text: 'Hello' }],
    });
  });

  it('delivers a validated failure reason', () => {
    const onFailure = vi.fn();
    start({ onTrack: vi.fn(), onFailure });

    dispatchMessage(failed('vid1'));

    expect(onFailure).toHaveBeenCalledWith('vid1', 'no-captions');
  });

  it('ignores malformed, foreign and other-video messages', () => {
    const onTrack = vi.fn();
    const onFailure = vi.fn();
    start({ onTrack, onFailure });

    dispatchMessage(validCues('vid1'), null);
    dispatchMessage({ ...validCues('vid1'), __earworm: false });
    dispatchMessage(validCues('vid2'));
    dispatchMessage({ source: 'ytds-inject', type: 'cues' });
    dispatchMessage({ ...validCues('vid1'), type: 'earworm:other' });

    expect(onTrack).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('resets on yt-navigate-finish and re-produces for the new videoId', () => {
    const onTrack = vi.fn();
    start({ onTrack, onFailure: vi.fn() });
    expect(posted()).toHaveLength(1);

    setVideo('vid2');
    dispatchNav();

    const envelopes = posted();
    expect(envelopes).toHaveLength(2);
    expect(envelopes[1]?.data).toEqual({
      __earworm: true,
      dir: 'content-to-inject',
      type: INJECT_MESSAGE.produce,
      payload: { videoId: 'vid2', force: true },
    });

    // The previous video's late reply is stale and must not reach the app.
    dispatchMessage(validCues('vid1'));
    expect(onTrack).not.toHaveBeenCalled();

    dispatchMessage(validCues('vid2'));
    expect(onTrack).toHaveBeenCalledTimes(1);
    expect(onTrack.mock.calls[0]?.[0]).toMatchObject({ videoId: 'vid2' });
  });

  it('tears down every listener cleanly', () => {
    const onTrack = vi.fn();
    const stop = start({ onTrack, onFailure: vi.fn() });
    expect(posted()).toHaveLength(1);

    stop();
    setVideo('vid2');
    dispatchNav();
    dispatchMessage(validCues('vid2'));

    expect(posted()).toHaveLength(1);
    expect(onTrack).not.toHaveBeenCalled();
  });
});
