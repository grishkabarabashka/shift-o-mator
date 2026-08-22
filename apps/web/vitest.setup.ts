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
