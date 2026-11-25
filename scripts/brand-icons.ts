/**
 * Brand icon contract shared by the WXT manifest and its build verifier.
 *
 * WXT's icon auto-discovery only matches `icon-N.png` at the public root; the
 * finalized logo lives under `public/brand/`, so the manifest, the verifier and
 * the web-accessible resource entry all read this one map.
 */
export const BRAND_ICON_FILES: Record<string, string> = {
  '16': 'brand/earworm-icon-16.png',
  '32': 'brand/earworm-icon-32.png',
  '48': 'brand/earworm-icon-48.png',
  '128': 'brand/earworm-icon-128.png',
};

/** The only brand asset the content script loads from a YouTube page. */
export const CONTROL_BAR_ICON = BRAND_ICON_FILES['32']!;
