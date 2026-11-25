import { afterEach, describe, expect, it } from 'vitest';
import { computeSidebarLayout, readSidebarEnvironment } from './selectors';

function addSecondary(width: number): HTMLElement {
  const secondary = document.createElement('div');
  secondary.id = 'secondary';
  secondary.getBoundingClientRect = () =>
    ({
      x: 1016,
      y: 120,
      top: 120,
      left: 1016,
      right: 1016 + width,
      bottom: 900,
      width,
      height: 780,
    }) as DOMRect;
  document.body.appendChild(secondary);
  return secondary;
}

afterEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => null,
  });
});

describe('readSidebarEnvironment', () => {
  it('exposes only the inputs that decide docked vs drawer', () => {
    addSecondary(400);

    const environment = readSidebarEnvironment(document);

    expect(environment).toEqual({
      hasSecondary: true,
      viewportWidth: window.innerWidth,
      fullscreen: false,
    });
    expect(environment).not.toHaveProperty('theater');
    expect(environment).not.toHaveProperty('secondaryWidth');
  });

  it('ignores the theater class YouTube toggles on the player', () => {
    addSecondary(400);
    const before = readSidebarEnvironment(document);

    const player = document.createElement('div');
    player.id = 'movie_player';
    player.classList.add('ytp-large-width-mode');
    document.body.appendChild(player);

    expect(readSidebarEnvironment(document)).toEqual(before);
  });

  it('treats a hidden (zero-measured) column as absent', () => {
    addSecondary(0);

    expect(readSidebarEnvironment(document)).toEqual({
      hasSecondary: false,
      viewportWidth: window.innerWidth,
      fullscreen: false,
    });
  });

  it('reports fullscreen so the layout can leave the document flow', () => {
    addSecondary(400);
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => document.body,
    });

    expect(readSidebarEnvironment(document).fullscreen).toBe(true);
  });
});

describe('computeSidebarLayout', () => {
  it('docks whenever the column is available and the page is not fullscreen', () => {
    expect(
      computeSidebarLayout({ hasSecondary: true, viewportWidth: 1440, fullscreen: false }).mode,
    ).toBe('docked');
  });

  it('draws a drawer when fullscreen or when the column is unusable', () => {
    expect(
      computeSidebarLayout({ hasSecondary: true, viewportWidth: 1440, fullscreen: true }).mode,
    ).toBe('drawer');
    expect(
      computeSidebarLayout({ hasSecondary: false, viewportWidth: 1440, fullscreen: false }).mode,
    ).toBe('drawer');
  });
});
