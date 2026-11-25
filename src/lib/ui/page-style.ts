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
import { CAPTION_SELECTOR, PAGE_SELECTORS } from './selectors';

export const NATIVE_CAPTION_STYLE_ID = 'earworm-native-caption-style';

export const NATIVE_CAPTION_SUPPRESSION_CSS = `
html[data-earworm-active] ${PAGE_SELECTORS.captionWindowContainer},
html[data-earworm-active] ${PAGE_SELECTORS.captionWindow} {
  opacity: 0 !important;
  pointer-events: none !important;
}
`;

/**
 * Elements made visually transparent by the stylesheet above. `opacity: 0`
 * alone leaves the caption text in the accessibility tree, so the same nodes
 * get `aria-hidden="true"` while Earworm owns the screen; the previous value
 * (usually absent) is restored on cleanup.
 */
export type NativeCaptionCleanup = () => void;

type CaptionA11yState = {
  doc: Document;
  style: HTMLStyleElement;
  /** Previous `aria-hidden` value per element (`null` = attribute absent). */
  previous: Map<Element, string | null>;
  observer: MutationObserver | null;
};

/**
 * Shared suppression state. Multiple consumers (overlay mount, a second
 * content mount, tests) may install concurrently; the page is only restored
 * when the last cleanup runs, so one teardown cannot re-expose captions while
 * another consumer is still active.
 */
let sharedSuppression: CaptionA11yState | null = null;
let activeInstalls = 0;

function captionElements(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll(CAPTION_SELECTOR));
}

/** Mark every current caption node aria-hidden, remembering its prior value. */
function hideCaptionA11y(state: CaptionA11yState): void {
  for (const element of captionElements(state.doc)) {
    if (state.previous.has(element)) continue;
    state.previous.set(element, element.getAttribute('aria-hidden'));
    element.setAttribute('aria-hidden', 'true');
  }
}

function restoreCaptionA11y(state: CaptionA11yState): void {
  for (const [element, previous] of state.previous) {
    if (previous === null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', previous);
  }
  state.previous.clear();
}

function teardownSuppression(): void {
  const state = sharedSuppression;
  sharedSuppression = null;
  if (!state) return;
  state.observer?.disconnect();
  restoreCaptionA11y(state);
  state.style.remove();
  state.doc.documentElement.removeAttribute('data-earworm-active');
}

/**
 * Install native-caption suppression and mark the page active. Idempotent:
 * calling twice reuses the same `<style>`/observer and returns an independent
 * cleanup; the last cleanup restores the page (including each caption node's
 * previous `aria-hidden`). Caption nodes inserted later (a new video on the
 * same page, ads) are picked up by a childList observer.
 */
export function installNativeCaptionSuppression(
  doc: Document = document,
): NativeCaptionCleanup {
  doc.documentElement.setAttribute('data-earworm-active', '1');

  if (!sharedSuppression || sharedSuppression.doc !== doc) {
    teardownSuppression();
    let style = doc.getElementById(NATIVE_CAPTION_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement('style');
      style.id = NATIVE_CAPTION_STYLE_ID;
      style.setAttribute('data-earworm-page-style', '');
      doc.head.appendChild(style);
    }
    style.textContent = NATIVE_CAPTION_SUPPRESSION_CSS;

    const state: CaptionA11yState = {
      doc,
      style,
      previous: new Map(),
      observer: null,
    };
    if (typeof MutationObserver !== 'undefined') {
      state.observer = new MutationObserver(() => hideCaptionA11y(state));
      state.observer.observe(doc.documentElement, { childList: true, subtree: true });
    }
    sharedSuppression = state;
    hideCaptionA11y(state);
  }

  activeInstalls += 1;
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    activeInstalls = Math.max(0, activeInstalls - 1);
    if (activeInstalls > 0) return;
    teardownSuppression();
  };
}

/** Remove the suppression style and the active marker unconditionally. */
export function removeNativeCaptionSuppression(doc: Document = document): void {
  activeInstalls = 0;
  // Restores every remembered aria-hidden value, then removes the style and
  // the active marker from whichever document owned the shared state.
  teardownSuppression();

  // Defensive cleanup for a page that no longer matches the shared state.
  for (const element of captionElements(doc)) {
    if (element.getAttribute('aria-hidden') === 'true') {
      // The true prior value is unknown here; dropping our marker is safer
      // than leaving the page permanently hidden from assistive tech.
      element.removeAttribute('aria-hidden');
    }
  }
  doc.getElementById(NATIVE_CAPTION_STYLE_ID)?.remove();
  doc.documentElement.removeAttribute('data-earworm-active');
}

