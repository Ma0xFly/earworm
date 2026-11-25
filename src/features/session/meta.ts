/**
 * Watch-page video metadata (title + channel) for the LLM translation prompt.
 *
 * YouTube's watch page has been re-skinned several times; the selectors are
 * centralized here so a future DOM change is a one-file fix. Every lookup has
 * a fallback: the document title and the `author`/`itemprop` metadata tags are
 * updated by YouTube even when the modern watch-metadata elements are missing.
 *
 * The extractor never throws: a missing title/channel degrades to an empty
 * string so the session still translates with no context.
 */

import type { VideoMeta } from '@/lib/contracts';

/** Ordered selectors; the first element with non-empty text wins. */
export const WATCH_META_SELECTORS = {
  title: [
    'h1.ytd-watch-metadata yt-formatted-string',
    'h1.ytd-watch-metadata',
    '#title h1 yt-formatted-string',
    '#title h1',
    'ytd-video-primary-info-renderer h1 yt-formatted-string',
    'ytd-video-primary-info-renderer h1',
  ],
  channel: [
    '#owner #channel-name a',
    '#owner ytd-channel-name a',
    'ytd-video-owner-renderer #channel-name a',
    'ytd-video-owner-renderer ytd-channel-name a',
    'ytd-channel-name a',
    '#channel-name a',
    'ytd-channel-name',
  ],
} as const;

/** Metadata tags that still carry the authoritative title/channel. */
export const WATCH_META_META = {
  title: ['meta[name="title"]'],
  channel: [
    'meta[name="author"]',
    'link[itemprop="name"]',
    'meta[itemprop="author"]',
  ],
} as const;

function collapse(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function firstText(doc: Document, selectors: readonly string[]): string {
  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    if (!element) continue;
    const text = collapse(element.textContent);
    if (text) return text;
  }
  return '';
}

function metaContent(doc: Document, selector: string): string {
  const element = doc.querySelector(selector);
  if (!element) return '';
  return collapse(
    element.getAttribute('content') ?? element.getAttribute('href') ?? element.textContent,
  );
}

function firstMeta(doc: Document, selectors: readonly string[]): string {
  for (const selector of selectors) {
    const text = metaContent(doc, selector);
    if (text) return text;
  }
  return '';
}

/** `Some video - YouTube` -> `Some video`; anything else is returned as-is. */
function titleFromDocument(doc: Document): string {
  return collapse(doc.title.replace(/\s+-\s+YouTube\s*$/i, ''));
}

/** Extract the harmless subset of watch-page metadata the prompt needs. */
export function readVideoMeta(videoId: string, doc: Document = document): VideoMeta {
  return {
    videoId,
    title: firstText(doc, WATCH_META_SELECTORS.title) || firstMeta(doc, WATCH_META_META.title) || titleFromDocument(doc),
    channel: firstText(doc, WATCH_META_SELECTORS.channel) || firstMeta(doc, WATCH_META_META.channel),
  };
}
