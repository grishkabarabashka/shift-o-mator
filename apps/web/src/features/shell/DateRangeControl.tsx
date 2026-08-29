/**
 * NOTE: Visible period selection on Schedule — three ways to pick the same thing.
 *
 * Schedule never plans shorter than a month (ADR-0036, owner review): day and
 * week zoom would be pointless there — the grid holds a minimum of 30xN
 * cells — and three controls live in one card:
 *
 *   1. **Step and zoom** — a day at a time with `‹ ›`, a month at a time with
 *      `« »`, and the window width with the segmented control. The window runs
 *      *forward from the selected day*, so Today starts it at today rather than
 *      at the 1st with today buried in the middle.
 *   2. **Day strip** — clicking a day makes it the start of a period of the
 *      same width (owner review: not necessarily the 1st of the month — the
 *      end adjusts to the already-selected length).
 *   3. **Year scrubber** — the same thing, but "roughly here": a window of
 *      the same width moves as a whole, not snapped to month boundaries.
 *
 * All three write to `useUi.schedule`, and all period arithmetic lives in
 * `engine/period.ts` — otherwise "next month" from the arrow and "next month"
 * from the scrubber would drift apart by a day. The strip and scrubber
 * themselves are the shared `PeriodStrip.tsx`, the same one Overview uses.
 *
 * The day strip and year scrubber are collapsible (CLAUDE.md: the period
 * panel takes up too much vertical space) — step/zoom and the current range
 * stay visible always; only the auxiliary way to jump to an arbitrary month
 * collapses.
 */

import { useState } from 'react';
import { ZOOMS, formatRange, rangeLength } from '../../engine/period.ts';
import { TODAY, useUi } from '../../store/useUi.ts';
import { useElementWidth } from '../../ui/useElementWidth.ts';
import { chipSlotsFor, DayStrip, Scrubber } from './PeriodStrip.tsx';

export function DateRangeControl() {
  const zoom = useUi((s) => s.schedule.zoom);
  const range = useUi((s) => s.range);
  const setZoom = useUi((s) => s.setScheduleZoom);
  const jumpTo = useUi((s) => s.jumpScheduleTo);
  const stepPeriod = useUi((s) => s.stepSchedule);
  const jumpMonths = useUi((s) => s.jumpScheduleMonths);
  const goToday = useUi((s) => s.scheduleToday);

  const length = rangeLength(range);
  const containsToday = TODAY >= range.from && TODAY <= range.to;

  // NOTE: How many chips fit without clipping — not a fixed limit that
  // silently hides a tail of dates past the right edge. Until the width is
  // measured (first frame), the strip doesn't render at all: better a frame
  // of emptiness than a wrong chip count that immediately re-renders.
  const [stripRef, stripWidth] = useElementWidth<HTMLDivElement>();
  const chipSlots = chipSlotsFor(stripWidth);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <section className="card px-3 py-2.5" aria-label="Visible period">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn--icon"
          onClick={() => setPickerOpen(!pickerOpen)}
          aria-expanded={pickerOpen}
          title={pickerOpen ? 'Hide the day strip and year scrubber' : 'Show the day strip and year scrubber'}
        >
          <span aria-hidden className="text-[9px]">
            {pickerOpen ? '▼' : '▶'}
          </span>
        </button>

        {/* Two granularities, because a planner does both: walk along the rota a day at
            a time, and skip to next month. The single arrow used to move a whole month,
            which made the near boundary impossible to sit on. */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => jumpMonths(-1)}
            aria-label="Back one month"
            title="Back one month"
          >
            «
          </button>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => stepPeriod(-1)}
            aria-label="Back one day"
            title="Back one day"
          >
            ‹
          </button>
          <button
            type="button"
            className="btn"
            onClick={goToday}
            data-active={containsToday}
            title="Start the window at today"
          >
            Today
          </button>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => stepPeriod(1)}
            aria-label="Forward one day"
            title="Forward one day"
          >
            ›
          </button>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => jumpMonths(1)}
            aria-label="Forward one month"
            title="Forward one month"
          >
            »
          </button>
        </div>

        <div className="min-w-0 px-1">
          <div className="truncate text-[15px] font-semibold tracking-tight">
            {formatRange(range)}
          </div>
          <div className="text-[11.5px] text-muted">
            {length} {length === 1 ? 'day' : 'days'}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="segmented" role="group" aria-label="Zoom">
            {ZOOMS.map((spec) => (
              <button
                key={spec.id}
                type="button"
                className="segmented__item"
                data-active={zoom === spec.id}
                title={spec.title}
                onClick={() => setZoom(spec.id)}
              >
                {spec.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The width-measured node stays mounted across collapse/expand — only
          its children toggle — so the ResizeObserver never has to re-attach
          to a freshly-mounted node and briefly report a stale/zero width. */}
      <div ref={stripRef}>
        {pickerOpen && chipSlots > 0 && length <= chipSlots ? (
          <DayStrip range={range} chipCount={chipSlots} onPick={jumpTo} />
        ) : null}
      </div>

      {pickerOpen ? <Scrubber range={range} onPick={jumpTo} /> : null}
    </section>
  );
}
