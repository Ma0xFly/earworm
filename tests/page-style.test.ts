import { describe, expect, it } from 'vitest';
import {
  NATIVE_CAPTION_STYLE_ID,
  NATIVE_CAPTION_SUPPRESSION_CSS,
  installNativeCaptionSuppression,
  removeNativeCaptionSuppression,
} from '@/lib/ui/page-style';

describe('native caption suppression (document-level, not shadow)', () => {
  it('adds a document <head> style and marks the page active', () => {
    const cleanup = installNativeCaptionSuppression();

    const style = document.getElementById(NATIVE_CAPTION_STYLE_ID);
    expect(style).toBeInstanceOf(HTMLStyleElement);
    expect(style?.parentElement).toBe(document.head);
    expect(style?.textContent).toContain('html[data-earworm-active] .ytp-caption-window-container');
    expect(document.documentElement.getAttribute('data-earworm-active')).toBe('1');

    cleanup();
    expect(document.getElementById(NATIVE_CAPTION_STYLE_ID)).toBeNull();
    expect(document.documentElement.hasAttribute('data-earworm-active')).toBe(false);
  });

  it('uses opacity (not display) so the caption DOM remains readable', () => {
    expect(NATIVE_CAPTION_SUPPRESSION_CSS).toContain('opacity: 0 !important');
    expect(NATIVE_CAPTION_SUPPRESSION_CSS).not.toContain('display: none');
    expect(NATIVE_CAPTION_SUPPRESSION_CSS).not.toContain('visibility: hidden');
  });

  it('is idempotent and remove() cleans up unconditionally', () => {
    const cleanupA = installNativeCaptionSuppression();
    const cleanupB = installNativeCaptionSuppression();
    expect(document.querySelectorAll(`#${NATIVE_CAPTION_STYLE_ID}`)).toHaveLength(1);

    cleanupA();
    cleanupB();
    removeNativeCaptionSuppression();
    expect(document.getElementById(NATIVE_CAPTION_STYLE_ID)).toBeNull();
    expect(document.documentElement.hasAttribute('data-earworm-active')).toBe(false);
  });
});
