import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest globals kapalıyken RTL otomatik temizliği devreye girmez; burada sağlarız.
afterEach(() => {
  cleanup();
});

// jsdom'da bulunmayan ResizeObserver için güvenli stub
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
