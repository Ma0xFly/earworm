import type { CueTrack } from '@/lib/contracts';

/**
 * Transcript client API (T1 stub).
 *
 * T3 replaces the implementation: listen to the window bridge, request
 * `earworm:produce` on start and on YouTube SPA navigation, validate the
 * `videoId`, drop stale messages and return a clean teardown function.
 */
export type TranscriptFailureReason =
  | 'no-captions'
  | 'asr-only'
  | 'nudge-failed'
  | 'timeout'
  | 'http';

export type TranscriptHandlers = {
  onTrack: (track: CueTrack) => void;
  onFailure: (videoId: string, reason: TranscriptFailureReason) => void;
};

export function startTranscriptClient(_handlers: TranscriptHandlers): () => void {
  // T3 implementation.
  return () => {};
}
