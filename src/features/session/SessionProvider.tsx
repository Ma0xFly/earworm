import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import type { SessionApi, SessionState } from './types';

/**
 * T1 no-op session provider.
 *
 * T13 replaces this implementation with the real transcript → sentences →
 * translation pipeline. The exported types, `SessionProvider` and `useSession`
 * stay stable.
 */

const INITIAL_STATE: SessionState = {
  videoId: null,
  meta: null,
  status: 'idle',
  sentences: [],
  currentIndex: 0,
  translation: { state: 'idle', done: 0, total: 0, failed: 0 },
};

const noop = (): void => {
  // Intentionally empty until T13 lands the real orchestration.
};

export const idleSessionApi: SessionApi = {
  state: INITIAL_STATE,
  seekToSentence: noop,
  retrySentence: noop,
  retryAll: noop,
  setContinuous: noop,
  toggleSidebar: noop,
};

const SessionContext = createContext<SessionApi>(idleSessionApi);

export function SessionProvider({ children }: { children?: ReactNode }) {
  const api = useMemo<SessionApi>(
    () => ({
      ...idleSessionApi,
      state: { ...INITIAL_STATE, translation: { ...INITIAL_STATE.translation } },
    }),
    [],
  );
  return createElement(SessionContext.Provider, { value: api }, children);
}

export function useSession(): SessionApi {
  return useContext(SessionContext);
}
