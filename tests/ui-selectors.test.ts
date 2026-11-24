import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPTION_SELECTOR,
  CAPTION_TEXT_SELECTOR,
  PAGE_SELECTORS,
  PLAYER_DOM_ID,
  findCaptionElements,
  findPlayerElement,
  findSidebarPlayer,
  firstMatch,
} from '@/lib/ui/selectors';

afterEach(() => {
  document.body.innerHTML = '';
});

function append<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (attributes.id) element.id = attributes.id;
  if (attributes.class) element.className = attributes.class;
  document.body.appendChild(element);
  return element;
}

describe('page selector map', () => {
  it('names the players and controls exactly once', () => {
    expect(PLAYER_DOM_ID).toEqual({ movie: 'movie_player', shorts: 'shorts-player' });
    expect(PAGE_SELECTORS.moviePlayer).toBe('#movie_player');
    expect(PAGE_SELECTORS.shortsPlayer).toBe('#shorts-player');
    expect(PAGE_SELECTORS.html5Video).toBe('video.html5-main-video');
    expect(PAGE_SELECTORS.html5VideoPlayer).toBe('.html5-video-player');
    expect(PAGE_SELECTORS.video).toBe('video');
    expect(PAGE_SELECTORS.controlBar).toBe('.ytp-chrome-bottom');
    expect(PAGE_SELECTORS.subtitlesButton).toBe('.ytp-subtitles-button');
    expect(PAGE_SELECTORS.secondary).toBe('#secondary');
    expect(PAGE_SELECTORS.secondaryInner).toBe('#secondary-inner');
  });

  it('exposes combined caption selectors for styling and scraping', () => {
    expect(CAPTION_SELECTOR).toBe('.ytp-caption-window-container, .caption-window');
    expect(CAPTION_TEXT_SELECTOR).toBe('.ytp-caption-segment, .caption-window');
  });
});

describe('selector lookup helpers', () => {
  it('returns the first match in order, or null', () => {
    expect(firstMatch(document, ['#missing', PAGE_SELECTORS.video])).toBeNull();
    const video = append('video');
    expect(firstMatch(document, ['#missing', PAGE_SELECTORS.video])).toBe(video);
  });

  it('prefers the movie player, then the Shorts player, then video', () => {
    const video = append('video', { class: 'html5-main-video' });
    expect(findPlayerElement(document)).toBe(video);

    const shorts = append('div', { id: 'shorts-player' });
    expect(findPlayerElement(document)).toBe(shorts);

    const movie = append('div', { id: 'movie_player' });
    expect(findPlayerElement(document)).toBe(movie);
  });

  it('keeps the sidebar player preference order (no Shorts shell)', () => {
    const video = append('video');
    expect(findSidebarPlayer(document)).toBe(video);

    const playerClass = append('div', { class: 'html5-video-player' });
    expect(findSidebarPlayer(document)).toBe(playerClass);

    const movie = append('div', { id: 'movie_player' });
    expect(findSidebarPlayer(document)).toBe(movie);

    // A Shorts shell alone is not what the watch-page sidebar measures.
    document.body.innerHTML = '';
    append('div', { id: 'shorts-player' });
    expect(findSidebarPlayer(document)).toBeNull();
  });

  it('finds every caption layer node', () => {
    const container = append('div', { class: 'ytp-caption-window-container' });
    const window = append('div', { class: 'caption-window' });
    append('div', { class: 'not-a-caption' });
    expect(findCaptionElements(document)).toEqual([container, window]);
    expect(findCaptionElements(document)).toHaveLength(2);
  });
});
