import { webcrypto } from 'node:crypto';
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { installChromeMock, resetChromeMock } from './mocks/chrome';

// happy-dom does not always expose SubtleCrypto; the extension uses WebCrypto
// in the browser, so tests run against Node's implementation.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
}

// Radix/Floating UI uses ResizeObserver; happy-dom 21 does not ship one.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: ResizeObserverMock,
  });
}

// React 19 requires this flag for `act()` outside @testing-library's own setup.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installChromeMock();

beforeEach(() => {
  resetChromeMock();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('data-earworm-active');
});
