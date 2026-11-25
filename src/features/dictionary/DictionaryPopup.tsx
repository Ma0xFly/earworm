/**
 * Click-a-word dictionary popup (F4).
 *
 * The popup is mounted once by `ContentApp`. Because `Overlay` does not pass a
 * word-click prop, this component owns the trigger itself through **event
 * delegation**:
 *
 * - a capture listener on `document` inspects `event.composedPath()` for the
 *   nearest `[data-word]`;
 * - the enclosing sentence comes from the nearest `[data-sentence-id]` node,
 *   falling back to `session.state.sentences[currentIndex]`;
 * - `data-offset` resolves the containing `CollocationSpan` (LLM span first);
 * - `lookupWord(surface)` loads the ECDICT entry, memoized per surface;
 * - the card renders through `usePortalContainer()` into the T1 shadow root,
 *   never `document.body`.
 *
 * When a word is hit the click is stopped in the capture phase so YouTube's
 * player handlers cannot consume it. Clicks inside the popup are isolated the
 * same way.
 *
 * `openWord()` is the programmatic entry point for tests and the playground.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { CollocationSpan, LearningSentence, WordEntry } from '@/lib/contracts';
import { lookupWord } from '@/lib/dict';
import type { SessionState } from '@/features/session';
import { useSession } from '@/features/session';
import { usePortalContainer } from '@/lib/ui/portal';
import { getPlayerElement } from '@/lib/ui/shadow';
import { DictionaryCard, type DictionaryLookupView } from './DictionaryCard';
import { findCollocationAtOffset } from './selection';
import {
  computePopupPosition,
  type PopupRect,
  type PopupSize,
  type PopupViewport,
} from './position';

const ZERO_RECT: PopupRect = { left: 0, top: 0, width: 0, height: 0 };
const ZERO_SIZE: PopupSize = { width: 0, height: 0 };

/** Card width before measurement; the max width comes from the position clamp. */
const CARD_WIDTH_PX = 340;

/** Upper bound for the per-mount surface cache (a long video can click a lot). */
const LOOKUP_CACHE_LIMIT = 200;

type LookupStatus = 'loading' | 'ready' | 'miss';

type PopupLookup = {
  requestId: number;
  surface: string;
  anchor: PopupRect;
  viewport: PopupViewport;
  player: PopupRect | null;
  span: CollocationSpan | null;
  status: LookupStatus;
  entry: WordEntry | null;
};

export type OpenWordRequest = {
  surface: string;
  anchor: PopupRect;
  /** UTF-16 offset of the clicked word inside the sentence, when known. */
  offset?: number;
  sentence?: LearningSentence | null;
};

type PopupController = {
  open: (request: OpenWordRequest) => void;
  close: () => void;
};

/** Mounted popup controller; module-level so `openWord()` can reach it. */
let controller: PopupController | null = null;
/** A programmatic open requested before the popup mounted. */
let pendingRequest: OpenWordRequest | null = null;
/** Latest session state, used by the imperative `openWord()` helper. */
let latestSessionState: SessionState | null = null;

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function readBounds(element: Element | null): PopupRect {
  if (!element) return ZERO_RECT;
  const rect = element.getBoundingClientRect();
  return {
    left: finite(rect.left),
    top: finite(rect.top),
    width: Math.max(0, finite(rect.width)),
    height: Math.max(0, finite(rect.height)),
  };
}

function readViewport(): PopupViewport {
  return {
    width: Math.max(0, finite(window.innerWidth)),
    height: Math.max(0, finite(window.innerHeight)),
  };
}

function readPlayerRect(): PopupRect | null {
  const player = getPlayerElement();
  return player ? readBounds(player) : null;
}

