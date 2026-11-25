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
    // The floating blur pill's `z-[65]` was removed with v1.1's quick menu;
    // the menu surface (popover) now supplies `z-50`.
    expect(cssText).toContain('.z-50');
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

  it('ships the scoped base layer preflight would otherwise provide', () => {
    // Tailwind preflight is off, so the shadow sheet itself must restore
    // border-box sizing and drop the UA border/background for form controls.
    expect(cssText).toMatch(
      /\*,\s*::before,\s*::after\s*\{[^}]*box-sizing:\s*border-box/,
    );
    expect(cssText).toMatch(
      /button,\s*input,\s*select,\s*textarea\s*\{[^}]*border:\s*0 solid[^}]*background:\s*transparent/,
    );

    // Host-page state that the reset must never touch.
    document.body.style.margin = '9px';
    document.body.style.border = '3px solid rgb(1, 2, 3)';

    const ui = createShadowUi({ css: cssText });
    ui.mount();

    const button = document.createElement('button');
    button.textContent = 'control';
    ui.container.appendChild(button);

    // The reset wins over the UA control styles inside the shadow tree...
    expect(getComputedStyle(button).boxSizing).toBe('border-box');
    expect(getComputedStyle(button).borderTopWidth).toBe('0px');
    expect(getComputedStyle(button).backgroundColor).toBe('transparent');

    // ...and stops at the shadow boundary: YouTube keeps its own control reset.
    expect(document.body.style.margin).toBe('9px');
    expect(document.body.style.border).toBe('3px solid rgb(1, 2, 3)');
    expect(getComputedStyle(document.body).borderTopWidth).toBe('3px');

    ui.unmount();
    document.body.style.margin = '';
    document.body.style.border = '';
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
