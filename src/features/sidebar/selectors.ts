/**
 * Sidebar placement: the pure layout maths that turns a measured page
 * environment into the panel geometry.
 *
 * DOM selectors live in the central `@/lib/ui/selectors` map; the placement
 * rules stay unit-testable without a browser.
 */
import type { CSSProperties } from 'react';
import { findSidebarPlayer, PAGE_SELECTORS } from '@/lib/ui/selectors';

/** Class YouTube puts on the player in theater (large-width) mode. */
export const THEATER_CLASS = 'ytp-large-width-mode';

/** Fallback viewport width when the document reports none (SSR/tests). */
const FALLBACK_VIEWPORT_WIDTH = 1200;
/** Gap between the drawer's right edge and the viewport edge. */
export const PANEL_RIGHT_GAP = 24;
/** `#secondary` is ~360–402px wide; the drawer never grows past 402px. */
export const PANEL_MAX_WIDTH = 402;
/** Narrow viewports use `min(402px, 30vw)`; below 280px the list is unusable. */
export const NARROW_WIDTH_RATIO = 0.3;
export const MIN_PANEL_WIDTH = 280;
/** Drawer leaves the player's bottom control bar visible. */
export const DRAWER_CONTROL_LIFT = 72;
export const DRAWER_TOP_INSET = 12;
/**
 * Docked panel height. The panel is a block in the recommended-videos column,
 * so it needs an explicit height: the sentence list scrolls inside it instead
 * of stretching the column (and the page scrolls the panel away naturally).
 * Equivalent to `clamp(320px, 56vh, 560px)`, expressed as min/height/max so
 * every browser (and the happy-dom test style parser) understands it.
 */
export const SIDEBAR_PANEL_HEIGHT = '56vh';
export const SIDEBAR_PANEL_MIN_HEIGHT = '320px';
export const SIDEBAR_PANEL_MAX_HEIGHT = '560px';
/** A zero-width `#secondary` (hidden by YouTube) counts as absent. */
const MIN_SECONDARY_WIDTH = 240;

export type SidebarMode = 'docked' | 'drawer';

export type SidebarEnvironment = {
  /** `#secondary` exists and has a measured, usable width. */
  hasSecondary: boolean;
  secondaryWidth: number | null;
  viewportWidth: number;
  fullscreen: boolean;
  theater: boolean;
};

export type SidebarLayout = {
  mode: SidebarMode;
  style: CSSProperties;
};

function getSecondary(doc: Document): Element | null {
  return (
    doc.querySelector(PAGE_SELECTORS.secondary) ??
    doc.querySelector(PAGE_SELECTORS.secondaryInner)
  );
}

/** Measure the page once. Pure apart from the DOM reads, so a hook can diff it. */
export function readSidebarEnvironment(doc: Document = document): SidebarEnvironment {
  const secondary = getSecondary(doc);
  const secondaryWidth = secondary
    ? Math.round(secondary.getBoundingClientRect().width)
    : 0;
  const usableSecondaryWidth =
    secondaryWidth >= MIN_SECONDARY_WIDTH ? secondaryWidth : null;
  const player = findSidebarPlayer(doc);
  const viewportWidth = doc.defaultView?.innerWidth ?? 0;

  return {
    hasSecondary: usableSecondaryWidth !== null,
    secondaryWidth: usableSecondaryWidth,
    viewportWidth,
    fullscreen: Boolean(doc.fullscreenElement),
    theater: player?.classList.contains(THEATER_CLASS) ?? false,
  };
}

export function sameSidebarEnvironment(
  a: SidebarEnvironment,
  b: SidebarEnvironment,
): boolean {
  return (
    a.hasSecondary === b.hasSecondary &&
    a.secondaryWidth === b.secondaryWidth &&
    a.viewportWidth === b.viewportWidth &&
    a.fullscreen === b.fullscreen &&
    a.theater === b.theater
  );
}

/**
 * Placement contract (issue #29):
 * - watch page with a usable `#secondary`: a block panel rendered into a
 *   nested shadow host at the top of `#secondary-inner`. Width 100%, fixed
 *   height with an internal scrolling list, no `position: fixed/sticky`, so
 *   recommended videos sit below it and the panel scrolls with the page;
 * - fullscreen or no usable column: a fixed right drawer whose vertical
 *   geometry comes from T1's `--ew-player-*` variables;
 * - theater no longer forces a drawer: it is docked whenever YouTube still
 *   exposes a usable column. Narrow viewports fall back naturally, because
 *   YouTube hides `#secondary` (zero width) there.
 */
export function computeSidebarLayout(env: SidebarEnvironment): SidebarLayout {
  const drawer = env.fullscreen || !env.hasSecondary;

  if (drawer) {
    const viewportWidth =
      env.viewportWidth > 0 ? env.viewportWidth : FALLBACK_VIEWPORT_WIDTH;
    const narrowWidth = Math.round(
      Math.min(
        PANEL_MAX_WIDTH,
        Math.max(MIN_PANEL_WIDTH, viewportWidth * NARROW_WIDTH_RATIO),
      ),
    );
    return {
      mode: 'drawer',
      style: {
        position: 'fixed',
        top: `calc(var(--ew-player-top) + ${DRAWER_TOP_INSET}px)`,
        height: `calc(var(--ew-player-height) - ${DRAWER_TOP_INSET + DRAWER_CONTROL_LIFT}px)`,
        right: `${PANEL_RIGHT_GAP}px`,
        width: `${narrowWidth}px`,
        zIndex: 60,
      },
    };
  }

  return {
    mode: 'docked',
    style: {
      width: '100%',
      height: SIDEBAR_PANEL_HEIGHT,
      minHeight: SIDEBAR_PANEL_MIN_HEIGHT,
      maxHeight: SIDEBAR_PANEL_MAX_HEIGHT,
    },
  };
}
