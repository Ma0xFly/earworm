/**
 * Mock `chrome.runtime` background for the playground (T14).
 *
 * Implements the four content↔background messages the real content app sends
 * (`get-cached`, `translate-batch`, `commit`, `test-llm`, plus `clear-cache`)
 * with the fixture data. Nothing here talks to the network: translations are
 * fixture strings, the "LLM" is a pure function, and the cache is a `Map`
 * that persists for the lifetime of the page.
 *
 * Two demo behaviours are deliberate:
 * - `translate-failed` scene: the first translation batch fails, later ones
 *   succeed, so the sidebar's "全部重试" control has something to recover.
 * - `normal` scene: one fixture sentence (`FLAKY_SENTENCE_TEXT`) comes back
 *   without Chinese on its first attempt, demonstrating the per-sentence
 *   retry path. Retrying it succeeds.
 */

import type { CachedTranslation, LlmSentenceResult } from '../../src/lib/contracts';
import { sha256Hex } from '../../src/lib/hash';
import {
  isRuntimeRequest,
  type CommitResponse,
  type GetCachedResponse,
  type TestLlmResponse,
  type TranslateBatchRequest,
  type TranslateBatchResponse,
} from '../../src/lib/messages';
import {
  buildFixtureCachedTranslation,
  FIXTURE_CUES,
  FIXTURE_MODEL,
  FIXTURE_TRANSLATIONS,
  FLAKY_SENTENCE_TEXT,
} from '../fixture';
import type { SceneId } from '../scene';

export type MockStats = {
  /** `earworm:get-cached` calls. */
  getCached: number;
  /** `get-cached` responses with `hit: true`. */
  cacheHits: number;
  /** `earworm:translate-batch` calls. */
  translateBatches: number;
  /** `earworm:commit` calls. */
  commits: number;
  /** `earworm:test-llm` calls. */
  testLlm: number;
  /** Entries currently in the mock cache. */
  cacheEntries: number;
};

export type MockLatency = {
  getCachedMs: number;
  translateMs: number;
  commitMs: number;
};

export const DEFAULT_MOCK_LATENCY: MockLatency = {
  getCachedMs: 120,
  translateMs: 700,
  commitMs: 40,
};

export type MockBackendOptions = {
  /** Scene at the moment a request is served (read live, never cached). */
  getScene: () => SceneId;
  latency?: Partial<MockLatency>;
};

type StatsListener = (stats: MockStats) => void;

function cacheKey(videoId: string, cuesHash: string): string {
  return `${videoId}:${cuesHash}`;
}

