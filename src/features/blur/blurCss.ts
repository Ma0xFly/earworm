/**
 * Shadow-root stylesheet for independent English / Chinese subtitle blur.
 *
 * The app root mirrors `settings.blur` onto `data-blur-en` / `data-blur-zh`
 * (`"1"` / `"0"`), and overlay text nodes render with `data-lang="en"` /
 * `data-lang="zh"` (T8/T9).
 *
 * The sheet only ever changes `filter`/`transition`: blur does not affect
 * layout, so captions keep their place while blurred. Hovering a blurred line
 * (or focusing a word button inside it) reveals it temporarily; the 120ms
 * transition is disabled under `prefers-reduced-motion`.
 */

/** The body-level shadow-root sheet (flags live on the app root element). */
export function buildBlurCss(): string {
  return `
[data-lang="en"],
[data-lang="zh"] {
  transition: filter 120ms ease;
}

[data-blur-en="1"] [data-lang="en"] {
  filter: blur(5px);
}

[data-blur-zh="1"] [data-lang="zh"] {
  filter: blur(5px);
}

[data-blur-en="1"] [data-lang="en"]:hover,
[data-blur-en="1"] [data-lang="en"]:focus-within,
[data-blur-zh="1"] [data-lang="zh"]:hover,
[data-blur-zh="1"] [data-lang="zh"]:focus-within {
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
