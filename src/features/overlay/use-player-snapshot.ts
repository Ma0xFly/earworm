/**
 * Adapted for Earworm (MIT) from Gythiro/yt-dual-subs (MIT) — Copyright (c) 2026 Gythiro.
 * Upstream: https://github.com/Gythiro/yt-dual-subs (v3.7.0: content.js overlay and caption lifecycle).
 * Full upstream MIT permission text: see NOTICE.
 */
import { useEffect, useState } from 'react';
import { PAGE_SELECTORS } from '@/lib/ui/selectors';
import { getPlayerElement } from '@/lib/ui/shadow';
import {
  computeControlsLift,
  isAdPlaying,
  type OverlayPosition,
  type OverlayRect,
} from './position';

export type PlayerOverlaySnapshot = {
  /** YouTube is playing an ad in the player; the overlay must be cleared. */
  adPlaying: boolean;
  /** How far the bottom preset must rise above the control bar. */
  liftPx: number;
  /** Measured player width, used for the font-size clamp. */
  playerWidth: number;
};

export const INITIAL_PLAYER_SNAPSHOT: PlayerOverlaySnapshot = {
  adPlaying: false,
  liftPx: 0,
  playerWidth: 0,
};

function toRect(rect: DOMRect): OverlayRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Read ad/control-bar state from the live player element.
 *
 * `.ytp-chrome-bottom` is only trusted while it is actually rendered and the
 * player is not `ytp-autohide` — the same two conditions YouTube's own
 * captions use before rising. Ads clear the overlay, so neither the lift nor
 * the caption paint is computed against the ad's layout.
 */
export function readPlayerSnapshot(
  player: Element | null,
  position: OverlayPosition,
): PlayerOverlaySnapshot {
  if (!player) return INITIAL_PLAYER_SNAPSHOT;

  const classList = player.classList;
  const adPlaying = isAdPlaying(classList);
  const playerRect = toRect(player.getBoundingClientRect());

  if (adPlaying) {
    return { adPlaying: true, liftPx: 0, playerWidth: playerRect.width };
  }

  const bar = player.querySelector(PAGE_SELECTORS.controlBar);
  const controlsVisible =
    bar instanceof HTMLElement &&
    bar.offsetParent !== null &&
    !classList.contains('ytp-autohide');

  return {
    adPlaying: false,
    liftPx: computeControlsLift({
      preset: position,
      playerRect,
      controlsRect: bar ? toRect(bar.getBoundingClientRect()) : null,
      controlsVisible,
    }),
    playerWidth: playerRect.width,
  };
}

function sameSnapshot(
  a: PlayerOverlaySnapshot,
  b: PlayerOverlaySnapshot,
): boolean {
  return (
    a.adPlaying === b.adPlaying &&
    a.liftPx === b.liftPx &&
    a.playerWidth === b.playerWidth
  );
}

/**
 * Keep the overlay snapshot in sync with the player.
 *
 * Event driven and rAF-throttled: player class mutations, player resize,
 * window resize/scroll, fullscreen and YouTube SPA navigation all coalesce
 * into at most one measurement per animation frame. The observer re-binds
 * when YouTube replaces the player node on navigation.
 */
export function usePlayerSnapshot(
  position: OverlayPosition,
): PlayerOverlaySnapshot {
  const [snapshot, setSnapshot] = useState<PlayerOverlaySnapshot>(() =>
    readPlayerSnapshot(getPlayerElement(), position),
  );

  useEffect(() => {
    let disposed = false;
    let frame = 0;
    let player: Element | null = null;

    const mutationObserver =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => schedule());
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => schedule());

    function refresh(): void {
      if (disposed) return;
      const next = getPlayerElement();
      if (next !== player) {
        player = next;
        mutationObserver?.disconnect();
        resizeObserver?.disconnect();
        if (player) {
          mutationObserver?.observe(player, {
            attributes: true,
            attributeFilter: ['class'],
          });
          resizeObserver?.observe(player);
        }
      }
      const measured = readPlayerSnapshot(player, position);
      setSnapshot((previous) =>
        sameSnapshot(previous, measured) ? previous : measured,
      );
    }

    function schedule(): void {
      if (disposed || frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        refresh();
      });
    }

    refresh();

    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    document.addEventListener('fullscreenchange', schedule);
    document.addEventListener('yt-navigate-finish', schedule);
    document.addEventListener('yt-page-data-updated', schedule);

    return () => {
      disposed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, { capture: true });
      document.removeEventListener('fullscreenchange', schedule);
      document.removeEventListener('yt-navigate-finish', schedule);
      document.removeEventListener('yt-page-data-updated', schedule);
    };
  }, [position]);

  return snapshot;
}