function wait(ms: number): Promise<void> {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockBackend {
  private readonly getScene: () => SceneId;
  private readonly latency: MockLatency;
  private readonly cache = new Map<string, CachedTranslation>();
  private readonly attempts = new Map<string, number>();
  private readonly listeners = new Set<StatsListener>();

  private counters = {
    getCached: 0,
    cacheHits: 0,
    translateBatches: 0,
    commits: 0,
    testLlm: 0,
  };

  /** Reset per video session so the demo is deterministic on every switch. */
  private sessionVideoId: string | null = null;
  private sessionTranslateRequests = 0;

  constructor(options: MockBackendOptions) {
    this.getScene = options.getScene;
    this.latency = { ...DEFAULT_MOCK_LATENCY, ...options.latency };
  }

  snapshot(): MockStats {
    return { ...this.counters, cacheEntries: this.cache.size };
  }

  subscribe(listener: StatsListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Insert a cache entry directly (scene fixtures / debug tooling). */
  seedCache(videoId: string, cuesHash: string, data: CachedTranslation): void {
    this.cache.set(cacheKey(videoId, cuesHash), data);
    this.emit();
  }

  /** Prepopulate the fully-translated fixture entry for the cache-hit scene. */
  async seedFixtureCache(videoId: string): Promise<string> {
    const hash = await sha256Hex(FIXTURE_CUES.map((cue) => cue.text).join('\n'));
    this.cache.set(cacheKey(videoId, hash), buildFixtureCachedTranslation());
    this.emit();
    return hash;
  }

  /** Route one `chrome.runtime.sendMessage` request; never throws. */
  async handleMessage(message: unknown): Promise<unknown> {
    if (!isRuntimeRequest(message)) return undefined;

    switch (message.type) {
      case 'earworm:get-cached':
        return this.handleGetCached(message.videoId, message.cuesHash);
      case 'earworm:translate-batch':
        return this.handleTranslateBatch(message);
      case 'earworm:commit':
        return this.handleCommit(message.videoId, message.cuesHash, message.data);
      case 'earworm:test-llm':
        return this.handleTestLlm();
      case 'earworm:clear-cache':
        this.cache.clear();
        this.emit();
        return { ok: true } as const;
      default:
        return {
          ok: false,
          error: `mock background: unhandled message type`,
        };
    }
  }

  private emit(): void {
    const stats = this.snapshot();
    for (const listener of [...this.listeners]) {
      try {
        listener(stats);
      } catch {
        // A toolbar subscriber must not be able to break the mock bridge.
      }
    }
  }

  private resetSessionIfNeeded(videoId: string): void {
    if (this.sessionVideoId === videoId) return;
    this.sessionVideoId = videoId;
    this.sessionTranslateRequests = 0;
    this.attempts.clear();
  }

  private async handleGetCached(
    videoId: string,
    cuesHash: string,
  ): Promise<GetCachedResponse> {
    this.counters.getCached += 1;
    this.resetSessionIfNeeded(videoId);
    this.emit();

    await wait(this.latency.getCachedMs);

    const data = this.cache.get(cacheKey(videoId, cuesHash));
    if (!data) return { hit: false };
    this.counters.cacheHits += 1;
    this.emit();
    return { hit: true, data };
  }

  private async handleTranslateBatch(
    request: TranslateBatchRequest,
  ): Promise<TranslateBatchResponse> {
    this.counters.translateBatches += 1;
    this.sessionTranslateRequests += 1;
    const scene = this.getScene();
    const failThisBatch =
      scene === 'translate-failed' && this.sessionTranslateRequests === 1;
    this.emit();

    await wait(this.latency.translateMs);

    if (failThisBatch) {
      return {
        ok: false,
        error: 'mock: 翻译服务暂时不可用（再次请求会成功）',
      };
    }

    const results = request.batch.map((item) =>
      this.resultFor(item.i, item.text, scene),
    );
    return { ok: true, results, model: FIXTURE_MODEL };
  }

  private resultFor(i: number, text: string, scene: SceneId): LlmSentenceResult {
    const fixture = FIXTURE_TRANSLATIONS.get(text);
    if (!fixture) {
      // Unknown sentence: keep English, let the session mark it failed.
      return { i };
    }

    const attemptKey = `${this.sessionVideoId ?? 'unknown'}:${i}`;
    const attempt = (this.attempts.get(attemptKey) ?? 0) + 1;
    this.attempts.set(attemptKey, attempt);

    const failOnce =
      scene === 'normal' &&
      text === FLAKY_SENTENCE_TEXT &&
      attempt === 1;
    if (failOnce) return { i };

    return {
      i,
      zh: fixture.zh,
      cols: fixture.cols.map((collocation) =>
        collocation.note === undefined
          ? { text: collocation.text }
          : { text: collocation.text, note: collocation.note },
      ),
    };
  }

  private async handleCommit(
    videoId: string,
    cuesHash: string,
    data: CachedTranslation,
  ): Promise<CommitResponse> {
    this.counters.commits += 1;
    this.emit();
    await wait(this.latency.commitMs);
    this.cache.set(cacheKey(videoId, cuesHash), data);
    this.emit();
    return { ok: true };
  }

  private async handleTestLlm(): Promise<TestLlmResponse> {
    this.counters.testLlm += 1;
    this.emit();
    await wait(this.latency.getCachedMs);
    return { ok: true, sample: 'mock LLM: 这是离线 playground 的示例回复。' };
  }
}

export function createMockBackend(options: MockBackendOptions): MockBackend {
  return new MockBackend(options);
}
