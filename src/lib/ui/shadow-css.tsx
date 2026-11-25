/**
 * Compiled content stylesheet for nested shadow roots.
 *
 * The app lives in one body-level shadow root; the quick-toggle cluster is
 * portaled into its own control-bar shadow host. Both roots need the same
 * compiled Tailwind sheet; the `?inline` import only exists in the content
 * entrypoint that calls `mountContentApp`, so the CSS travels through React
 * context instead of being re-imported (or cloned) deeper in the tree.
 */

import { createContext, useContext, type ReactNode } from 'react';

const ShadowCssContext = createContext('');

export function ShadowCssProvider({
  css,
  children,
}: {
  css: string;
  children?: ReactNode;
}) {
  return <ShadowCssContext.Provider value={css}>{children}</ShadowCssContext.Provider>;
}

/** Compiled content stylesheet, or `''` outside a mounted content app. */
export function useShadowCss(): string {
  return useContext(ShadowCssContext);
}
