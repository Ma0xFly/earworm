/**
 * Adapted for Earworm (MIT) from Gythiro/yt-dual-subs (MIT) — Copyright (c) 2026 Gythiro.
 * Upstream: https://github.com/Gythiro/yt-dual-subs (v3.7.0: content.js overlay and caption lifecycle).
 * Full upstream MIT permission text: see NOTICE.
 */
/**
 * Pure geometry for the bilingual overlay.
 *
 * The overlay lives in the shadow root (a `position: fixed` layer), so it
 * cannot use percentage offsets against the player; T1 publishes the player
 * rect as `--ew-player-*` CSS variables on the shadow host. These helpers
 * produce the CSS expressions that consume those variables and the small
 * amount of live geometry (control-bar lift) that cannot be expressed in CSS.
 *
 * Keeping this module DOM-free makes normal/theater/fullscreen behavior
 * testable without a real YouTube player.
 */
export type OverlayPosition = 'bottom' | 'center' | 'top';

export type OverlayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Bottom preset sits this fraction of the player height above its bottom. */
export const BOTTOM_GAP_RATIO = 0.08;

/** Top preset sits this fraction of the player height below its top. */
export const TOP_GAP_RATIO = 0.08;

/** Native captions rise at most this far while the control bar is visible. */
export const MAX_CONTROLS_LIFT_PX = 160;

/** Breathing room kept between the overlay and the control bar. */
export const CONTROLS_CLEARANCE_PX = 6;

export const MIN_FONT_SIZE_PX = 14;
export const MAX_FONT_SIZE_PX = 30;

/** Font size scales linearly with the player width between the clamps. */
export const FONT_SIZE_RATIO = 0.022;

export const MAX_WIDTH_RATIO = 0.92;
export const MAX_WIDTH_PX = 1100;

const CENTERED_LEFT =
  'calc(var(--ew-player-left) + var(--ew-player-width) / 2)';

/** True when YouTube is playing an ad in the player. */
export function isAdPlaying(
  classList: Iterable<string> | null | undefined,
): boolean {
  if (!classList) return false;
  for (const token of classList) {
    if (token === 'ad-showing' || token === 'ad-interrupting') return true;
  }
  return false;
}

/** Clamped overlay font size in CSS pixels for a measured player width. */
export function computeFontSizePx(playerWidth: number): number {
  if (!Number.isFinite(playerWidth) || playerWidth <= 0) return MIN_FONT_SIZE_PX;
  const scaled = playerWidth * FONT_SIZE_RATIO;
  return Math.round(
    Math.min(MAX_FONT_SIZE_PX, Math.max(MIN_FONT_SIZE_PX, scaled)),
  );
}

/** Clamped line width in CSS pixels; 0 means "player rect not known yet". */
export function computeMaxWidthPx(playerWidth: number): number {
  if (!Number.isFinite(playerWidth) || playerWidth <= 0) return 0;
  return Math.round(Math.min(playerWidth * MAX_WIDTH_RATIO, MAX_WIDTH_PX));
}

export type ControlsLiftInput = {
  preset: OverlayPosition;
  playerRect: OverlayRect | null;
  controlsRect: OverlayRect | null;
  /** The control bar exists, is rendered, and is not auto-hidden. */
  controlsVisible: boolean;
};

/**
 * How far the bottom preset must rise so the control bar does not cover it.
 *
 * Mirrors YouTube's native caption behavior: the lift is capped at 160px and
 * only applies to the bottom preset. Returns 0 when nothing must move.
 */
export function computeControlsLift(input: ControlsLiftInput): number {
  const { preset, playerRect, controlsRect, controlsVisible } = input;
  if (preset !== 'bottom' || !controlsVisible) return 0;
  if (!playerRect || !controlsRect) return 0;
  if (playerRect.height <= 0 || controlsRect.height <= 0) return 0;

  const baseBottom =
    playerRect.top + playerRect.height * (1 - BOTTOM_GAP_RATIO);
  const intrude = baseBottom - (controlsRect.top - CONTROLS_CLEARANCE_PX);
  if (!Number.isFinite(intrude) || intrude <= 0) return 0;
  return Math.min(Math.round(intrude), MAX_CONTROLS_LIFT_PX);
}

export type OverlayAnchor = {
  left: string;
  top: string;
  transform: string;
};

/**
 * CSS expressions anchoring the overlay to the published player rect.
 * `liftPx` is the control-bar lift applied to the bottom preset only.
 */
export function computeOverlayAnchor(
  position: OverlayPosition,
  liftPx = 0,
): OverlayAnchor {
  switch (position) {
    case 'center':
      return {
        left: CENTERED_LEFT,
        top: 'calc(var(--ew-player-top) + var(--ew-player-height) / 2)',
        transform: 'translate(-50%, -50%)',
      };
    case 'top':
      return {
        left: CENTERED_LEFT,
        top: `calc(var(--ew-player-top) + var(--ew-player-height) * ${TOP_GAP_RATIO})`,
        transform: 'translate(-50%, 0)',
      };
    case 'bottom':
    default:
      return {
        left: CENTERED_LEFT,
        top: `calc(var(--ew-player-top) + var(--ew-player-height) * ${1 - BOTTOM_GAP_RATIO} - ${Math.max(0, liftPx)}px)`,
        transform: 'translate(-50%, -100%)',
      };
  }
}
