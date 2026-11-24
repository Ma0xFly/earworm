/**
 * Session engine: cue acquisition → sentences → offline spans → translation →
 * cache → playback/current-sentence state.
 *
 * The provider is a thin React wrapper; this hook owns the orchestration. All
 * asynchronous work is tied to one `ActiveSession` object: a SPA navigation
 * replaces `activeRef`, so late cache/translation replies and commits for the
 * previous video are dropped instead of leaking into the next session.
 *
 * Failure policy (spec §5): captions/LLM failures never block playback. An
 * acquisition failure surfaces as `no-captions`/`error`; a translation failure
 * keeps the English sentence, marks it `failed`, and exposes retries. Only a
 * fully successful run is committed to the cache.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CachedTranslation,
  CollocationSpan,
  Cue,
  CueTrack,
  LearningSentence,
  Sentence,
  Settings,
  VideoMeta,
} from '@/lib/contracts';
import { chunkBatchItems, DEFAULT_BATCH_SIZE } from '@/lib/llm/batch';
import { computeOfflineSpans, loadCollocationTable, unionSpans } from '@/lib/collocations';
import { mergeCuesToSentences } from '@/lib/cues/merge';
import { preloadDictionary } from '@/lib/dict';
import { sha256Hex } from '@/lib/hash';
import {
  sendRuntimeMessage,
  type GetCachedResponse,
  type TranslateBatchItem,
  type TranslateBatchResponse,
} from '@/lib/messages';
import {
  startTranscriptClient,
  videoIdFromLocation,
  type TranscriptFailureReason,
} from '@/lib/transcript';
import { playerController } from '@/features/playback';
import type { SettingsPatch } from '@/lib/settings';
import { readVideoMeta } from './meta';
import {
  applyCachedSentence,
  applyLlmResult,
  buildBatchItems,
  cachedTranslationFrom,
  createInitialState,
  currentSentenceIndex,
  isFullyTranslated,
  progressOf,
  runPool,
  sameSpans,
  toLearningSentences,
} from './pipeline';
import type { SessionApi, SessionState, SessionStatus } from './types';

/** Two translation requests in flight keeps the endpoint busy but polite. */
export const TRANSLATION_CONCURRENCY = 2;

type ActiveSession = {
  videoId: string;
  meta: VideoMeta;
  /** SHA-256 of the cue texts; empty when WebCrypto failed (no caching). */
  cuesHash: string;
  cacheable: boolean;
  sentences: LearningSentence[];
  /** Full offline span set per sentence; LLM union always starts from this. */
  offline: CollocationSpan[][];
  model: string;
  committed: boolean;
  /** Sentence indexes with a single-sentence retry in flight. */
  retrying: Set<number>;
  retryingAll: boolean;
};

export type SessionEngineOptions = {
  settings: Settings;
  setSettings: (patch: SettingsPatch) => void;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}

/** Offline spans, never fatal: a highlight failure must not lose the track. */
function offlineSpansOf(sentence: Sentence): CollocationSpan[] {
  try {
    return computeOfflineSpans(sentence);
  } catch (error) {
    console.warn('[earworm] offline collocation spans failed:', error);
    return [];
  }
}

function pendingIndexes(sentences: readonly LearningSentence[]): number[] {
  return sentences.flatMap((sentence, index) => (sentence.status === 'failed' ? [index] : []));
}

