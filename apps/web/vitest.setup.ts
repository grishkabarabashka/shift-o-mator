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

// The header's clock strip and the schedule's issue panel each render a *different*
// control when the viewport is narrow, so they ask `matchMedia` rather than relying on a
// CSS breakpoint. jsdom has no layout and no media engine at all.
//
// It answers `min-width` against jsdom's own `innerWidth` (1024 by default) rather than
// returning a flat false. A flat false claims every viewport is narrow, which silently
// moved the whole suite onto the small-screen layout — the issue panel became a closed
// drawer, and "the issues panel separates gaps from conflicts" failed looking for a panel
// that was not on the page. Answering by width means a test that wants the narrow layout
// gets it by setting `window.innerWidth`, which is the honest lever.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => {
    const minWidth = /min-width:\s*([\d.]+)(rem|px)/.exec(query);
    const matches = minWidth
      ? window.innerWidth >= Number(minWidth[1]) * (minWidth[2] === 'rem' ? 16 : 1)
      : false;

    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}
