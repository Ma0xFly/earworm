/**
 * Adapted for Earworm (MIT) from Gythiro/yt-dual-subs (MIT) — Copyright (c) 2026 Gythiro.
 * Upstream: https://github.com/Gythiro/yt-dual-subs (v3.7.0: content.js overlay and caption lifecycle).
 * Full upstream MIT permission text: see NOTICE.
 */
import { useEffect, useState } from 'react';
import { useSession, type SessionStatus } from '@/features/session';
import { isShortsHref } from '@/lib/transcript';
import { installNativeCaptionSuppression } from '@/lib/ui/page-style';
import { OverlayView, type OverlayViewProps } from './OverlayView';
import type { OverlayPosition } from './position';
import { usePlayerSnapshot } from './use-player-snapshot';

export type OverlayProps = {
  /**
   * Bottom (default; switches to the 18%-gap Shorts anchor on `/shorts/`) /
   * center / top / explicit Shorts anchor inside the player rect.
   */
  position?: OverlayPosition;
};

/**
 * Shorts uses a separate vertical player whose action rail covers the bottom
 * of the frame, so the default bottom preset becomes the 18%-gap Shorts
 * anchor. An explicit center/top preset (playgrounds, future options) wins.
 *
 * Read at render time: YouTube SPA navigation re-renders through session state
 * (and `useSpaStale`), so the preset follows a watch → Shorts → watch switch.
 */
function effectiveOverlayPosition(
  requested: OverlayPosition | undefined,
): OverlayPosition {
  if (requested && requested !== 'bottom') return requested;
  return isShortsHref(location.href) ? 'shorts' : 'bottom';
}

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
 * (never `display: none`) only while a ready session is showing; the style
 * and marker are removed on teardown and no user caption settings are touched.
 */
export function Overlay({ position }: OverlayProps = {}) {
  const { state, retryAll } = useSession();
  const resolvedPosition = effectiveOverlayPosition(position);
  const player = usePlayerSnapshot(resolvedPosition);
  const stale = useSpaStale(state.videoId, state.status);

  // Suppress YouTube's own captions only while the bilingual overlay actually
  // has a ready track to show. On acquisition failure (no-captions/error) the
  // page must keep native captions visible rather than blanking both.
  useEffect(() => {
    if (state.status !== 'ready') return undefined;
    return installNativeCaptionSuppression();
  }, [state.status]);

  const viewProps: OverlayViewProps = {
    state,
    position: resolvedPosition,
    adPlaying: player.adPlaying,
    stale,
    liftPx: player.liftPx,
    playerWidth: player.playerWidth,
    onRetry: retryAll,
  };

  return <OverlayView {...viewProps} />;
}
