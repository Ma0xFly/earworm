/**
 * Central map of the YouTube page selectors Earworm depends on.
 *
 * YouTube's DOM is not a public API. Keeping every lookup here means a rename
 * is a one-file fix and each consumer states intent (`findPlayerElement`,
 * `findCaptionElements`) instead of repeating a fragile selector chain. Lookup
 * helpers preserve each consumer's historical preference order.
 *
 * Spec §8: selectors for the player, caption nodes, recommended column and
 * player controls live in this module only.
 */

/** Element ids YouTube uses for the two player shells (opening the page DOM). */
export const PLAYER_DOM_ID = {
  movie: 'movie_player',
  shorts: 'shorts-player',
} as const;

/** Page-level selectors (host document, not the shadow root). */
export const PAGE_SELECTORS = {
  moviePlayer: `#${PLAYER_DOM_ID.movie}`,
  shortsPlayer: `#${PLAYER_DOM_ID.shorts}`,
  /** Regular watch/live player's media element. */
  html5Video: 'video.html5-main-video',
  /** Player container class, used when the id is missing during SPA swaps. */
  html5VideoPlayer: '.html5-video-player',
  /** Last-resort media element. */
  video: 'video',
  /** Caption layer container (native captions are only visually hidden). */
  captionWindowContainer: '.ytp-caption-window-container',
  captionWindow: '.caption-window',
  /** One painted caption line, used by the screen-text fallback. */
  captionSegment: '.ytp-caption-segment',
  /** Recommended-videos column on the watch page (docked sidebar area). */
  secondary: '#secondary',
  /** Inner column, used when `#secondary` is absent in a layout experiment. */
  secondaryInner: '#secondary-inner',
  /** Bottom player controls; the overlay lifts above this bar. */
  controlBar: '.ytp-chrome-bottom',
  /** Right-hand button group; the quick toggle is inserted here. */
  controlButtons: '.ytp-right-controls',
  /** CC button the fallback nudges to arm captions and the toggle anchors to. */
  subtitlesButton: '.ytp-subtitles-button',
} as const;

/** Combined caption-layer selector (container or per-line window). */
export const CAPTION_SELECTOR = `${PAGE_SELECTORS.captionWindowContainer}, ${PAGE_SELECTORS.captionWindow}`;

/** Visible caption text nodes scraped by the screen-text fallback. */
export const CAPTION_TEXT_SELECTOR = `${PAGE_SELECTORS.captionSegment}, ${PAGE_SELECTORS.captionWindow}`;

/** Player preference order for overlay/dictionary geometry. */
const PLAYER_LOOKUP = [
  PAGE_SELECTORS.moviePlayer,
  PAGE_SELECTORS.shortsPlayer,
  PAGE_SELECTORS.html5Video,
  PAGE_SELECTORS.video,
] as const;

/** First matching element for an ordered selector list, or null. */
export function firstMatch(
  doc: Document,
  selectors: readonly string[],
): Element | null {
  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    if (element) return element;
  }
  return null;
}

/** The player the overlay/sidebar geometry should follow on this page. */
export function findPlayerElement(doc: Document = document): Element | null {
  return firstMatch(doc, PLAYER_LOOKUP);
}

/** The CC button the quick toggle must sit immediately to the left of. */
export function findSubtitlesButton(doc: Document = document): Element | null {
  return doc.querySelector(PAGE_SELECTORS.subtitlesButton);
}

/** Every caption layer node currently in the page. */
export function findCaptionElements(doc: Document = document): Element[] {
  return Array.from(doc.querySelectorAll(CAPTION_SELECTOR));
}

/**
 * Slot the docked sidebar is prepended to: the inner recommended-videos column
 * first, the outer column as a fallback for layout experiments.
 */
export function findSecondarySlot(doc: Document = document): Element | null {
  return (
    doc.querySelector(PAGE_SELECTORS.secondaryInner) ??
    doc.querySelector(PAGE_SELECTORS.secondary)
  );
}
