/**
 * NOTE: live element width, via `ResizeObserver`.
 *
 * Zoom sets the timeline and grid scale, not a cap on how many days to show
 * (Phase 0 UI review): "Day" should stretch a single day across the whole
 * screen, "Week" a whole week. The coverage strip, the heatmap, and the
 * Overview timeline all reduce to the same question — "how many pixels do I
 * have" — so this is one hook, not a separate `ResizeObserver` per component.
 *
 * WHY: a callback ref, not `useRef` — when the node the ref points at changes
 * (e.g. DateRangeControl expands its panel and React mounts a different
 * `<div>` in that spot of the tree), `useRef` doesn't let the effect notice:
 * it runs once on mount and stays bound to the first node forever, even after
 * that node is removed from the DOM. The observer then silently watches a
 * detached node while `width` freezes at its last known value — exactly the
 * scenario behind "the day strip flickered and vanished" when collapsing or
 * expanding the period panel.
 */

import { useCallback, useRef, useState } from 'react';

export function useElementWidth<T extends HTMLElement>(): readonly [
  (node: T | null) => void,
  number,
] {
  const observerRef = useRef<ResizeObserver>(undefined);
  const [width, setWidth] = useState(0);

  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = undefined;
    if (!node) return;

    setWidth(node.clientWidth);
    // WHY clientWidth and not contentRect.width: contentRect includes the space a
    // vertical scrollbar occupies. Sizing grid columns from it made the sheet about
    // fifteen pixels wider than the room it had, so a view that was meant to fill the
    // screen exactly came up with a small horizontal scrollbar under it — permanently,
    // and for no visible reason.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth((entry.target as HTMLElement).clientWidth);
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  return [ref, width] as const;
}
