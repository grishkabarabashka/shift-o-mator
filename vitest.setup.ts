import '@testing-library/jest-dom/vitest';

// jsdom не реализует то, чем пользуются прокрутка сетки и Radix.
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
