/**
 * Standalone smoke checks for the playground mocks (T14).
 *
 * `pnpm test` only collects `tests/**` and `src/**`, and the playground owns
 * neither, so this script is run directly:
 *
 *     pnpm exec tsx playground/smoke.ts
 *
 * It verifies the invariants the demo relies on: the fixtures really merge into
 * the expected sentences (so translations line up), the mock background serves
 * every message the session sends (including the failure/retry and cache-hit
 * behaviours), the inject replies use the T3 envelope, and the fake playhead
 * behaves like a media element clock.
 */

import assert from 'node:assert/strict';
import { mergeCuesToSentences } from '../src/lib/cues/merge';
import type { CachedTranslation, LlmSentenceResult } from '../src/lib/contracts';
import type {
  CommitRequest,
  GetCachedRequest,
  RuntimeRequest,
  TestLlmRequest,
  TranslateBatchRequest,
} from '../src/lib/messages';
import { buildFixtureCachedTranslation, FIXTURE_CUES, FIXTURE_SENTENCE_TEXTS, FLAKY_SENTENCE_TEXT } from './fixture';
import { MockBackend } from './mock/background';
import { replyForScene } from './mock/inject';
import { MockPlayhead } from './mock/clock';
import { sceneById, sceneUrl } from './scene';

let checks = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      checks += 1;
      console.log(`ok ${checks} - ${name}`);
    })
    .catch((error: unknown) => {
      console.error(`not ok - ${name}`);
      throw error;
    });
}

const VIDEO_ID = 'ew-smoke-video';
const HASH = 'smoke-cues-hash';
const META = { videoId: VIDEO_ID, title: 'Smoke', channel: 'Earworm Dev' };

function translateRequest(
  indexes: readonly number[],
  batchIndex = 0,
  batchCount = 1,
): TranslateBatchRequest {
  return {
    type: 'earworm:translate-batch',
    videoId: VIDEO_ID,
    cuesHash: HASH,
    meta: META,
    batch: indexes.map((i) => ({
      i,
      text: FIXTURE_SENTENCE_TEXTS[i] ?? '',
      ...(i > 0 ? { prev: FIXTURE_SENTENCE_TEXTS[i - 1] ?? '' } : {}),
    })),
    batchIndex,
    batchCount,
  };
}

function getCachedRequest(cuesHash = HASH): GetCachedRequest {
  return { type: 'earworm:get-cached', videoId: VIDEO_ID, cuesHash };
}

async function verifyFixture(): Promise<void> {
  await check('fixture cues merge into the fixture sentences', () => {
    const merged = mergeCuesToSentences(FIXTURE_CUES);
    assert.equal(merged.length, FIXTURE_SENTENCE_TEXTS.length);
    assert.deepEqual(
      merged.map((sentence) => sentence.text),
      [...FIXTURE_SENTENCE_TEXTS],
    );
  });

  await check('fixture timing is positive and monotonic', () => {
    let previousEnd = Number.NEGATIVE_INFINITY;
    for (const cue of FIXTURE_CUES) {
      assert.ok(cue.end > cue.start, `cue has a positive duration: ${cue.text}`);
      assert.ok(cue.start >= previousEnd, 'cues do not overlap');
      previousEnd = cue.end;
    }
  });

  await check('every fixture collocation is a literal substring', () => {
    for (const sentence of FIXTURE_SENTENCES_WITH_COLS) {
      for (const collocation of sentence.cols) {
        assert.ok(
          sentence.text.toLowerCase().includes(collocation.text.toLowerCase()),
          `"${collocation.text}" occurs in "${sentence.text}"`,
        );
      }
    }
  });

  await check('the flaky sentence is one of the fixture sentences', () => {
    assert.ok(FIXTURE_SENTENCE_TEXTS.includes(FLAKY_SENTENCE_TEXT));
    assert.equal(FLAKY_SENTENCE_TEXT, FIXTURE_SENTENCE_TEXTS[6]);
  });

  await check('cached fixture payload is aligned with the sentences', () => {
    const data = buildFixtureCachedTranslation(123);
    assert.equal(data.zh.length, FIXTURE_SENTENCE_TEXTS.length);
    assert.equal(data.cols.length, FIXTURE_SENTENCE_TEXTS.length);
    assert.equal(data.ts, 123);
    assert.ok(data.zh.every((zh) => zh.trim().length > 0));
  });
}

