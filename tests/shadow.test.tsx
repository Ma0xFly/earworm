import { describe, expect, it } from 'vitest';
import {
  createShadowUi,
  publishPlayerRect,
  readPlayerRect,
  startPlayerRectSync,
} from '@/lib/ui/shadow';

function mountUi(css = '') {
  const ui = createShadowUi({ css });
  ui.mount();
  return ui;
}

describe('shadow DOM host', () => {
  it('mounts one body-level host with the fixed, click-through contract', () => {
    const ui = createShadowUi({ css: '.earworm-test { color: red; }' });
    expect(ui.isMounted()).toBe(false);
    expect(document.body.contains(ui.host)).toBe(false);

    ui.mount();

    expect(ui.isMounted()).toBe(true);
    expect(ui.host.parentElement).toBe(document.body);
    expect(document.querySelectorAll('earworm-root')).toHaveLength(1);
    expect(ui.host.style.getPropertyValue('position')).toBe('fixed');
    expect(ui.host.style.getPropertyValue('pointer-events')).toBe('none');
    expect(ui.host.style.getPropertyValue('z-index')).toBe('2147483000');
    expect(ui.host.style.getPropertyValue('inset')).toBe('0px');
    expect(ui.host.shadowRoot).toBe(ui.shadow);

    ui.unmount();
    expect(ui.isMounted()).toBe(false);
    expect(document.querySelector('earworm-root')).toBeNull();
  });

  it('injects CSS only into the shadow root and leaves the host page alone', () => {
    document.body.style.margin = '8px';
    document.body.style.background = 'rgb(1, 2, 3)';
    const headStylesBefore = document.head.querySelectorAll('style').length;
    const lightDomStylesBefore = document.querySelectorAll('style').length;

    const preflightLikeCss =
      '*, ::before, ::after { box-sizing: border-box; } html, body { margin: 0; padding: 0; }';
    const ui = mountUi(preflightLikeCss);

    // CSS lives in the shadow root, not in document.head.
    expect(ui.styleElement.parentNode).toBe(ui.shadow);
    expect(ui.shadow.querySelector('style')?.textContent).toBe(preflightLikeCss);
    expect(document.head.querySelectorAll('style')).toHaveLength(headStylesBefore);
    expect(document.querySelectorAll('style')).toHaveLength(lightDomStylesBefore);

    // Host page styles are untouched (no preflight reset).
    expect(document.body.style.margin).toBe('8px');
    expect(document.body.style.background).toBe('rgb(1, 2, 3)');

    ui.unmount();
    document.body.style.margin = '';
    document.body.style.background = '';
  });

  it('exposes container and portal nodes inside the shadow root', () => {
    const ui = mountUi();
    expect(ui.shadow.contains(ui.container)).toBe(true);
    expect(ui.shadow.contains(ui.portalContainer)).toBe(true);
    expect(ui.container.hasAttribute('data-earworm-container')).toBe(true);
    expect(ui.portalContainer.hasAttribute('data-earworm-portal')).toBe(true);
    expect(ui.container.parentNode).toBe(ui.shadow);
    expect(ui.portalContainer.parentNode).toBe(ui.shadow);
    ui.unmount();
  });

  it('re-parents into the fullscreen element and back to body', () => {
    const fullscreenElement = document.createElement('div');
    fullscreenElement.id = 'fake-fullscreen';
    document.body.appendChild(fullscreenElement);
    let current: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => current,
    });

    const ui = mountUi();
    expect(ui.host.parentElement).toBe(document.body);

    current = fullscreenElement;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(ui.host.parentElement).toBe(fullscreenElement);

    current = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(ui.host.parentElement).toBe(document.body);

    ui.unmount();
    delete (document as { fullscreenElement?: Element | null }).fullscreenElement;
    fullscreenElement.remove();
  });

  it('publishes player rect CSS variables and cleans up on unmount', () => {
    const player = document.createElement('div');
    player.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 800, height: 450 }) as DOMRect;
    document.body.appendChild(player);

    const ui = mountUi();
    publishPlayerRect(ui.host, readPlayerRect(player));
    expect(ui.host.style.getPropertyValue('--ew-player-left')).toBe('100px');
    expect(ui.host.style.getPropertyValue('--ew-player-top')).toBe('50px');
    expect(ui.host.style.getPropertyValue('--ew-player-width')).toBe('800px');
    expect(ui.host.style.getPropertyValue('--ew-player-height')).toBe('450px');
    expect(ui.host.style.getPropertyValue('--ew-player-right')).toBe('900px');
    expect(ui.host.style.getPropertyValue('--ew-player-bottom')).toBe('500px');

    // Sync path publishes synchronously on the first call.
    const stop = startPlayerRectSync(ui.host, () => player);
    expect(ui.host.style.getPropertyValue('--ew-player-left')).toBe('100px');
    stop();

    publishPlayerRect(ui.host, null);
    expect(ui.host.style.getPropertyValue('--ew-player-left')).toBe('0px');
    expect(ui.host.style.getPropertyValue('--ew-player-width')).toBe('0px');

    ui.unmount();
    player.remove();
  });
});