export function useSessionEngine(options: SessionEngineOptions): SessionApi {
  const [state, setState] = useState<SessionState>(() =>
    createInitialState(videoIdFromLocation() || null),
  );
  const stateRef = useRef<SessionState>(state);
  const activeRef = useRef<ActiveSession | null>(null);

  const settingsRef = useRef(options.settings);
  settingsRef.current = options.settings;
  const setSettingsRef = useRef(options.setSettings);
  setSettingsRef.current = options.setSettings;

  /** Commit a state update and keep the synchronous mirror used by async work. */
  const commitState = useCallback(
    (update: (previous: SessionState) => SessionState): void => {
      const next = update(stateRef.current);
      stateRef.current = next;
      setState(next);
    },
    [],
  );

  const commitProgress = useCallback(
    (active: ActiveSession): void => {
      const { done, failed, pending } = progressOf(active.sentences);
      const busy = active.retrying.size > 0 || active.retryingAll;
      const translationState =
        busy || pending > 0 ? 'running' : failed > 0 ? 'partial' : 'done';
      commitState((previous) => ({
        ...previous,
        sentences: active.sentences,
        translation: {
          state: translationState,
          done,
          total: active.sentences.length,
          failed,
        },
      }));
    },
    [commitState],
  );

  const commitSentences = useCallback(
    (active: ActiveSession, sentences: LearningSentence[]): void => {
      active.sentences = sentences;
      commitProgress(active);
    },
    [commitProgress],
  );

  /** Send one translate-batch request; request failures degrade to `ok:false`. */
  const requestTranslate = useCallback(
    async (
      active: ActiveSession,
      batch: readonly TranslateBatchItem[],
      batchIndex: number,
      batchCount: number,
    ): Promise<TranslateBatchResponse> => {
      try {
        const response = await sendRuntimeMessage<TranslateBatchResponse | undefined>({
          type: 'earworm:translate-batch',
          videoId: active.videoId,
          cuesHash: active.cuesHash,
          meta: active.meta,
          batch: [...batch],
          batchIndex,
          batchCount,
        });
        if (!response || typeof response !== 'object') {
          return { ok: false, error: 'no response from background worker' };
        }
        return response;
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
    [],
  );

  /** Merge one batch response into the active sentences, per sentence. */
  const applyBatch = useCallback(
    (
      active: ActiveSession,
      batch: readonly TranslateBatchItem[],
      response: TranslateBatchResponse,
    ): void => {
      const byIndex = new Map<number, { i: number; zh?: string; cols?: { text: string; note?: string }[] }>();
      if (response.ok && Array.isArray(response.results)) {
        for (const result of response.results) {
          if (result && typeof result.i === 'number') byIndex.set(result.i, result);
        }
        if (typeof response.model === 'string' && response.model.length > 0) {
          active.model = response.model;
        }
      }

      const next = active.sentences.slice();
      for (const item of batch) {
        const index = item.i;
        if (!Number.isInteger(index) || index < 0 || index >= next.length) continue;
        const sentence = next[index]!;
        const result = byIndex.get(index);
        if (response.ok && result) {
          next[index] = applyLlmResult(active.offline[index] ?? [], sentence, result);
        } else if (sentence.status !== 'done') {
          // Batch-level failure (or a sentence missing from a partial answer):
          // keep the English + offline spans, mark just these sentences failed.
          next[index] = { ...sentence, status: 'failed' };
        }
      }

      commitSentences(active, next);
    },
    [commitSentences],
  );

  const commitIfComplete = useCallback(async (active: ActiveSession): Promise<void> => {
    if (!active.cacheable || active.committed) return;
    if (!isFullyTranslated(active.sentences)) return;

    active.committed = true;
    const data: CachedTranslation = cachedTranslationFrom(
      active.sentences,
      active.model.length > 0 ? active.model : 'unknown',
      Date.now(),
    );
    try {
      await sendRuntimeMessage({
        type: 'earworm:commit',
        videoId: active.videoId,
        cuesHash: active.cuesHash,
        data,
      });
    } catch {
      // A cache write must never block the learning session.
    }
  }, []);

  const finishRun = useCallback(
    (active: ActiveSession): void => {
      commitProgress(active);
      if (isFullyTranslated(active.sentences)) void commitIfComplete(active);
    },
    [commitIfComplete, commitProgress],
  );

  /** Translate the given global sentence indexes in 40-sentence batches, ×2. */
  const translateIndexes = useCallback(
    async (active: ActiveSession, indexes: readonly number[]): Promise<void> => {
      if (indexes.length === 0) return;
      const items = buildBatchItems(active.sentences, indexes);
      const batches = chunkBatchItems(items, DEFAULT_BATCH_SIZE);

      await runPool(
        batches.map((batch, batchIndex) => async () => {
          // A SPA navigation while earlier batches were in flight must not
          // start new requests for the previous video.
          if (activeRef.current !== active) return;
          const response = await requestTranslate(active, batch, batchIndex, batches.length);
          if (activeRef.current !== active) return;
          applyBatch(active, batch, response);
        }),
        TRANSLATION_CONCURRENCY,
      );
    },
    [applyBatch, requestTranslate],
  );

  const applyCache = useCallback(
    (active: ActiveSession, data: CachedTranslation): void => {
      let next = active.sentences.map((sentence, index) =>
        applyCachedSentence(active.offline[index] ?? [], sentence, data.zh[index], data.cols[index]),
      );
      // A structurally valid cache entry still may not cover every sentence
      // (video edited between sessions): fail the uncovered rows instead of
      // leaving the session stuck in "running" with no requests in flight.
      if (next.some((sentence) => sentence.status === 'pending')) {
        next = next.map((sentence) =>
          sentence.status === 'pending' ? { ...sentence, status: 'failed' as const } : sentence,
        );
      }
      commitSentences(active, next);
    },
    [commitSentences],
  );

  /** Hash the raw cues, consult the cache, then either apply or translate. */
  const runPipeline = useCallback(
    async (active: ActiveSession, cues: readonly Cue[]): Promise<void> => {
      let cuesHash = '';
      try {
        cuesHash = await sha256Hex(cues.map((cue) => cue.text).join('\n'));
      } catch (error) {
        console.warn('[earworm] cues hash unavailable, translation will not be cached:', error);
      }
      if (activeRef.current !== active) return;

      active.cuesHash = cuesHash;
      active.cacheable = cuesHash.length > 0;

      if (active.cacheable) {
        let cached: GetCachedResponse | null = null;
        try {
          cached = await sendRuntimeMessage<GetCachedResponse>({
            type: 'earworm:get-cached',
            videoId: active.videoId,
            cuesHash,
          });
        } catch {
          cached = null;
        }
        if (activeRef.current !== active) return;
        if (
          cached &&
          cached.hit === true &&
          Array.isArray(cached.data?.zh) &&
          Array.isArray(cached.data?.cols)
        ) {
          applyCache(active, cached.data);
          return;
        }
      }

      await translateIndexes(
        active,
        active.sentences.map((_, index) => index),
      );
      if (activeRef.current !== active) return;
      finishRun(active);
    },
    [applyCache, finishRun, translateIndexes],
  );

  const handleTrack = useCallback(
    (track: CueTrack): void => {
      const videoId = videoIdFromLocation();
      // The transcript client already filters stale ids; this guards races and
      // turns a duplicate cues-ready for the active video into a no-op.
      if (track.videoId !== videoId) return;
      if (activeRef.current?.videoId === videoId) return;

      const merged = mergeCuesToSentences(track.cues);
      const meta = readVideoMeta(track.videoId);

      // A manual-English track always carries cues; defensively treat an
      // empty payload like "no captions" rather than a ready empty session.
      if (merged.length === 0) {
        activeRef.current = null;
        const status: SessionStatus = 'no-captions';
        commitState(() => ({ ...createInitialState(track.videoId), status, meta }));
        return;
      }

      const offline = merged.map((sentence) => offlineSpansOf(sentence));
      const sentences = toLearningSentences(merged, offline);
      const active: ActiveSession = {
        videoId: track.videoId,
        meta,
        cuesHash: '',
        cacheable: false,
        sentences,
        offline,
        model: '',
        committed: false,
        retrying: new Set(),
        retryingAll: false,
      };
      activeRef.current = active;

      commitState((previous) => ({
        ...previous,
        videoId: track.videoId,
        meta,
        status: 'ready',
        sentences,
        currentIndex: currentSentenceIndex(sentences, playerController.getTime()),
        translation: {
          state: 'running',
          done: 0,
          total: sentences.length,
          failed: 0,
        },
      }));

      void runPipeline(active, track.cues).catch((error: unknown) => {
        console.warn('[earworm] session pipeline failed:', error);
      });
    },
    [commitState, runPipeline],
  );

  const handleFailure = useCallback(
    (videoId: string, reason: TranscriptFailureReason): void => {
      if (videoId !== videoIdFromLocation()) return;
      // A produced track wins over a late failure for the same video.
      if (activeRef.current?.videoId === videoId) return;
      const current = stateRef.current;
      if (
        current.videoId === videoId &&
        (current.status === 'no-captions' || current.status === 'error')
      ) {
        return;
      }

      const meta = readVideoMeta(videoId);
      const failed = reason !== 'no-captions' && reason !== 'asr-only';
      const status: SessionStatus = failed ? 'error' : 'no-captions';
      commitState(() => ({
        ...createInitialState(videoId),
        status,
        meta,
        ...(failed ? { error: reason } : {}),
      }));
    },
    [commitState],
  );

  const retrySentence = useCallback(
    (id: number): void => {
      const active = activeRef.current;
      if (!active) return;
      const index = active.sentences.findIndex((sentence) => sentence.id === id);
      if (index < 0) return;
      const sentence = active.sentences[index]!;
      if (sentence.status !== 'failed' || active.retrying.has(index) || active.retryingAll) return;

      active.retrying.add(index);
      commitState((previous) => ({
        ...previous,
        translation: { ...previous.translation, state: 'running' },
      }));

      void (async () => {
        const items = buildBatchItems(active.sentences, [index]);
        const response = await requestTranslate(active, items, 0, 1);
        active.retrying.delete(index);
        if (activeRef.current !== active) return;
        applyBatch(active, items, response);
        finishRun(active);
      })().catch(() => {
        active.retrying.delete(index);
        if (activeRef.current === active) commitProgress(active);
      });
    },
    [applyBatch, commitState, finishRun, requestTranslate],
  );

  const retryAll = useCallback((): void => {
    const active = activeRef.current;
    if (!active || active.retryingAll) return;
    const indexes = pendingIndexes(active.sentences);
    if (indexes.length === 0) return;

    active.retryingAll = true;
    commitState((previous) => ({
      ...previous,
      translation: { ...previous.translation, state: 'running' },
    }));

    void (async () => {
      await translateIndexes(active, indexes);
      active.retryingAll = false;
      if (activeRef.current !== active) return;
      finishRun(active);
    })().catch(() => {
      active.retryingAll = false;
      if (activeRef.current === active) commitProgress(active);
    });
  }, [commitState, finishRun, translateIndexes]);

  const seekToSentence = useCallback(
    (id: number): void => {
      const sentences = stateRef.current.sentences;
      if (sentences.length === 0) return;
      const index = sentences.findIndex((sentence) => sentence.id === id);
      if (index < 0) return;
      const sentence = sentences[index]!;

      playerController.playRange(sentence.start, sentence.end, {
        pauseAtEnd: !settingsRef.current.playback.continuous,
      });
      if (stateRef.current.currentIndex !== index) {
        commitState((previous) => ({ ...previous, currentIndex: index }));
      }
    },
    [commitState],
  );

  const setContinuous = useCallback((value: boolean): void => {
    setSettingsRef.current({ playback: { continuous: value } });
  }, []);

  const toggleSidebar = useCallback((): void => {
    // T9 reads/writes the same setting directly, so this must flip the live
    // settings value instead of keeping a second local boolean.
    setSettingsRef.current({ ui: { sidebar: !settingsRef.current.ui.sidebar } });
  }, []);

  /* ------------------------------------------------------------------------ */
  /* lifecycle effects                                                         */
  /* ------------------------------------------------------------------------ */

  const handleTrackRef = useRef(handleTrack);
  handleTrackRef.current = handleTrack;
  const handleFailureRef = useRef(handleFailure);
  handleFailureRef.current = handleFailure;

  useEffect(() => {
    const stop = startTranscriptClient({
      onTrack: (track) => handleTrackRef.current(track),
      onFailure: (videoId, reason) => handleFailureRef.current(videoId, reason),
    });
    return () => {
      stop();
      // Drop any in-flight reply/commit for the torn-down session.
      activeRef.current = null;
    };
  }, []);

  // SPA navigation: reset before the new track arrives and let the transcript
  // client re-produce for the new video. Same-video events (YouTube emits some
  // for in-page updates) keep the live session.
  useEffect(() => {
    const onNavigate = (): void => {
      const nextVideoId = videoIdFromLocation();
      if (nextVideoId === stateRef.current.videoId) return;
      activeRef.current = null;
      commitState(() => createInitialState(nextVideoId || null));
    };
    window.addEventListener('yt-navigate-finish', onNavigate, true);
    return () => window.removeEventListener('yt-navigate-finish', onNavigate, true);
  }, [commitState]);

  // Follow the player clock; the last started sentence wins in a gap.
  useEffect(
    () =>
      playerController.subscribe((time) => {
        const sentences = stateRef.current.sentences;
        if (sentences.length === 0) return;
        const nextIndex = currentSentenceIndex(sentences, time);
        if (nextIndex === stateRef.current.currentIndex) return;
        commitState((previous) =>
          previous.currentIndex === nextIndex ? previous : { ...previous, currentIndex: nextIndex },
        );
      }),
    [commitState],
  );

  // Warm the offline assets without blocking first paint. Once they arrive,
  // recompute spans for an already-ready session: with a slow asset fetch the
  // cues can win the race, and F5 requires offline highlights at load time.
  useEffect(() => {
    let disposed = false;

    const recomputeOffline = (): void => {
      if (disposed) return;
      const active = activeRef.current;
      if (!active) return;

      const offline = active.sentences.map((sentence) => offlineSpansOf(sentence));
      const changed = offline.some(
        (spans, index) => !sameSpans(spans, active.offline[index] ?? []),
      );
      if (!changed) return;

      const next = active.sentences.map((sentence, index) => ({
        ...sentence,
        cols: unionSpans(
          offline[index] ?? [],
          sentence.cols.filter((span) => span.source === 'llm'),
        ),
      }));
      active.offline = offline;
      commitSentences(active, next);
    };

    void preloadDictionary().then(recomputeOffline, () => {});
    void loadCollocationTable().then(recomputeOffline, () => {});

    return () => {
      disposed = true;
    };
  }, [commitSentences]);

  return {
    state,
    seekToSentence,
    retrySentence,
    retryAll,
    setContinuous,
    toggleSidebar,
  };
}
