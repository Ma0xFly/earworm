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

describe('native caption accessibility', () => {
  function addCaption(className = 'ytp-caption-window-container'): HTMLDivElement {
    const element = document.createElement('div');
    element.className = className;
    element.textContent = 'caption';
    document.body.appendChild(element);
    return element;
  }

  it('marks captions aria-hidden and restores each prior value on cleanup', async () => {
    const existing = addCaption();
    existing.setAttribute('aria-hidden', 'false');

    const cleanup = installNativeCaptionSuppression();
    expect(existing.getAttribute('aria-hidden')).toBe('true');

    // A caption node inserted later (next video / ad) is picked up live.
    const late = addCaption('caption-window');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(late.getAttribute('aria-hidden')).toBe('true');

    cleanup();
    expect(existing.getAttribute('aria-hidden')).toBe('false');
    expect(late.hasAttribute('aria-hidden')).toBe(false);

    existing.remove();
    late.remove();
  });

  it('keeps suppression while another install is still active', () => {
    const caption = addCaption();
    const cleanupA = installNativeCaptionSuppression();
    const cleanupB = installNativeCaptionSuppression();

    cleanupA();
    expect(document.getElementById(NATIVE_CAPTION_STYLE_ID)).not.toBeNull();
    expect(caption.getAttribute('aria-hidden')).toBe('true');

    cleanupB();
    expect(document.getElementById(NATIVE_CAPTION_STYLE_ID)).toBeNull();
    expect(caption.hasAttribute('aria-hidden')).toBe(false);
    caption.remove();
  });

  it('remove() restores aria-hidden even after a lost cleanup', () => {
    const caption = addCaption();
    caption.setAttribute('aria-hidden', 'true');
    installNativeCaptionSuppression();

    removeNativeCaptionSuppression();
    expect(caption.hasAttribute('aria-hidden')).toBe(false);
    caption.remove();
  });
});
