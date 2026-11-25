import { afterEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import {
  createQuickToggleHost,
  QUICK_TOGGLE_HOST_TAG,
  startQuickToggleHostLifecycle,
} from './host';

function buildControlBar(): { bar: HTMLElement; cc: HTMLButtonElement } {
  const player = document.createElement('div');
  player.id = 'movie_player';

  const bar = document.createElement('div');
  bar.className = 'ytp-chrome-bottom';

  const right = document.createElement('div');
  right.className = 'ytp-right-controls';

  const cc = document.createElement('button');
  cc.className = 'ytp-subtitles-button';
  const fullscreen = document.createElement('button');
  fullscreen.className = 'ytp-fullscreen-button';
  right.append(cc, fullscreen);

  bar.appendChild(right);
  player.appendChild(bar);
  document.body.appendChild(player);
  return { bar, cc };
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  document.body.innerHTML = '';
});

describe('quick-toggle control-bar host', () => {
  it('owns one nested shadow root with the compiled stylesheet', () => {
    const toggle = createQuickToggleHost({ css: '/* quick css */' });
    cleanups.push(toggle.destroy);

    expect(toggle.host.tagName.toLowerCase()).toBe(QUICK_TOGGLE_HOST_TAG);
    expect(toggle.host.shadowRoot).not.toBeNull();
    expect(toggle.container.parentNode).toBe(toggle.host.shadowRoot);
    expect(toggle.host.shadowRoot?.querySelector('style')?.textContent).toContain(
      '/* quick css */',
    );
    expect(Object.keys(toggle).sort()).toEqual([
      'attach',
      'container',
      'destroy',
      'detach',
      'host',
    ]);
  });

  it('inserts immediately before the CC button, never beside fullscreen', () => {
    const { cc } = buildControlBar();
    const toggle = createQuickToggleHost({ css: '' });
    cleanups.push(toggle.destroy);

    expect(toggle.attach()).toBe(true);
    expect(cc.previousElementSibling).toBe(toggle.host);
    expect(cc.parentElement?.lastElementChild).not.toBe(toggle.host);

    toggle.attach();
    expect(cc.parentElement?.children).toHaveLength(3);
  });

  it('re-attaches the same host after a SPA player rebuild', async () => {
    buildControlBar();
    const toggle = createQuickToggleHost({ css: '' });
    cleanups.push(toggle.destroy);
    cleanups.push(startQuickToggleHostLifecycle(toggle));
    expect(toggle.attach()).toBe(true);
    const host = toggle.host;

    document.querySelector('#movie_player')?.remove();
    const { cc } = buildControlBar();
    await actNavigate();

    await waitFor(() => expect(cc.previousElementSibling).toBe(host));
    expect(toggle.host).toBe(host);
    expect(host.shadowRoot?.querySelector('style')).not.toBeNull();
  });

  it('follows a replaced control bar through a scoped mutation', async () => {
    const { bar } = buildControlBar();
    const toggle = createQuickToggleHost({ css: '' });
    cleanups.push(toggle.destroy);
    cleanups.push(startQuickToggleHostLifecycle(toggle));
    expect(toggle.attach()).toBe(true);

    const replacement = document.createElement('div');
    replacement.className = 'ytp-chrome-bottom';
    const right = document.createElement('div');
    right.className = 'ytp-right-controls';
    const cc = document.createElement('button');
    cc.className = 'ytp-subtitles-button';
    right.appendChild(cc);
    replacement.appendChild(right);
    bar.replaceWith(replacement);

    await waitFor(() => expect(cc.previousElementSibling).toBe(toggle.host));
  });

  it('detaches when there is no control bar and reattaches when it appears', async () => {
    const toggle = createQuickToggleHost({ css: '' });
    cleanups.push(toggle.destroy);
    cleanups.push(startQuickToggleHostLifecycle(toggle));

    expect(toggle.attach()).toBe(false);
    expect(toggle.host.isConnected).toBe(false);

    const { cc } = buildControlBar();
    await actNavigate();
    await waitFor(() => expect(cc.previousElementSibling).toBe(toggle.host));
  });
});

async function actNavigate(): Promise<void> {
  document.dispatchEvent(new Event('yt-navigate-finish'));
  await Promise.resolve();
}
