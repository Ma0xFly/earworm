/**
 * Shadow-root stylesheet for independent English / Chinese subtitle blur.
 *
 * The main content root mirrors `settings.blur` onto `data-blur-en` /
 * `data-blur-zh` (`"1"` / `"0"`); the docked sidebar lives in a nested shadow
 * root, so its host element carries the same flags and the sheet is emitted
 * with a `:host(...)` prefix for that root. Overlay and sidebar text nodes
 * render with `data-lang="en"` / `data-lang="zh"` (T8/T9).
 *
 * The sheet only ever changes `filter`/`transition`: blur does not affect
 * layout, so captions keep their place while blurred. Hovering a blurred line
 * (or focusing a word button inside it) reveals it temporarily; the 120ms
 * transition is disabled under `prefers-reduced-motion`.
 */

/**
 * Build the blur sheet.
 *
 * @param hostPrefix `''` for the body-level root; `':host'` for a nested shadow
 *   root whose blur flags live on the host element itself.
 */
export function buildBlurCss(hostPrefix = ''): string {
  // `:host(...)` is the functional pseudo-class form browsers document for
  // matching the shadow host's attributes; the plain root sheet keeps the
  // attribute selectors used by the body-level app root.
  const en = hostPrefix
    ? `${hostPrefix}([data-blur-en="1"])`
    : '[data-blur-en="1"]';
  const zh = hostPrefix
    ? `${hostPrefix}([data-blur-zh="1"])`
    : '[data-blur-zh="1"]';
  return `
[data-lang="en"],
[data-lang="zh"] {
  transition: filter 120ms ease;
}

${en} [data-lang="en"] {
  filter: blur(5px);
}

${zh} [data-lang="zh"] {
  filter: blur(5px);
}

${en} [data-lang="en"]:hover,
${en} [data-lang="en"]:focus-within,
${zh} [data-lang="zh"]:hover,
${zh} [data-lang="zh"]:focus-within {
  filter: none;
}

@media (prefers-reduced-motion: reduce) {
  [data-lang="en"],
  [data-lang="zh"] {
    transition: none;
  }
}
`;
}

/** Body-level shadow-root sheet (flags on the app root element). */
export const BLUR_CSS = buildBlurCss();

/** Nested shadow-root sheet (flags on the shadow host element). */
export const NESTED_BLUR_CSS = buildBlurCss(':host');
