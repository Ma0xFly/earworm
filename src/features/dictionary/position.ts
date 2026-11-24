/**
 * Pure geometry for the click-a-word dictionary popup.
 *
 * The popup renders in the T1 body-level shadow root as a `position: fixed`
 * layer, so all coordinates here are viewport pixels. Keeping the maths outside
 * React makes the above/below flip and the viewport/player clamping testable
 * without a browser.
 *
 * Contract:
 * - prefer above the clicked word, flip below when the top side has no room;
 * - horizontally centre the card on the word and clamp it to the viewport (or
 *   to the player rect when the word itself is inside the player);
 * - when neither side can fit the measured card, pick the roomier side and
 *   return a `maxHeight` the card must honour (its translation list scrolls).
 */

export type PopupRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PopupSize = {
  width: number;
  height: number;
};

export type PopupViewport = {
  width: number;
  height: number;
};

export type PopupPositionInput = {
  /** Bounding rect of the clicked word (viewport coordinates). */
  anchor: PopupRect;
  /** Measured popup size; `0` before the first layout pass. */
  popup: PopupSize;
  viewport: PopupViewport;
  /** Player rect when known; the card is clamped inside it for overlay words. */
  player?: PopupRect | null;
  /** Space between the word and the card. Defaults to `POPUP_GAP_PX`. */
  gap?: number;
  /** Space kept between the card and the viewport/player edge. */
  margin?: number;
};

export type PopupPlacement = 'above' | 'below';

export type PopupPosition = {
  left: number;
  top: number;
  placement: PopupPlacement;
  /** Maximum height the card may use on the chosen side. */
  maxHeight: number;
  /** Maximum width available inside the resolved bounds. */
  maxWidth: number;
};

/** Space between the word and the card. */
export const POPUP_GAP_PX = 8;

/** Space kept between the card and the viewport/player edge. */
export const POPUP_MARGIN_PX = 8;

/** Beyond this the card would hide the video; the translation list scrolls. */
export const POPUP_MAX_HEIGHT_PX = 360;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function containsPoint(rect: PopupRect, x: number, y: number): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  return (
    x >= rect.left &&
    x <= rect.left + rect.width &&
    y >= rect.top &&
    y <= rect.top + rect.height
  );
}

/** Compute the fixed-position coordinates for one popup opening. */
export function computePopupPosition(input: PopupPositionInput): PopupPosition {
  const gap = Math.max(0, finite(input.gap ?? POPUP_GAP_PX));
  const margin = Math.max(0, finite(input.margin ?? POPUP_MARGIN_PX));
  const anchor = input.anchor;
  const popupWidth = Math.max(0, finite(input.popup.width));
  const popupHeight = Math.max(0, finite(input.popup.height));
  const viewportWidth = Math.max(0, finite(input.viewport.width));
  const viewportHeight = Math.max(0, finite(input.viewport.height));

  const centerX = anchor.left + anchor.width / 2;
  const centerY = anchor.top + anchor.height / 2;

  let boundLeft = margin;
  let boundRight = viewportWidth - margin;
  let boundTop = margin;
  let boundBottom = viewportHeight - margin;

  const player = input.player;
  if (player && containsPoint(player, centerX, centerY)) {
    boundLeft = Math.max(boundLeft, player.left + margin);
    boundRight = Math.min(boundRight, player.left + player.width - margin);
    boundTop = Math.max(boundTop, player.top + margin);
    boundBottom = Math.min(boundBottom, player.top + player.height - margin);
  }

  const availableWidth = Math.max(0, boundRight - boundLeft);
  const cardWidth = Math.min(popupWidth, availableWidth);
  const left = clamp(
    centerX - cardWidth / 2,
    boundLeft,
    boundLeft + availableWidth - cardWidth,
  );

  const topLimit = boundTop;
  const bottomLimit = Math.max(boundTop, boundBottom);
  const spaceAbove = anchor.top - gap - topLimit;
  const spaceBelow = bottomLimit - (anchor.top + anchor.height) - gap;

  // Before the first measurement (height 0) neither side "fits"; pick the
  // roomier one and let the measured pass refine it. This avoids deadlocking
  // at `maxHeight: 0` when a word sits exactly on a viewport edge.
  const fitsAbove = popupHeight > 0 && popupHeight <= spaceAbove;
  const fitsBelow = popupHeight > 0 && popupHeight <= spaceBelow;

  let placement: PopupPlacement;
  if (fitsAbove) placement = 'above';
  else if (fitsBelow) placement = 'below';
  else placement = Math.max(0, spaceAbove) >= Math.max(0, spaceBelow) ? 'above' : 'below';

  const available = Math.max(0, placement === 'above' ? spaceAbove : spaceBelow);
  const maxHeight = Math.min(POPUP_MAX_HEIGHT_PX, available);
  const renderedHeight = Math.min(popupHeight, maxHeight);

  const unclampedTop =
    placement === 'above'
      ? anchor.top - gap - renderedHeight
      : anchor.top + anchor.height + gap;
  const top = clamp(unclampedTop, topLimit, bottomLimit - renderedHeight);

  return { left, top, placement, maxHeight, maxWidth: availableWidth };
}