// Built from the exported list so the substring check stays honest.
const FIXTURE_SENTENCES_WITH_COLS = FIXTURE_SENTENCE_TEXTS.map((text, index) => ({
  text,
  cols: buildFixtureCachedTranslation().cols[index] ?? [],
}));

async function verifyScenes(): Promise<void> {
  await check('scene ids round-trip and URLs carry the videoId', () => {
    const scene = sceneById('cache-hit');
    assert.equal(scene.id, 'cache-hit');
    const url = new URLSearchParams(sceneUrl(scene).slice(1));
    assert.equal(url.get('scene'), 'cache-hit');
    assert.equal(url.get('v'), scene.videoId);
    assert.equal(sceneById('does-not-exist').id, 'normal');
  });

  await check('inject replies distinguish no-captions from cue tracks', () => {
    const failed = replyForScene('no-captions', VIDEO_ID);
    assert.equal(failed.kind, 'failed');
    if (failed.kind === 'failed') {
      assert.equal(failed.payload.reason, 'no-captions');
    }

    for (const scene of ['normal', 'translate-failed', 'cache-hit'] as const) {
      const ready = replyForScene(scene, VIDEO_ID);
      assert.equal(ready.kind, 'ready');
      if (ready.kind === 'ready') {
        assert.equal(ready.payload.kind, 'manual');
        assert.equal(ready.payload.videoId, VIDEO_ID);
        assert.equal(ready.payload.cues.length, FIXTURE_CUES.length);
      }
    }
  });
}

async function verifyPlayhead(): Promise<void> {
  await check('playhead advances only while playing', () => {
    const playhead = new MockPlayhead(5);
    assert.equal(playhead.paused, true);
    assert.equal(playhead.advance(1000), null);
    assert.equal(playhead.time, 0);

    assert.equal(playhead.play(), true);
    assert.equal(playhead.play(), false);
    assert.equal(playhead.advance(10_000), null); // first frame baselines
    assert.equal(playhead.advance(11_000), 'time');
    assert.equal(playhead.time, 1);
    assert.equal(playhead.pause(), true);
    assert.equal(playhead.advance(12_000), null);
    assert.equal(playhead.time, 1);
  });

  await check('playhead seek clamps, re-baselines and clears ended', () => {
    const playhead = new MockPlayhead(5);
    assert.equal(playhead.seek(-3), false); // already at 0
    assert.equal(playhead.play(), true);
    playhead.advance(0);
    playhead.advance(5000);
    assert.equal(playhead.time, 5);
    assert.equal(playhead.ended, true);
    assert.equal(playhead.paused, true);

    assert.equal(playhead.seek(2), true);
    assert.equal(playhead.time, 2);
    assert.equal(playhead.ended, false);
    assert.equal(playhead.seek(99), true);
    assert.equal(playhead.time, 5);
  });
}

