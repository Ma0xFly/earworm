import { describe, expect, it } from 'vitest';
import * as blurCssModule from './blurCss';
import { BLUR_CSS, buildBlurCss } from './blurCss';

describe('blur stylesheet', () => {
  it('has no nested shadow-root branch', () => {
    expect('NESTED_BLUR_CSS' in blurCssModule).toBe(false);
    expect(BLUR_CSS).not.toContain(':host');
    expect(buildBlurCss()).toBe(BLUR_CSS);
  });

  it('keeps overlay hover/focus reveal and reduced-motion handling', () => {
    expect(BLUR_CSS).toContain('filter: blur(5px)');
    expect(BLUR_CSS).toContain('[data-lang="en"]:hover');
    expect(BLUR_CSS).toContain('[data-lang="en"]:focus-within');
    expect(BLUR_CSS).toContain('[data-lang="zh"]:hover');
    expect(BLUR_CSS).toContain('[data-lang="zh"]:focus-within');
    expect(BLUR_CSS).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
