import { describe, expect, it } from 'vitest';
import { createShadowUi } from '@/lib/ui/shadow';
import cssText from '@/entrypoints/content/style.css?inline';
import cssSource from '@/entrypoints/content/style.css?raw';

/**
 * Compile-time proof for the highest-risk styling decisions:
 * - Tailwind v4 preflight is NOT included (host-page reset regression guard);
 * - the stylesheet is ordinary CSS text, injected into the shadow root only.
 */
describe('shadow-root stylesheet', () => {
  it('imports theme + utilities but not the preflight-bearing entrypoint', () => {
    expect(cssSource).toContain('tailwindcss/theme.css');
    expect(cssSource).toContain('tailwindcss/utilities.css');
    expect(cssSource).not.toMatch(/@import\s+["']tailwindcss["']/);
    expect(cssSource).not.toContain('tailwindcss/preflight');
  });

  it('compiles the utilities used by the app shell', () => {
    expect(cssText).toContain('.pointer-events-none');
    expect(cssText).toContain('.fixed');
    expect(cssText).toContain('.z-\\[70\\]');
  });

  it('contains no Tailwind preflight reset', () => {
    expect(cssText).not.toContain('-webkit-text-size-adjust');
    expect(cssText).not.toContain('tab-size: 4');
    expect(cssText).not.toContain('abbr:where');
    expect(cssText).not.toMatch(/button,\s*input,\s*optgroup/);
  });

  it('carries the shadow token layer and portal pointer-events rules', () => {
    expect(cssText).toContain('--ew-background');
    expect(cssText).toContain('[data-earworm-portal]');
    expect(cssText).toContain('pointer-events: none');
    expect(cssText).toContain('[data-earworm-portal] > *');
  });

  it('does not contain host-page caption selectors (those live in page-style.ts)', () => {
    expect(cssText).not.toContain('.ytp-caption-window-container');
  });

  it('injecting the real compiled stylesheet does not reset the host page', () => {
    document.body.style.margin = '9px';
    document.body.style.padding = '7px';
    const headStyles = document.head.querySelectorAll('style').length;

    const ui = createShadowUi({ css: cssText });
    ui.mount();

    expect(ui.shadow.querySelector('style')?.textContent).toBe(cssText);
    expect(document.head.querySelectorAll('style')).toHaveLength(headStyles);
    expect(document.body.style.margin).toBe('9px');
    expect(document.body.style.padding).toBe('7px');

    ui.unmount();
  });
});
