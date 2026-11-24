/**
 * Adapted for Earworm (MIT) from Gythiro/yt-dual-subs (MIT) — Copyright (c) 2026 Gythiro.
 * Upstream: https://github.com/Gythiro/yt-dual-subs (v3.7.0: content.css
 * native-caption suppression).
 * Full upstream MIT permission text: see NOTICE.
 *
 * Page-level (document `<head>`) style used to hide YouTube's native caption
 * layer while Earworm is active.
 *
 * This CANNOT live in the shadow-root stylesheet: shadow CSS cannot match
 * elements in the host document. It is injected into `<head>` instead, scoped
 * by `html[data-earworm-active]`, and always removed on teardown.
 *
 * `opacity: 0` — never `display:none` / `visibility:hidden`: the screen-text
 * fallback and the player sniffing path still need to read the caption DOM.
 */
export const NATIVE_CAPTION_STYLE_ID = 'earworm-native-caption-style';

export const NATIVE_CAPTION_SUPPRESSION_CSS = `
html[data-earworm-active] .ytp-caption-window-container,
html[data-earworm-active] .caption-window {
  opacity: 0 !important;
  pointer-events: none !important;
}
`;

export type NativeCaptionCleanup = () => void;

/**
 * Install native-caption suppression and mark the page active. Idempotent:
 * calling twice reuses the same `<style>` and returns an independent cleanup.
 * The attribute and style are removed by the cleanup when the app unmounts.
 */
export function installNativeCaptionSuppression(
  doc: Document = document,
): NativeCaptionCleanup {
  doc.documentElement.setAttribute('data-earworm-active', '1');

  let style = doc.getElementById(NATIVE_CAPTION_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = NATIVE_CAPTION_STYLE_ID;
    style.setAttribute('data-earworm-page-style', '');
    doc.head.appendChild(style);
  }
  style.textContent = NATIVE_CAPTION_SUPPRESSION_CSS;

  return () => {
    // Only tear down when no other consumer still needs the style: another
    // install (e.g. T8's overlay effect) may have registered independently.
    const current = doc.getElementById(NATIVE_CAPTION_STYLE_ID);
    if (current) current.remove();
    doc.documentElement.removeAttribute('data-earworm-active');
  };
}

/** Remove the suppression style and the active marker unconditionally. */
export function removeNativeCaptionSuppression(doc: Document = document): void {
  doc.getElementById(NATIVE_CAPTION_STYLE_ID)?.remove();
  doc.documentElement.removeAttribute('data-earworm-active');
}
