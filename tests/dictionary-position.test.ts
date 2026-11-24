import { describe, expect, it } from 'vitest';
import {
  computePopupPosition,
  POPUP_GAP_PX,
  POPUP_MARGIN_PX,
  POPUP_MAX_HEIGHT_PX,
  type PopupPositionInput,
} from '@/features/dictionary/position';

/**
 * The popup is a `position: fixed` layer inside the shadow root, so the pure
 * function works in viewport coordinates. Expected values below are worked out
 * by hand from the spec: prefer above, flip below, clamp horizontally to the
 * viewport (or the player when the anchor is inside it), and shrink the height
 * when neither side has room.
 */
function input(overrides: Partial<PopupPositionInput> = {}): PopupPositionInput {
  return {
    anchor: { left: 400, top: 400, width: 80, height: 20 },
    popup: { width: 300, height: 200 },
    viewport: { width: 1000, height: 800 },
    ...overrides,
  };
}

describe('computePopupPosition', () => {
  it('prefers above the clicked word and centres horizontally', () => {
    const position = computePopupPosition(input());

    expect(position.placement).toBe('above');
    expect(position.left).toBe(290); // 400 + 40 - 150
    expect(position.top).toBe(192); // 400 - gap 8 - height 200
    expect(position.maxHeight).toBe(POPUP_MAX_HEIGHT_PX);
    expect(position.maxWidth).toBe(984); // viewport 1000 - 2 * margin 8
  });

  it('flips below when the word is too close to the top of the viewport', () => {
    const position = computePopupPosition(
      input({ anchor: { left: 400, top: 120, width: 80, height: 20 } }),
    );

    expect(position.placement).toBe('below');
    expect(position.left).toBe(290);
    expect(position.top).toBe(148); // 120 + 20 + gap 8
  });

  it('clamps to the left viewport margin', () => {
    const position = computePopupPosition(
      input({ anchor: { left: 0, top: 400, width: 20, height: 20 } }),
    );

    expect(position.left).toBe(POPUP_MARGIN_PX);
    expect(position.placement).toBe('above');
  });

  it('clamps to the right viewport margin', () => {
    const position = computePopupPosition(
      input({ anchor: { left: 960, top: 400, width: 40, height: 20 } }),
    );

    expect(position.left).toBe(692); // 1000 - 8 - 300
  });

  it('keeps a word inside the player within the player bounds and shrinks when neither side fits', () => {
    const position = computePopupPosition(
      input({
        anchor: { left: 500, top: 300, width: 60, height: 20 },
        player: { left: 100, top: 100, width: 600, height: 400 },
      }),
    );

    // Player content bounds are x [108, 692], y [108, 492].
    // Above space: 300 - 108 - 8 = 184; below: 492 - 320 - 8 = 164.
    expect(position.placement).toBe('above');
    expect(position.maxHeight).toBe(184);
    expect(position.left).toBe(380); // 530 - 150
    expect(position.top).toBe(108); // 300 - 8 - 184, clamped to the player top
    expect(position.maxWidth).toBe(584); // 692 - 108
  });

  it('does not clamp a sidebar word (outside the player) to the player rect', () => {
    const position = computePopupPosition(
      input({
        anchor: { left: 800, top: 400, width: 80, height: 20 },
        player: { left: 0, top: 0, width: 700, height: 800 },
      }),
    );

    expect(position.left).toBe(690); // centered on 840, clamped to 992 - 300? no: 840-150=690
    expect(position.maxWidth).toBe(984);
  });

  it('caps the height and width when the popup is larger than the viewport', () => {
    const position = computePopupPosition(
      input({ popup: { width: 1200, height: 900 } }),
    );

    expect(position.placement).toBe('above');
    expect(position.maxHeight).toBe(POPUP_MAX_HEIGHT_PX);
    expect(position.top).toBe(32); // 400 - 8 - 360
    expect(position.maxWidth).toBe(984);
    expect(position.left).toBe(8);
  });

  it('clamps an all-zero anchor/popup (not measured yet) to the top-left margin', () => {
    const position = computePopupPosition(
      input({
        anchor: { left: 0, top: 0, width: 0, height: 0 },
        popup: { width: 0, height: 0 },
      }),
    );

    // Nothing is measured yet: the roomier side wins (below), and the
    // card is still clamped inside the margin box.
    expect(position.placement).toBe('below');
    expect(position.left).toBe(POPUP_MARGIN_PX);
    expect(position.top).toBe(POPUP_MARGIN_PX);
  });

  it('uses the gap constant between the word and the card', () => {
    expect(POPUP_GAP_PX).toBe(8);
    expect(POPUP_MARGIN_PX).toBe(8);
  });
});
