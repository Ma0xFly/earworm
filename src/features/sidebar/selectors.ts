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

/** Docked placement only exists on wide watch pages; below this it is a drawer. */
export const DOCKED_MIN_VIEWPORT = 1200;
/** Gap between the panel's right edge and the viewport edge. */
export const PANEL_RIGHT_GAP = 24;
/** `#secondary` is ~360–402px wide; never grow past 402px. */
export const PANEL_MAX_WIDTH = 402;
/** Narrow viewports use `min(402px, 30vw)`; below 280px the list is unusable. */
export const NARROW_WIDTH_RATIO = 0.3;
export const MIN_PANEL_WIDTH = 280;
/** Drawer leaves the player's bottom control bar visible. */
export const DRAWER_CONTROL_LIFT = 72;
export const DRAWER_TOP_INSET = 12;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Placement contract (issue #10):
 * - wide watch page with `#secondary`: a fixed panel in that column, width
 *   taken from the column (clamped to 402px), 24px from the right edge;
 * - narrow viewport, theater, fullscreen, or no `#secondary`: a fixed drawer
 *   on the right that the header can close;
 * - vertical geometry comes from T1's `--ew-player-*` CSS variables, so it
 *   follows the player rect on resize, theater and fullscreen without JS.
 */
export function computeSidebarLayout(env: SidebarEnvironment): SidebarLayout {
  const viewportWidth = env.viewportWidth > 0 ? env.viewportWidth : DOCKED_MIN_VIEWPORT;
  const narrowWidth = Math.round(
    Math.min(PANEL_MAX_WIDTH, Math.max(MIN_PANEL_WIDTH, viewportWidth * NARROW_WIDTH_RATIO)),
  );
  const columnWidth =
    env.secondaryWidth !== null
      ? clamp(env.secondaryWidth, MIN_PANEL_WIDTH, PANEL_MAX_WIDTH)
      : narrowWidth;

  const drawer =
    env.fullscreen ||
    env.theater ||
    !env.hasSecondary ||
    viewportWidth < DOCKED_MIN_VIEWPORT;

  if (drawer) {
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
      position: 'fixed',
      top: 'var(--ew-player-top)',
      height: 'var(--ew-player-height)',
      right: `${PANEL_RIGHT_GAP}px`,
      width: `${columnWidth}px`,
      zIndex: 60,
    },
  };
}
