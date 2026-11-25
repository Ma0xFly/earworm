import { afterEach, describe, expect, it } from 'vitest';
import { createSidebarHost, SIDEBAR_HOST_TAG } from './host';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createSidebarHost', () => {
  it('exposes only the host, portal container and lifecycle methods', () => {
    const sidebar = createSidebarHost({ css: '/* test css */' });
    try {
      expect(Object.keys(sidebar).sort()).toEqual([
        'attach',
        'container',
        'destroy',
        'detach',
        'host',
      ]);
      expect(sidebar.host.tagName.toLowerCase()).toBe(SIDEBAR_HOST_TAG);
      expect(sidebar.container.parentNode).toBe(sidebar.host.shadowRoot);
      expect(sidebar.host.shadowRoot?.querySelector('style')?.textContent).toContain(
        '/* test css */',
      );
    } finally {
      sidebar.destroy();
    }
  });
});
