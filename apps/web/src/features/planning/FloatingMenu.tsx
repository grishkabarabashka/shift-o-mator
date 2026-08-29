/**
 * The shell every grid context menu shares: pinned to a screen point, flipped at the
 * edge, dismissed by click-outside, Escape, resize or scroll.
 *
 * It exists because the day menu needed the same behaviour as the cell picker, and the
 * dismiss rules are the half that goes wrong quietly when it is copied — a menu that
 * survives a scroll points at the wrong date.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const MARGIN = 8;

/** Below this the menu is not worth flipping for — it scrolls instead. */
const MIN_HEIGHT = 180;

export function FloatingMenu({
  x,
  y,
  anchorKey,
  label,
  width,
  onClose,
  children,
}: {
  readonly x: number;
  readonly y: number;
  /** Changing this re-runs the edge flip and moves focus — one menu, many targets. */
  readonly anchorKey: string;
  readonly label: string;
  readonly width: number;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // How tall the menu may be *here*: the distance to the bottom of the window from where
  // it ends up, never less than a usable minimum. A fixed 70vh let a long shift list run
  // off the bottom of a short window with no way to reach the end of it.
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  // The flip is computed after mount: before the real height is measured, any estimate
  // of it would be a lie.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const top =
      y + box.height + MARGIN > window.innerHeight
        ? Math.max(MARGIN, window.innerHeight - box.height - MARGIN)
        : y;
    setPos({
      left: x + box.width + MARGIN > window.innerWidth ? Math.max(MARGIN, x - box.width) : x,
      top,
    });
    setMaxHeight(Math.max(MIN_HEIGHT, window.innerHeight - top - MARGIN));
  }, [x, y, anchorKey]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    // A scroll *outside* the menu moves what it points at, so it closes. A scroll
    // **inside** it is somebody reading a long list of shifts — and because the listener
    // captures, that was closing the menu on the first wheel tick, which is why a menu
    // taller than the window could not be reached the end of.
    const onScroll = (event: Event) => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.menu-item:not(:disabled)')?.focus();
  }, [anchorKey]);

  return createPortal(
    <div
      ref={ref}
      className="popover fixed overflow-y-auto overscroll-contain"
      style={{ left: pos.left, top: pos.top, width, maxHeight }}
      role="menu"
      aria-label={label}
    >
      {children}
    </div>,
    document.body,
  );
}
