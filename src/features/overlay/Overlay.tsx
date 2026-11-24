/**
 * Adapted for Earworm (MIT) from Gythiro/yt-dual-subs (MIT) — Copyright (c) 2026 Gythiro.
 * Upstream: https://github.com/Gythiro/yt-dual-subs (v3.7.0: content.js overlay and caption lifecycle).
 * Full upstream MIT permission text: see NOTICE.
 */
import { useEffect, useState } from 'react';
import { useSession, type SessionStatus } from '@/features/session';
import { installNativeCaptionSuppression } from '@/lib/ui/page-style';
import {
  OverlayView,
  type OverlayViewProps,
  type OverlayWordClickHandler,
} from './OverlayView';
import type { OverlayPosition } from './position';
import { usePlayerSnapshot } from './use-player-snapshot';

export type OverlayProps = {
  /** Bottom (default) / center / top anchor inside the player rect. */
  position?: OverlayPosition;
  /**
   * Dictionary hookup owned by T12. Until it lands this is a no-op pass-through,
   * so the English line is already clickable and the contract is stable.
   */
  onWordClick?: OverlayWordClickHandler;
};

/**
 * Hide the previous video's sentence until the session reports the new one.
 * YouTube fires `yt-navigate-finish` after the new player DOM is ready; the
 * session provider resets/loads asynchronously, so without this the last
 * frame of the previous video can sit over the next one.
 */
function useSpaStale(
  videoId: string | null,
  status: SessionStatus,
): boolean {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const onNavigate = (): void => setStale(true);
    document.addEventListener('yt-navigate-finish', onNavigate);
    return () => document.removeEventListener('yt-navigate-finish', onNavigate);
  }, []);

  useEffect(() => {
    setStale(false);
  }, [videoId, status]);

  return stale;
}

/**
 * Bilingual subtitle overlay (T8).
 *
 * Mounted inside the T1 body-level shadow root, so it never appends to
 * `#movie_player` and survives player-ancestor transforms/overflow. Native
 * YouTube captions are suppressed at the document level with `opacity: 0`
 * (never `display: none`) while the overlay is active; the style and marker
 * are removed on teardown and no user caption settings are touched.
 */
export function Overlay({
  position = 'bottom',
  onWordClick,
}: OverlayProps = {}) {
  const { state, retryAll } = useSession();
  const player = usePlayerSnapshot(position);
  const stale = useSpaStale(state.videoId, state.status);

  useEffect(() => installNativeCaptionSuppression(), []);

  const viewProps: OverlayViewProps = {
    state,
    position,
    adPlaying: player.adPlaying,
    stale,
    liftPx: player.liftPx,
    playerWidth: player.playerWidth,
    onRetry: retryAll,
    onWordClick,
  };

  return <OverlayView {...viewProps} />;
}
