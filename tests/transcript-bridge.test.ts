import { describe, expect, it, vi } from 'vitest';
import {
  parseContentEvent,
  parseInjectEvent,
  postCuesFailed,
  postCuesReady,
  requestProduce,
} from '@/lib/transcript/bridge';
import {
  createInjectEnvelope,
  INJECT_MESSAGE,
  type CuesFailedPayload,
  type CuesReadyPayload,
  type ProducePayload,
} from '@/lib/messages';

const cuesReady: CuesReadyPayload = {
  videoId: 'vid1',
  lang: 'en',
  kind: 'manual',
  cues: [{ start: 0, end: 2, text: 'Hello' }],
};

const cuesFailed: CuesFailedPayload = { videoId: 'vid1', reason: 'no-captions' };
const produce: ProducePayload = { videoId: 'vid1' };

function messageEvent(data: unknown, source: MessageEventSource | null = window): MessageEvent {
  return new MessageEvent('message', { data, source });
}

describe('bridge post helpers', () => {
  it('posts a cues-ready envelope in the inject-to-content direction', () => {
    const target = { postMessage: vi.fn() } as unknown as Window;
    postCuesReady(cuesReady, target);
    expect(target.postMessage).toHaveBeenCalledWith(
      {
        __earworm: true,
        dir: 'inject-to-content',
        type: INJECT_MESSAGE.cuesReady,
        payload: cuesReady,
      },
      '*',
    );
  });

  it('posts a cues-failed envelope and a produce envelope', () => {
    const target = { postMessage: vi.fn() } as unknown as Window;
    postCuesFailed(cuesFailed, target);
    requestProduce(produce, target);
    expect(target.postMessage).toHaveBeenNthCalledWith(
      1,
      {
        __earworm: true,
        dir: 'inject-to-content',
        type: INJECT_MESSAGE.cuesFailed,
        payload: cuesFailed,
      },
      '*',
    );
    expect(target.postMessage).toHaveBeenNthCalledWith(
      2,
      {
        __earworm: true,
        dir: 'content-to-inject',
        type: INJECT_MESSAGE.produce,
        payload: produce,
      },
      '*',
    );
  });
});

describe('parseInjectEvent (content side)', () => {
  it('accepts a valid cues-ready event from this window', () => {
    const parsed = parseInjectEvent(
      messageEvent(createInjectEnvelope('inject-to-content', INJECT_MESSAGE.cuesReady, cuesReady)),
    );
    expect(parsed?.type).toBe(INJECT_MESSAGE.cuesReady);
    expect(parsed?.payload).toEqual(cuesReady);
  });

  it('accepts a valid cues-failed event', () => {
    const parsed = parseInjectEvent(
      messageEvent(createInjectEnvelope('inject-to-content', INJECT_MESSAGE.cuesFailed, cuesFailed)),
    );
    expect(parsed?.type).toBe(INJECT_MESSAGE.cuesFailed);
  });

  it('rejects events from another window, foreign markers and wrong directions', () => {
    const valid = createInjectEnvelope('inject-to-content', INJECT_MESSAGE.cuesReady, cuesReady);
    expect(parseInjectEvent(messageEvent(valid, null))).toBeNull();
    expect(parseInjectEvent(messageEvent({ ...valid, __earworm: false }))).toBeNull();
    expect(parseInjectEvent(messageEvent({ ...valid, dir: 'content-to-inject' }))).toBeNull();
    expect(parseInjectEvent(messageEvent({ source: 'ytds-inject', type: 'cues' }))).toBeNull();
    expect(parseInjectEvent(messageEvent(null))).toBeNull();
  });

  it('rejects known types with malformed payloads', () => {
    expect(
      parseInjectEvent(
        messageEvent(
          createInjectEnvelope('inject-to-content', INJECT_MESSAGE.cuesReady, {
            ...cuesReady,
            cues: [{ start: 0, end: 1, text: 42 }],
          }),
        ),
      ),
    ).toBeNull();
    expect(
      parseInjectEvent(
        messageEvent(
          createInjectEnvelope('inject-to-content', INJECT_MESSAGE.cuesFailed, {
            videoId: 'vid1',
            reason: 'rate-limited',
          }),
        ),
      ),
    ).toBeNull();
  });

  it('drops messages for another videoId when a current id is given', () => {
    const event = messageEvent(
      createInjectEnvelope('inject-to-content', INJECT_MESSAGE.cuesReady, cuesReady),
    );
    expect(parseInjectEvent(event, { videoId: 'vid1' })).not.toBeNull();
    expect(parseInjectEvent(event, { videoId: 'vid2' })).toBeNull();
  });

  it('rejects unknown earworm message types', () => {
    expect(
      parseInjectEvent(
        messageEvent(createInjectEnvelope('inject-to-content', 'earworm:other', cuesReady)),
      ),
    ).toBeNull();
  });
});

describe('parseContentEvent (inject side)', () => {
  it('accepts a valid produce event from this window', () => {
    const parsed = parseContentEvent(
      messageEvent(createInjectEnvelope('content-to-inject', INJECT_MESSAGE.produce, produce)),
    );
    expect(parsed?.type).toBe(INJECT_MESSAGE.produce);
    expect(parsed?.payload).toEqual(produce);
  });

  it('rejects the inject-to-content direction, bad payloads and other videoIds', () => {
    const envelope = createInjectEnvelope('content-to-inject', INJECT_MESSAGE.produce, produce);
    expect(
      parseContentEvent(
        messageEvent(
          createInjectEnvelope('inject-to-content', INJECT_MESSAGE.produce, produce),
        ),
      ),
    ).toBeNull();
    expect(
      parseContentEvent(
        messageEvent(createInjectEnvelope('content-to-inject', INJECT_MESSAGE.produce, {})),
      ),
    ).toBeNull();
    expect(parseContentEvent(messageEvent(envelope), { videoId: 'vid2' })).toBeNull();
    expect(parseContentEvent(messageEvent(envelope), { videoId: 'vid1' })).not.toBeNull();
  });
});
