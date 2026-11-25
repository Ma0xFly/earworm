import { describe, expect, it } from 'vitest';
import { createShadowUi } from '@/lib/ui/shadow';
import cssText from '@/entrypoints/content/style.css?inline';
import cssSource from '@/entrypoints/content/style.css?raw';
import optionsCssSource from '@/entrypoints/options/style.css?raw';

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
    expect(cssText).toContain('.z-\\[65\\]');
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

  it('ships the full Reactor Violet palette in light and dark', () => {
    const css = cssText.toLowerCase();

    // Spec §3 key steps: violet1 background, violet3/4 accent, violet6 border,
    // violet8 ring, violet9 primary, violet11 collocation, violet12 body text.
    expect(css).toMatch(/--ew-background:\s*#fdfcfe/);
    expect(css).toMatch(/--ew-primary:\s*#6e56cf/);
    expect(css).toMatch(/--ew-ring:\s*#aa99ec/);
    expect(css).toMatch(/--ew-collocation:\s*#6550b9/);
    for (let step = 1; step <= 12; step += 1) {
      expect(css).toContain(`--ew-violet-${step}:`);
    }

    // Forced-dark surface (the overlay and the portaled popup) overrides every
    // semantic token, including the dark collocation violet.
    expect(css).toMatch(/\.dark[^{]*\{[^}]*--ew-background:\s*#14121f/);
    expect(css).toMatch(/\.dark[^{]*\{[^}]*--ew-popover:\s*#1b1525/);
    expect(css).toMatch(/\.dark[^{]*\{[^}]*--ew-border:\s*#473876/);
    expect(css).toMatch(/\.dark[^{]*\{[^}]*--ew-ring:\s*#6958ad/);
    expect(css).toMatch(/\.dark[^{]*\{[^}]*--ew-collocation:\s*#baa7ff/);
    for (let step = 1; step <= 12; step += 1) {
      expect(css).toContain(`--ew-violet-${step}: #`);
    }
  });

  it('generates a collocation text utility and a class-driven dark variant', () => {
    expect(cssText).toContain('--color-collocation: var(--ew-collocation)');
    expect(cssText).toContain('.text-collocation');
    expect(cssSource).toContain('@custom-variant dark');
  });

  it('lets the options page follow the system theme', () => {
    expect(optionsCssSource).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
    expect(optionsCssSource).toMatch(/--ew-collocation:\s*#6550B9/);
    expect(optionsCssSource).toMatch(/--ew-collocation:\s*#BAA7FF/);
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
