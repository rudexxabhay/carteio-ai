import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are disabled, so Testing Library cannot register its automatic
// afterEach hook. Every render must be unmounted before the next assertion.
afterEach(cleanup);

// These browser observers drive decorative viewport effects. jsdom provides
// no layout/viewport implementation; report a visible, stable test viewport.
if (!globalThis.ResizeObserver) {
  class TestResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, contentRect: target.getBoundingClientRect(), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: TestResizeObserver });
}
if (!globalThis.IntersectionObserver) {
  class TestIntersectionObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      const rect = target.getBoundingClientRect();
      this.callback([{ target, isIntersecting: true, intersectionRatio: 1, boundingClientRect: rect, intersectionRect: rect, rootBounds: null, time: performance.now() }], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: TestIntersectionObserver });
}
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({
    media: query, matches: query.includes('prefers-reduced-motion'), onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  }) });
}

// jsdom 25 has MouseEvent but no PointerEvent. Preserve coordinates and pointer
// identity so drag tests exercise the same event contract as the browser.
if (!globalThis.PointerEvent) {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  Object.defineProperty(globalThis, 'PointerEvent', { configurable: true, value: TestPointerEvent });
}
