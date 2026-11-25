/**
 * Keyboard shortcuts for sentence navigation: a = previous, s = repeat,
 * d = next.
 *
 * Adapted for Earworm (MIT) from Nitrino/easysubs (MIT) — Copyright (c) 2022 Seo Jong Hak.
 * Adapted for Earworm (MIT) from umutgokbulak/SceneLingo (MIT) — Copyright (c) 2026 Umut.
 * Upstream: https://github.com/Nitrino/easysubs and https://github.com/umutgokbulak/SceneLingo
 * (easysubs: typing-target guard and discrete keydown actions; SceneLingo:
 * keyboard registration guards).
 * Full upstream MIT permission texts: see NOTICE.
 *
 * Boundaries: the first sentence clamps `a` to itself, the last sentence
 * clamps `d` to itself (both re-play from the sentence start rather than
 * no-op). `s` always resolves the sentence containing the player time; when
 * the playhead sits in a gap, the session's `currentIndex` is used.
 */

export type ShortcutAction = 'prev' | 'repeat' | 'next';

export type ShortcutSentence = { id: number; start: number; end: number };

export type ShortcutContext = {
  sentences: readonly ShortcutSentence[];
  currentIndex: number;
  time: number;
  seekToSentence: (id: number) => void;
  /** Global master switch; false lets YouTube keep a/s/d. */
  enabled?: boolean;
};

const KEY_ACTIONS: Record<string, ShortcutAction> = {
  a: 'prev',
  s: 'repeat',
  d: 'next',
};

/** Map a (case-insensitive) key to its sentence action. */
export function shortcutActionForKey(key: string): ShortcutAction | null {
  if (!key) return null;
  return KEY_ACTIONS[key.toLowerCase()] ?? null;
}

function nodeElement(node: unknown): Element | null {
  if (!node || typeof node !== 'object') return null;
  const candidate = node as Node;
  return candidate.nodeType === 1 ? (candidate as Element) : null;
}

/**
 * True for the editable controls that must keep their native keys:
 * input/textarea/select, contenteditable (including descendants), and
 * `role="textbox"` (Radix/sidebar search fields).
 */
export function isEditableElement(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((element as HTMLElement).isContentEditable === true) return true;

  const contentEditable = element.getAttribute('contenteditable');
  if (contentEditable !== null && contentEditable.toLowerCase() !== 'false') return true;

  return element.getAttribute('role') === 'textbox';
}

/** Deepest active element, descending into open shadow roots. */
export function deepActiveElement(root: Document | ShadowRoot = document): Element | null {
  let active: Element | null = root.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

function isEditableSubtree(element: Element | null): boolean {
  if (!element) return false;
  if (isEditableElement(element)) return true;
  return Boolean(
    element.closest?.(
      '[contenteditable]:not([contenteditable="false"]), [role="textbox"]',
    ),
  );
}

/**
 * Focus guard based on `composedPath()` as well as `event.target`: events from
 * inside the shadow root are retargeted to the host, so target alone misses a
 * focused input in the sidebar. The deep active element is checked too, for
 * synthetic key events dispatched at `window` while a field has focus.
 */
export function isEditableEventTarget(event: KeyboardEvent): boolean {
  const path =
    typeof event.composedPath === 'function' ? event.composedPath() : [];
  const nodes: readonly unknown[] = path.length > 0 ? path : [event.target];

  for (const node of nodes) {
    const element = nodeElement(node);
    if (isEditableSubtree(element)) return true;
  }

  if (typeof document !== 'undefined') {
    if (isEditableSubtree(deepActiveElement(document))) return true;
  }
  return false;
}

/** IME composition: both the standard flag and the legacy keyCode 229. */
export function isImeComposition(event: KeyboardEvent): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

/** Resolve the sentence that contains `time`, else the session's index. */
export function resolveSentenceIndex(
  sentences: readonly ShortcutSentence[],
  currentIndex: number,
  time: number,
): number {
  if (sentences.length === 0) return -1;

  const byTime = sentences.findIndex(
    (sentence) => time >= sentence.start && time < sentence.end,
  );
  if (byTime >= 0) return byTime;

  const fallback = Number.isInteger(currentIndex) ? currentIndex : 0;
  return Math.min(Math.max(fallback, 0), sentences.length - 1);
}

/** The id a/s/d should seek to, or `null` when there is no sentence. */
export function shortcutTargetId(
  action: ShortcutAction,
  sentences: readonly ShortcutSentence[],
  currentIndex: number,
  time: number,
): number | null {
  const index = resolveSentenceIndex(sentences, currentIndex, time);
  if (index < 0) return null;

  let target = index;
  if (action === 'prev') target = Math.max(0, index - 1);
  else if (action === 'next') target = Math.min(sentences.length - 1, index + 1);

  return sentences[target]?.id ?? null;
}

/**
 * Handle one keyboard event. Returns true when the event was consumed; only
 * then does it prevent the default action so YouTube's own keys stay intact.
 */
export function handleShortcutKey(
  event: KeyboardEvent,
  context: ShortcutContext,
): boolean {
  if (event.type !== 'keydown') return false;
  if (context.enabled === false) return false;
  if (event.defaultPrevented) return false;
  if (isImeComposition(event)) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.repeat) return false;

  const action = shortcutActionForKey(event.key);
  if (!action) return false;
  if (context.sentences.length === 0) return false;
  if (isEditableEventTarget(event)) return false;

  const id = shortcutTargetId(
    action,
    context.sentences,
    context.currentIndex,
    context.time,
  );
  if (id === null) return false;

  event.preventDefault();
  // Stop the event before YouTube's bubble-phase player shortcuts see it.
  event.stopPropagation();
  context.seekToSentence(id);
  return true;
}
