/**
 * Whether the data on hand is for the period this screen is asking about.
 *
 * WHY it takes the expected range as an argument rather than reading `useUi.range`
 * itself: `range` is written by a **layout effect** on mount (`enterSchedule` /
 * `enterOverview`), which runs after the first render, not before it. On that first
 * render `useUi.range` is still whichever screen you came from — so comparing against it
 * produced a false "settled" the moment the leftover range happened to equal
 * `useSchedule.range` (which is *also* still the previous screen's), and the guard never
 * caught the one frame it exists to catch. Each screen already knows its own target range
 * from state that does not have this lag (`schedule.zoom` + `schedule.anchor`, or
 * `overview.span` + `overview.anchor`), so it computes `expected` fresh on every render
 * and hands it in.
 *
 * WHY it only guards the **first** true match: after the screen has settled once, showing
 * the previous period while the next one loads is exactly right — that is what
 * `keepPreviousData` on the schedule query is for, and blanking the grid on every press
 * of an arrow would be far worse than the flash this removes.
 */

import { useRef } from 'react';
import { useSchedule } from '../../store/useSchedule.ts';
import type { DateRange } from '../../domain/types.ts';

export function useRangeSettled(expected: DateRange): boolean {
  const loaded = useSchedule((s) => s.range);
  const everSettled = useRef(false);

  if (loaded && loaded.from === expected.from && loaded.to === expected.to) {
    everSettled.current = true;
  }

  return everSettled.current;
}