function readOffset(element: Element | null): number | undefined {
  const raw =
    element instanceof HTMLElement
      ? element.dataset.offset
      : element?.getAttribute('data-offset');
  if (raw === undefined || raw === null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Nearest `[data-sentence-id]` row sentence, else the current overlay sentence. */
function resolveSentenceForElement(element: Element | null): LearningSentence | null {
  const state = latestSessionState;
  if (!state) return null;

  const row = element?.closest('[data-sentence-id]') ?? null;
  const rowId = row ? Number(row.getAttribute('data-sentence-id')) : Number.NaN;
  if (Number.isFinite(rowId)) {
    const sentence = state.sentences.find((candidate) => candidate.id === rowId);
    if (sentence) return sentence;
  }
  return state.sentences[state.currentIndex] ?? null;
}

function findWordElement(path: readonly EventTarget[]): Element | null {
  for (const node of path) {
    if (node instanceof Element && node.hasAttribute('data-word')) return node;
  }
  return null;
}

/**
 * Open the dictionary for a word programmatically (tests, playground, future
 * other triggers). `element` supplies the anchor rect and, when present, the
 * enclosing sentence node / `data-offset`; `sentence` overrides that lookup.
 */
export function openWord(
  word: string,
  element: Element | null,
  sentence?: LearningSentence,
): void {
  const surface = (word || element?.getAttribute('data-word') || element?.textContent || '').trim();
  if (!surface) return;

  const request: OpenWordRequest = {
    surface,
    anchor: readBounds(element),
    offset: readOffset(element),
    sentence: sentence ?? resolveSentenceForElement(element),
  };

  if (controller) controller.open(request);
  else pendingRequest = request;
}

/** Close the popup if it is open (also used by tests and the playground). */
export function closeDictionaryPopup(): void {
  pendingRequest = null;
  controller?.close();
}

function stopPlayerEvent(event: SyntheticEvent): void {
  event.stopPropagation();
}

function PopupShell({
  lookup,
  size,
  rootRef,
  onClose,
}: {
  lookup: PopupLookup;
  size: PopupSize;
  rootRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const position = computePopupPosition({
    anchor: lookup.anchor,
    popup: size,
    viewport: lookup.viewport,
    player: lookup.player,
  });

  const view: DictionaryLookupView = {
    surface: lookup.surface,
    status: lookup.status,
    entry: lookup.entry,
    span: lookup.span,
  };

  return (
    <div
      ref={rootRef}
      data-earworm-dictionary
      data-state={lookup.status}
      data-placement={position.placement}
      role="dialog"
      aria-label="词典弹窗"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        width: Math.max(0, Math.min(CARD_WIDTH_PX, position.maxWidth)),
        maxWidth: position.maxWidth,
        maxHeight: position.maxHeight,
        zIndex: 80,
      }}
      className="pointer-events-auto dark rounded-lg border border-violet-6 bg-popover text-popover-foreground shadow-xl"
      onPointerDown={stopPlayerEvent}
      onMouseDown={stopPlayerEvent}
      onClick={stopPlayerEvent}
      onDoubleClick={stopPlayerEvent}
      onContextMenu={stopPlayerEvent}
      onWheel={stopPlayerEvent}
      onKeyDown={stopPlayerEvent}
      onKeyUp={stopPlayerEvent}
    >
      <DictionaryCard view={view} onClose={onClose} />
    </div>
  );
}

/**
 * Dictionary popup mounted by `ContentApp`.
 *
 * State lives here so only one card can be open at a time; outside click,
 * Escape, scroll, resize, fullscreen and YouTube SPA navigation close it.
 */
export function DictionaryPopup(): ReactElement | null {
  const session = useSession();
  const popupRef = useRef<HTMLDivElement | null>(null);
  const cacheRef = useRef(new Map<string, Promise<WordEntry | null>>());
  const requestIdRef = useRef(0);
  const [lookup, setLookup] = useState<PopupLookup | null>(null);
  const [size, setSize] = useState<PopupSize>(ZERO_SIZE);
  const portalContainer = usePortalContainer();

  useEffect(() => {
    latestSessionState = session.state;
  }, [session]);

  /** Look up a surface once; failed loads resolve to `null` and are cached. */
  const lookupSurface = useCallback((surface: string): Promise<WordEntry | null> => {
    const key = surface.trim().toLowerCase();
    const cached = cacheRef.current.get(key);
    if (cached) return cached;
    if (cacheRef.current.size >= LOOKUP_CACHE_LIMIT) {
      const oldest = cacheRef.current.keys().next();
      if (!oldest.done) cacheRef.current.delete(oldest.value);
    }
    const promise = lookupWord(surface).catch(() => null);
    cacheRef.current.set(key, promise);
    return promise;
  }, []);

  const close = useCallback((): void => {
    requestIdRef.current += 1;
    setLookup(null);
  }, []);

  const openRequest = useCallback(
    (request: OpenWordRequest): void => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      const sentence = request.sentence ?? null;
      const span =
        sentence && request.offset !== undefined
          ? findCollocationAtOffset(sentence.cols, request.offset)
          : null;

      setSize(ZERO_SIZE);
      setLookup({
        requestId,
        surface: request.surface,
        anchor: request.anchor,
        viewport: readViewport(),
        player: readPlayerRect(),
        span,
        status: 'loading',
        entry: null,
      });

      void lookupSurface(request.surface).then((entry) => {
        if (requestIdRef.current !== requestId) return;
        setLookup((current) => {
          if (!current || current.requestId !== requestId) return current;
          return { ...current, status: entry ? 'ready' : 'miss', entry };
        });
      });
    },
    [lookupSurface],
  );

  // Register the imperative API and flush an open requested before mount.
  useEffect(() => {
    const registered: PopupController = { open: openRequest, close };
    controller = registered;
    if (pendingRequest) {
      const queued = pendingRequest;
      pendingRequest = null;
      openRequest(queued);
    }
    return () => {
      if (controller === registered) controller = null;
      requestIdRef.current += 1;
      cacheRef.current.clear();
    };
  }, [openRequest, close]);

  // Trigger (event delegation) + dismissal listeners.
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      const path = event.composedPath?.() ?? [];
      if (popupRef.current && path.includes(popupRef.current)) return;

      const word = findWordElement(path);
      if (word) {
        const surface =
          word.getAttribute('data-word')?.trim() || word.textContent?.trim() || '';
        if (!surface) return;

        // Keep YouTube's player handler from consuming the click. The card is
        // opened from the capture phase, so the target never sees it.
        event.preventDefault();
        event.stopPropagation();
        openRequest({
          surface,
          anchor: readBounds(word),
          offset: readOffset(word),
          sentence: resolveSentenceForElement(word),
        });
        return;
      }

      if (popupRef.current) close();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' && event.key !== 'Esc') return;
      if (!popupRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };

    const onScroll = (event: Event): void => {
      if (!popupRef.current) return;
      const path = event.composedPath?.() ?? [];
      // Scrolling the translation list inside the card is not a dismissal.
      if (path.includes(popupRef.current)) return;
      close();
    };

    const onLayoutChange = (): void => {
      if (popupRef.current) close();
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onLayoutChange);
    document.addEventListener('fullscreenchange', onLayoutChange);
    document.addEventListener('yt-navigate-finish', onLayoutChange);
    document.addEventListener('yt-page-data-updated', onLayoutChange);

    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onLayoutChange);
      document.removeEventListener('fullscreenchange', onLayoutChange);
      document.removeEventListener('yt-navigate-finish', onLayoutChange);
      document.removeEventListener('yt-page-data-updated', onLayoutChange);
    };
  }, [close, openRequest]);

  // Measure after content changes so the clamp/flip uses the real card size.
  useLayoutEffect(() => {
    const node = popupRef.current;
    if (!node) return;
    const measured = node.getBoundingClientRect();
    const width = Math.max(0, Math.round(measured.width));
    const height = Math.max(0, Math.round(measured.height));
    setSize((previous) =>
      previous.width === width && previous.height === height
        ? previous
        : { width, height },
    );
  }, [lookup]);

  if (!lookup) return null;

  const shell = (
    <PopupShell
      lookup={lookup}
      size={size}
      rootRef={popupRef}
      onClose={close}
    />
  );

  return portalContainer ? createPortal(shell, portalContainer) : shell;
}