async function verifyBackend(): Promise<void> {
  await check('get-cached misses an unknown key', async () => {
    const backend = new MockBackend({ getScene: () => 'normal', latency: { getCachedMs: 0, translateMs: 0, commitMs: 0 } });
    const response = (await backend.handleMessage(getCachedRequest())) as { hit: boolean };
    assert.equal(response.hit, false);
    assert.equal(backend.snapshot().getCached, 1);
    assert.equal(backend.snapshot().cacheHits, 0);
  });

  await check('normal scene fails the flaky sentence once, then succeeds on retry', async () => {
    const backend = new MockBackend({ getScene: () => 'normal', latency: { getCachedMs: 0, translateMs: 0, commitMs: 0 } });
    await backend.handleMessage(getCachedRequest());

    const indexes = FIXTURE_SENTENCE_TEXTS.map((_, index) => index);
    const first = (await backend.handleMessage(translateRequest(indexes))) as {
      ok: boolean;
      results?: LlmSentenceResult[];
    };
    assert.equal(first.ok, true);
    assert.equal(first.results?.length, indexes.length);

    const flakyIndex = FIXTURE_SENTENCE_TEXTS.indexOf(FLAKY_SENTENCE_TEXT);
    const flaky = first.results?.find((result) => result.i === flakyIndex);
    assert.ok(flaky);
    assert.equal(flaky?.zh, undefined);
    assert.equal(first.results?.filter((result) => result.zh).length, indexes.length - 1);

    const retry = (await backend.handleMessage(translateRequest([flakyIndex]))) as {
      ok: boolean;
      results?: LlmSentenceResult[];
    };
    assert.equal(retry.ok, true);
    assert.ok(retry.results?.[0]?.zh);
    assert.equal(retry.results?.[0]?.i, flakyIndex);
  });

  await check('translate-failed scene fails the first batch and recovers', async () => {
    let scene: 'translate-failed' | 'normal' = 'translate-failed';
    const backend = new MockBackend({ getScene: () => scene, latency: { getCachedMs: 0, translateMs: 0, commitMs: 0 } });
    await backend.handleMessage(getCachedRequest());

    const first = (await backend.handleMessage(translateRequest([0, 1]))) as { ok: boolean };
    assert.equal(first.ok, false);

    scene = 'normal';
    const second = (await backend.handleMessage(translateRequest([0, 1]))) as { ok: boolean };
    assert.equal(second.ok, true);
  });

  await check('cache-hit scene serves the seeded payload without translating', async () => {
    const backend = new MockBackend({ getScene: () => 'cache-hit', latency: { getCachedMs: 0, translateMs: 0, commitMs: 0 } });
    const hash = await backend.seedFixtureCache(VIDEO_ID);
    const response = (await backend.handleMessage(getCachedRequest(hash))) as {
      hit: boolean;
      data?: CachedTranslation;
    };
    assert.equal(response.hit, true);
    assert.equal(response.data?.zh.length, FIXTURE_SENTENCE_TEXTS.length);
    assert.equal(backend.snapshot().cacheHits, 1);
    assert.equal(backend.snapshot().translateBatches, 0);
  });

  await check('commit stores a payload that a later get-cached hits', async () => {
    const backend = new MockBackend({ getScene: () => 'normal', latency: { getCachedMs: 0, translateMs: 0, commitMs: 0 } });
    const data = buildFixtureCachedTranslation();
    const commit: CommitRequest = {
      type: 'earworm:commit',
      videoId: VIDEO_ID,
      cuesHash: HASH,
      data,
    };
    const commitResponse = (await backend.handleMessage(commit)) as { ok: boolean };
    assert.equal(commitResponse.ok, true);

    const hit = (await backend.handleMessage(getCachedRequest())) as { hit: boolean };
    assert.equal(hit.hit, true);
    assert.equal(backend.snapshot().commits, 1);
  });

  await check('test-llm and unknown messages are handled safely', async () => {
    const backend = new MockBackend({ getScene: () => 'normal', latency: { getCachedMs: 0, translateMs: 0, commitMs: 0 } });
    const testLlm: TestLlmRequest = {
      type: 'earworm:test-llm',
      llm: { baseUrl: 'http://127.0.0.1:3425/v1', apiKey: '', model: 'group/free-ds' },
    };
    const response = (await backend.handleMessage(testLlm)) as { ok: boolean; sample?: string };
    assert.equal(response.ok, true);
    assert.ok(response.sample);

    assert.equal(await backend.handleMessage({ type: 'not-earworm' }), undefined);
    assert.equal(await backend.handleMessage(null), undefined);
  });
}

async function verifyStatsSubscription(): Promise<void> {
  await check('stats subscribers observe cache hits and commits', async () => {
    const backend = new MockBackend({ getScene: () => 'cache-hit', latency: { getCachedMs: 0, translateMs: 0, commitMs: 0 } });
    const hash = await backend.seedFixtureCache(VIDEO_ID);
    const snapshots: string[] = [];
    const unsubscribe = backend.subscribe((stats) => {
      snapshots.push(`${stats.cacheHits}/${stats.getCached}/${stats.translateBatches}`);
    });
    await backend.handleMessage(getCachedRequest(hash));
    unsubscribe();
    assert.ok(snapshots.length >= 2);
    assert.equal(snapshots.at(-1), '1/1/0');
  });
}

async function main(): Promise<void> {
  await verifyFixture();
  await verifyScenes();
  await verifyPlayhead();
  await verifyBackend();
  await verifyStatsSubscription();
  console.log(`\nplayground smoke: ${checks} checks passed`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
