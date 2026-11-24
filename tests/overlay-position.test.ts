import { describe, expect, it } from 'vitest';
import {
  BOTTOM_GAP_RATIO,
  MAX_CONTROLS_LIFT_PX,
  MAX_FONT_SIZE_PX,
  MAX_WIDTH_PX,
  MIN_FONT_SIZE_PX,
  computeControlsLift,
  computeFontSizePx,
  computeMaxWidthPx,
  computeOverlayAnchor,
  isAdPlaying,
} from '@/features/overlay/position';

const player = { left: 100, top: 100, width: 1280, height: 720 };

describe('overlay position engine', () => {
  it('anchors the bottom preset 8% above the player bottom', () => {
    const anchor = computeOverlayAnchor('bottom', 0);
    expect(anchor.left).toBe('calc(var(--ew-player-left) + var(--ew-player-width) / 2)');
    expect(anchor.top).toContain('var(--ew-player-top)');
    expect(anchor.top).toContain('* 0.92');
    expect(anchor.transform).toBe('translate(-50%, -100%)');
    expect(BOTTOM_GAP_RATIO).toBe(0.08);
  });

  it('anchors center and top presets relative to the player rect', () => {
    const center = computeOverlayAnchor('center');
    expect(center.top).toBe('calc(var(--ew-player-top) + var(--ew-player-height) / 2)');
    expect(center.transform).toBe('translate(-50%, -50%)');

    const top = computeOverlayAnchor('top');
    expect(top.top).toContain('* 0.08');
    expect(top.transform).toBe('translate(-50%, 0)');
  });

  it('subtracts the control-bar lift from the bottom anchor', () => {
    const anchor = computeOverlayAnchor('bottom', 40);
    expect(anchor.top).toContain('- 40px');
  });

  it('lifts the bottom preset while the control bar overlaps it', () => {
    // Player bottom = 100 + 720 = 820. Bottom-preset baseline = 820 - 8% * 720 = 762.4.
    const lift = computeControlsLift({
      preset: 'bottom',
      playerRect: player,
      controlsRect: { left: 0, top: 740, width: 1000, height: 40 },
      controlsVisible: true,
    });
    // intrude = 762.4 - (740 - 6) = 28.4 -> 28
    expect(lift).toBe(28);
  });

  it('caps the lift at 160px and never lifts for center/top presets', () => {
    expect(
      computeControlsLift({
        preset: 'bottom',
        playerRect: player,
        controlsRect: { left: 0, top: 600, width: 1000, height: 40 },
        controlsVisible: true,
      }),
    ).toBe(MAX_CONTROLS_LIFT_PX);
    expect(MAX_CONTROLS_LIFT_PX).toBe(160);

    for (const preset of ['center', 'top'] as const) {
      expect(
        computeControlsLift({
          preset,
          playerRect: player,
          controlsRect: { left: 0, top: 700, width: 1000, height: 40 },
          controlsVisible: true,
        }),
      ).toBe(0);
    }
  });

  it('does not lift when the controls are hidden or the rects are missing', () => {
    const base = {
      preset: 'bottom' as const,
      playerRect: player,
      controlsRect: { left: 0, top: 740, width: 1000, height: 40 },
    };
    expect(computeControlsLift({ ...base, controlsVisible: false })).toBe(0);
    expect(computeControlsLift({ ...base, controlsVisible: true, controlsRect: null })).toBe(0);
    expect(computeControlsLift({ ...base, controlsVisible: true, playerRect: null })).toBe(0);
    expect(
      computeControlsLift({
        ...base,
        controlsVisible: true,
        playerRect: { ...player, height: 0 },
      }),
    ).toBe(0);
  });

  it('clamps the font size to the player width', () => {
    expect(computeFontSizePx(0)).toBe(MIN_FONT_SIZE_PX);
    expect(computeFontSizePx(MIN_FONT_SIZE_PX)).toBe(MIN_FONT_SIZE_PX);
    expect(computeFontSizePx(1280)).toBe(28); // 1280 * 0.022 = 28.16
    expect(computeFontSizePx(1920)).toBe(MAX_FONT_SIZE_PX);
    expect(MIN_FONT_SIZE_PX).toBe(14);
    expect(MAX_FONT_SIZE_PX).toBe(30);
  });

  it('never lets a line exceed the player width', () => {
    expect(computeMaxWidthPx(0)).toBe(0);
    expect(computeMaxWidthPx(1280)).toBe(MAX_WIDTH_PX); // 1178 > 1100 cap
    expect(computeMaxWidthPx(800)).toBe(736);
    expect(computeMaxWidthPx(1920)).toBe(MAX_WIDTH_PX);
    expect(computeMaxWidthPx(400)).toBe(368);
  });

  it('detects YouTube ad classes', () => {
    expect(isAdPlaying(['ad-showing'])).toBe(true);
    expect(isAdPlaying(['ad-interrupting'])).toBe(true);
    expect(isAdPlaying(['ytp-autohide', 'playing-mode'])).toBe(false);
    expect(isAdPlaying(null)).toBe(false);
    expect(isAdPlaying([])).toBe(false);
  });
});
