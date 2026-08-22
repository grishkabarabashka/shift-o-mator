/**
 * NOTE: Day strip and year scrubber — shared by Schedule (`DateRangeControl`)
 * and Overview (`OverviewPeriodControl`).
 *
 * Both read the same things: `range` — what to highlight as "current" (and
 * what to add context around on the day strip), `onPick` — where a click on a
 * date moves things to. What "moving" means is each screen's own business
 * (Schedule aligns to a month, Overview just repositions the anchor and
 * recenters), but these two widgets themselves don't know that.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DateRange, IsoDate } from '../../domain/types.ts';
import { parseDate } from '../../engine/dates.ts';
import { dateAtFraction, formatRange, fractionOf, monthTicks, rangeLength, scrubberTrack } from '../../engine/period.ts';
import { TODAY } from '../../store/useUi.ts';

/** NOTE: Minimum chip width plus the gap between chips — from `.day-chip` in theme.css. */
const MIN_CHIP_W = 30;
const CHIP_GAP = 3;

/** NOTE: How many minimum-width chips fit in the measured width without clipping. */
export function chipSlotsFor(containerWidth: number): number {
  if (containerWidth <= 0) return 0;
  return Math.max(1, Math.floor((containerWidth + CHIP_GAP) / (MIN_CHIP_W + CHIP_GAP)));
}

/**
 * NOTE: The period's days plus symmetric context at the edges, up to exactly
 * `chipCount`.
 *
 * The context isn't decoration: without days from the neighboring period at
 * the edges there'd be nowhere to click — the period itself is already shown
 * in full, and the context chips are the only way to step past its boundary
 * with one click on the strip, rather than an arrow.
 */
function stripDays(range: DateRange, chipCount: number): IsoDate[] {
  const context = Math.max(0, chipCount - rangeLength(range));
  const before = Math.ceil(context / 2);
  const after = context - before;
  const start = parseDate(range.from).minus({ days: before });
  const end = parseDate(range.to).plus({ days: after });
  const days: IsoDate[] = [];
  for (let cursor = start; cursor <= end; cursor = cursor.plus({ days: 1 })) {
    days.push(cursor.toISODate() ?? '');
  }
  return days;
}

export function DayStrip({
  range,
  chipCount,
  onPick,
}: {
  readonly range: DateRange;
  readonly chipCount: number;
  readonly onPick: (date: IsoDate) => void;
}) {
  const days = useMemo(() => stripDays(range, chipCount), [range, chipCount]);

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      <div className="flex gap-[3px] pb-1" role="group" aria-label="Day strip">
        {days.map((date) => {
          const dt = parseDate(date);
          const weekend = dt.weekday >= 6;
          return (
            <button
              key={date}
              type="button"
              className="day-chip"
              data-selected={date >= range.from && date <= range.to}
              data-weekend={weekend}
              data-today={date === TODAY}
              title={dt.toFormat('cccc, d LLLL yyyy')}
              onClick={() => onPick(date)}
            >
              <span className="day-chip__wd">{dt.toFormat('ccccc')}</span>
              <span className="day-chip__num">{dt.day}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Year scrubber
// ---------------------------------------------------------------------------

export function Scrubber({
  range,
  onPick,
}: {
  readonly range: DateRange;
  readonly onPick: (date: IsoDate) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const track = useMemo(() => scrubberTrack(range.from), [range.from]);
  const ticks = useMemo(() => monthTicks(track), [track]);

  const [dragging, setDragging] = useState(false);

  const dateAtEvent = useCallback(
    (clientX: number): IsoDate => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return range.from;
      return dateAtFraction(track, (clientX - rect.left) / rect.width);
    },
    [track, range.from],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: MouseEvent) => onPick(dateAtEvent(event.clientX));
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, dateAtEvent, onPick]);

  const left = fractionOf(track, range.from) * 100;
  const right = fractionOf(track, range.to) * 100;
  const width = Math.max(right - left, 0.6);
  const todayLeft = fractionOf(track, TODAY) * 100;
  const todayVisible = TODAY >= track.from && TODAY <= track.to;

  return (
    <div className="mt-2">
      <div
        ref={trackRef}
        className="scrub"
        role="slider"
        tabIndex={0}
        aria-label="Jump to a date"
        aria-valuetext={formatRange(range)}
        onMouseDown={(event) => {
          onPick(dateAtEvent(event.clientX));
          setDragging(true);
        }}
      >
        {ticks.map((tick) => (
          <span
            key={tick.date}
            className="scrub__tick"
            style={{ left: `${fractionOf(track, tick.date) * 100}%` }}
          >
            {tick.label}
          </span>
        ))}

        {todayVisible ? (
          <span className="scrub__today" style={{ left: `${todayLeft}%` }} title="Today" />
        ) : null}

        <div className="scrub__window" style={{ left: `${left}%`, width: `${width}%` }} />
      </div>
    </div>
  );
}
