/**
 * Follow the current sentence with `scrollIntoView({block:'center'})` while
 * the user is not browsing the list by hand.
 *
 * Interaction adapted from the easysubs transcript sidebar: a manual scroll
 * pauses auto-follow for five seconds; scrolling the current row back into
 * view resumes it immediately. Adapted from easysubs
 * (https://github.com/Nitrino/easysubs), Copyright (c) 2022 Seo Jong Hak,
 * MIT License — see NOTICE.
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** How long auto-follow waits after the last manual scroll. */
export const FOLLOW_PAUSE_MS = 5000;

/** Programmatic scrolls are ignored for a moment so they do not count as manual. */
const PROGRAMMATIC_WINDOW_MS = 150;

export type UseAutoScrollOptions = {
  listRef: RefObject<HTMLDivElement | null>;
  /** `null` when there is no list to follow (hidden, empty, no captions). */
  currentId: number | null;
  active: boolean;
};

export type UseAutoScrollResult = {
  onScroll: () => void;
};

function findRow(list: HTMLElement, id: number): HTMLElement | null {
  return list.querySelector<HTMLElement>(`[data-sentence-id="${id}"]`);
}

/**
 * A row counts as "in view" when any part of it intersects the list viewport.
 * Zero-height rects (layout unavailable, e.g. a hidden panel) count as in view
 * so the hook never pauses auto-follow because it cannot measure.
 */
function isRowVisible(list: HTMLElement, row: HTMLElement): boolean {
  const listRect = list.getBoundingClientRect();
  if (listRect.height <= 0) return true;
  const rowRect = row.getBoundingClientRect();
  return rowRect.bottom > listRect.top && rowRect.top < listRect.bottom;
}

export function useAutoScroll({
  listRef,
  currentId,
  active,
}: UseAutoScrollOptions): UseAutoScrollResult {
  const currentIdRef = useRef<number | null>(currentId);
  const holdUntilRef = useRef(0);
  const programmaticUntilRef = useRef(0);
  const resumeTimerRef = useRef<number | null>(null);

  const clearResumeTimer = useCallback((): void => {
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }, []);

  const scrollToCurrent = useCallback((): void => {
    const list = listRef.current;
    const id = currentIdRef.current;
    if (!list || id === null) return;
    const row = findRow(list, id);
    if (!row) return;
    programmaticUntilRef.current = Date.now() + PROGRAMMATIC_WINDOW_MS;
    row.scrollIntoView?.({ block: 'center' });
  }, [listRef]);

  useEffect(() => {
    currentIdRef.current = currentId;
    if (!active || currentId === null) return;
    if (Date.now() < holdUntilRef.current) return;
    scrollToCurrent();
  }, [active, currentId, scrollToCurrent]);

  useEffect(() => clearResumeTimer, [clearResumeTimer]);

  const onScroll = useCallback((): void => {
    if (!active) return;
    if (Date.now() < programmaticUntilRef.current) return;

    const list = listRef.current;
    const id = currentIdRef.current;
    if (!list || id === null) return;

    const row = findRow(list, id);
    if (row && isRowVisible(list, row)) {
      // Back near the active sentence: follow again without waiting.
      holdUntilRef.current = 0;
      clearResumeTimer();
      return;
    }

    holdUntilRef.current = Date.now() + FOLLOW_PAUSE_MS;
    clearResumeTimer();
    resumeTimerRef.current = window.setTimeout(() => {
      resumeTimerRef.current = null;
      holdUntilRef.current = 0;
      scrollToCurrent();
    }, FOLLOW_PAUSE_MS);
  }, [active, clearResumeTimer, listRef, scrollToCurrent]);

  return { onScroll };
}
