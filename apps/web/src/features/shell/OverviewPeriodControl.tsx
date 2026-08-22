/**
 * NOTE: Visible period selection on Overview — the same widget as Schedule's
 * (day strip + year scrubber, `PeriodStrip.tsx`), just with three zooms
 * (1/3/7 days) instead of seven, and no arbitrary range (ADR-0036).
 *
 * Clicking a day or the scrubber doesn't change the zoom — it repositions the
 * anchor (`setOverviewAnchor`), and the timeline strip recenters on it itself
 * (`OverviewPage`'s scroll-to-anchor effect). Continuous horizontal scrolling
 * of the strip remains a separate, independent way to look at neighboring
 * days — the two don't interfere with each other.
 */

import { useState } from 'react';
import type { DateRange } from '../../domain/types.ts';
import { addDays } from '../../engine/dates.ts';
import { OVERVIEW_SPANS } from '../../engine/period.ts';
import { TODAY, useUi } from '../../store/useUi.ts';
import { useElementWidth } from '../../ui/useElementWidth.ts';
import { chipSlotsFor, DayStrip, Scrubber } from './PeriodStrip.tsx';

export function OverviewPeriodControl() {
  const anchor = useUi((s) => s.overview.anchor);
  const span = useUi((s) => s.overview.span);
  const setSpan = useUi((s) => s.setOverviewSpan);
  const setAnchor = useUi((s) => s.setOverviewAnchor);
  const step = useUi((s) => s.stepOverview);
  const today = useUi((s) => s.overviewToday);

  const containsToday = anchor === TODAY;

  const [stripRef, stripWidth] = useElementWidth<HTMLDivElement>();
  const chipSlots = chipSlotsFor(stripWidth);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Just the on-screen window (span days from the anchor) — not the padded
  // fetch range in `useUi.range`, which is three times as wide for scroll
  // context and would over-highlight the day strip.
  const visible: DateRange = { from: anchor, to: addDays(anchor, span - 1) };

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

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => step(-1)}
            aria-label="Previous period"
            title="Previous period"
          >
            ‹
          </button>
          <button
            type="button"
            className="btn"
            onClick={today}
            data-active={containsToday}
            title="Jump to today"
          >
            Today
          </button>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => step(1)}
            aria-label="Next period"
            title="Next period"
          >
            ›
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="segmented" role="group" aria-label="Zoom">
            {OVERVIEW_SPANS.map((spec) => (
              <button
                key={spec.id}
                type="button"
                className="segmented__item"
                data-active={span === spec.id}
                onClick={() => setSpan(spec.id)}
              >
                {spec.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div ref={stripRef}>
        {pickerOpen && chipSlots > 0 ? (
          <DayStrip range={visible} chipCount={chipSlots} onPick={setAnchor} />
        ) : null}
      </div>

      {pickerOpen ? <Scrubber range={visible} onPick={setAnchor} /> : null}
    </section>
  );
}
