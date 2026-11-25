import type { LearningSentence, VideoMeta } from '@/lib/contracts';

export type SessionStatus = 'idle' | 'acquiring' | 'ready' | 'no-captions' | 'error';

export type TranslationProgress = {
  state: 'idle' | 'running' | 'done' | 'partial';
  done: number;
  total: number;
  failed: number;
};

export type SessionState = {
  videoId: string | null;
  meta: VideoMeta | null;
  status: SessionStatus;
  sentences: LearningSentence[];
  currentIndex: number;
  translation: TranslationProgress;
  error?: string;
};

export type SessionApi = {
  state: SessionState;
  seekToSentence: (id: number) => void;
  /** Re-batch just this sentence, then merge. */
  retrySentence: (id: number) => void;
  retryAll: () => void;
  setContinuous: (v: boolean) => void;
};
