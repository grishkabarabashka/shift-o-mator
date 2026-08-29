/**
 * NOTE: a live boolean for a CSS media query (ADR-0057).
 *
 * WHY a hook and not a Tailwind breakpoint: `hidden lg:flex` is the right tool when the
 * narrow answer is "show less of the same thing". It is the wrong tool when the narrow
 * answer is a *different control* — the header's clock strip becomes one clock plus a
 * popover, and the issue panel becomes an overlay. Rendering both and hiding one with CSS
 * would mount two of each, which for the issue panel means two subscriptions and two
 * scroll positions fighting over the same state.
 *
 * The whole of this product's previous responsive behaviour was four `hidden … lg:` classes
 * that removed controls — including the display-timezone picker, which the header itself
 * documents as governing time across every screen. Hiding a control is not a small-screen
 * design; it is the absence of one.
 */

import { useEffect, useState } from 'react';

/** Matches Tailwind's own breakpoints, so CSS and TypeScript agree about "narrow". */
export const BREAKPOINT = {
  sm: '(min-width: 40rem)',
  md: '(min-width: 48rem)',
  lg: '(min-width: 64rem)',
  xl: '(min-width: 80rem)',
} as const;

export function useMediaQuery(query: string): boolean {
  // WHY the initial read happens in the initialiser rather than in an effect: reading it
  // after mount renders one frame at the wrong layout, and on the header that frame is a
  // visible jump from one clock to four.
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
