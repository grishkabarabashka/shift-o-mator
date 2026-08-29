import '@testing-library/jest-dom/vitest';

// NOTE: jsdom doesn't implement APIs the grid's scrolling and Radix rely on.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView ??= function scrollIntoView() {
    // no-op
  };
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// My calendar grows its window when a sentinel scrolls into view. jsdom has no layout, so
// nothing ever intersects — which is the right behaviour here: the tests assert on the
// months that are already there, not on a scroll they cannot perform.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}
