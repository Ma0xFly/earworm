import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { useSettings } from '@/lib/settings';
import type { SessionApi, SessionState } from './types';
import { useSessionEngine } from './useSessionEngine';

/**
 * Session context for the content UI (T13).
 *
 * `SessionProvider` wires the React settings context to the session engine
 * (`useSessionEngine`), which owns transcript acquisition, sentence merging,
 * offline/LLM collocation union, translation batching, caching and sentence
 * playback. The exported types, `SessionProvider` and `useSession` are stable
 * across tickets; `idleSessionApi` remains the safe value outside a provider.
 */

export const idleSessionState: SessionState = {
  videoId: null,
  meta: null,
  status: 'idle',
  sentences: [],
  currentIndex: 0,
  translation: { state: 'idle', done: 0, total: 0, failed: 0 },
};

const noop = (): void => {
  // Intentionally empty: the no-provider default.
};

export const idleSessionApi: SessionApi = {
  state: idleSessionState,
  seekToSentence: noop,
  retrySentence: noop,
  retryAll: noop,
  setContinuous: noop,
};

const SessionContext = createContext<SessionApi>(idleSessionApi);

export function SessionProvider({ children }: { children?: ReactNode }) {
  const { settings, set } = useSettings();
  const engine = useSessionEngine({ settings, setSettings: set });

  const api = useMemo<SessionApi>(
    () => ({
      state: engine.state,
      seekToSentence: engine.seekToSentence,
      retrySentence: engine.retrySentence,
      retryAll: engine.retryAll,
      setContinuous: engine.setContinuous,
    }),
    [
      engine.state,
      engine.seekToSentence,
      engine.retrySentence,
      engine.retryAll,
      engine.setContinuous,
    ],
  );

  return createElement(SessionContext.Provider, { value: api }, children);
}

export function useSession(): SessionApi {
  return useContext(SessionContext);
}
