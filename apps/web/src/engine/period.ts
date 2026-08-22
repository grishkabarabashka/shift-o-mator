/**
 * NOTE: Visible range — zoom level, navigation step, and a human-readable
 * label.
 *
 * Deliberately pulled out into its own module. Three different controls
 * choose the range — the segmented switcher, the day strip, and the
 * draggable scrubber — and all of them must agree on what a "week" is. If
 * that knowledge were smeared across components, "next week" from the arrow
 * and "next week" from the scrubber would drift apart by a day.
 *
 * The week is always ISO: Monday-Sunday, and that must not be relaxed.
 */

import { DateTime } from 'luxon';
import type { DateRange, IsoDate } from '../domain/types.ts';
import { addDays, daysBetween, parseDate, toIsoDate } from './dates.ts';

export type ScheduleZoom = 'month' | 'quarter' | 'half-year';

export interface ZoomSpec {
  readonly id: ScheduleZoom;
  /** Label on the switcher. */
  readonly label: string;
  /** Full label for aria and the tooltip. */
  readonly title: string;
  /**
   * NOTE: The grid is editable only at the month zoom. Three and six months
   * are a read-only heatmap: 80 x 180 editable cells fit neither the screen
   * nor a reasonable render time.
   */
  readonly detail: boolean;
}

export const ZOOMS: readonly ZoomSpec[] = [
  { id: 'month', label: 'Month', title: 'Calendar month', detail: true },
  { id: 'quarter', label: '3 Months', title: 'Three months — read-only heatmap', detail: false },
  { id: 'half-year', label: '6 Months', title: 'Six months — read-only heatmap', detail: false },
];

const ZOOM_BY_ID = new Map(ZOOMS.map((zoom) => [zoom.id, zoom]));

export function zoomSpec(id: ScheduleZoom): ZoomSpec {
  const spec = ZOOM_BY_ID.get(id);
  if (!spec) throw new Error(`Unknown zoom ${id}`);
  return spec;
}

/**
 * NOTE: The range of the selected zoom that contains the anchor date. For
 * Schedule only — its minimum zoom is a month (owner review: planning
 * anything shorter than a month is pointless).
 *
 * The anchor isn't "the start of the range" but "the day the planner wants
 * to see". That's why the month aligns to the 1st: otherwise stepping
 * "forward" from August 15 would give September 15, and the column headers
 * would stop matching the calendar.
 */
export function rangeFor(zoom: ScheduleZoom, anchor: IsoDate): DateRange {
  const dt = parseDate(anchor);
  switch (zoom) {
    case 'month':
      return { from: toIsoDate(dt.startOf('month')), to: toIsoDate(dt.endOf('month')) };
    case 'quarter':
      return monthSpan(dt, 3);
    case 'half-year':
      return monthSpan(dt, 6);
  }
}

function monthSpan(dt: DateTime, months: number): DateRange {
  const start = dt.startOf('month');
  return {
    from: toIsoDate(start),
    to: toIsoDate(start.plus({ months }).minus({ days: 1 })),
  };
}

/**
 * NOTE: The anchor after stepping forward or backward.
 *
 * The step equals the visible range, not a fixed number of days: "forward"
 * from a month means a month, not 30 days, or February would misalign the
 * grid.
 */
export function stepAnchor(zoom: ScheduleZoom, anchor: IsoDate, direction: 1 | -1): IsoDate {
  const dt = parseDate(anchor);
  switch (zoom) {
    case 'month':
      return toIsoDate(dt.startOf('month').plus({ months: direction }));
    case 'quarter':
      return toIsoDate(dt.startOf('month').plus({ months: 3 * direction }));
    case 'half-year':
      return toIsoDate(dt.startOf('month').plus({ months: 6 * direction }));
  }
}

/**
 * NOTE: Width of the Overview window in days: 1, 3, or 7 days across the
 * full screen width (owner review — instead of seven zoom levels on one
 * timeline).
 */
export type OverviewSpan = 1 | 3 | 7;

export const OVERVIEW_SPANS: readonly { readonly id: OverviewSpan; readonly label: string }[] = [
  { id: 1, label: '1 Day' },
  { id: 3, label: '3 Days' },
  { id: 7, label: '7 Days' },
];

/**
 * NOTE: The Overview window around the anchor: `span` days from the anchor
 * plus that much context on each side, so horizontal scrolling stays
 * continuous in both directions without a data refetch during ordinary
 * dragging.
 */
export function overviewRange(anchor: IsoDate, span: OverviewSpan): DateRange {
  return { from: addDays(anchor, -span), to: addDays(anchor, 2 * span - 1) };
}

/** NOTE: The Overview anchor after stepping forward/backward — by the width of the visible window. */
export function stepOverviewAnchor(anchor: IsoDate, span: OverviewSpan, direction: 1 | -1): IsoDate {
  return addDays(anchor, span * direction);
}

/**
 * NOTE: The range label. The shared part isn't repeated: "3 - 9 Aug 2026",
 * not "3 Aug 2026 - 9 Aug 2026". On a narrow header that's the difference
 * between one line and two.
 */
export function formatRange(range: DateRange): string {
  const from = parseDate(range.from);
  const to = parseDate(range.to);

  if (range.from === range.to) return from.toFormat('cccc, d LLLL yyyy');
  if (from.year === to.year && from.month === to.month) {
    return `${from.toFormat('d')} – ${to.toFormat('d LLLL yyyy')}`;
  }
  if (from.year === to.year) {
    return `${from.toFormat('d LLL')} – ${to.toFormat('d LLL yyyy')}`;
  }
  return `${from.toFormat('d LLL yyyy')} – ${to.toFormat('d LLL yyyy')}`;
}

/** NOTE: Number of days in the range, inclusive. */
export function rangeLength(range: DateRange): number {
  return daysBetween(range.from, range.to) + 1;
}

/**
 * NOTE: Track for the draggable scrubber: a year around the anchor, aligned
 * to month boundaries.
 *
 * A year, not "the whole data range": the planner moves the window within a
 * season, and a ten-year track would make a one-month step imprecise.
 */
export function scrubberTrack(anchor: IsoDate): DateRange {
  const start = parseDate(anchor).startOf('month').minus({ months: 4 });
  return { from: toIsoDate(start), to: toIsoDate(start.plus({ months: 12 }).minus({ days: 1 })) };
}

/** NOTE: Month ticks within the track — for the labels under the scrubber. */
export function monthTicks(track: DateRange): { date: IsoDate; label: string }[] {
  const ticks: { date: IsoDate; label: string }[] = [];
  let cursor = parseDate(track.from).startOf('month');
  const end = parseDate(track.to);
  while (cursor <= end) {
    ticks.push({ date: toIsoDate(cursor), label: cursor.toFormat('LLL') });
    cursor = cursor.plus({ months: 1 });
  }
  return ticks;
}

/** NOTE: Fractional position of a date within the track, 0..1. For laying out the scrubber. */
export function fractionOf(track: DateRange, date: IsoDate): number {
  const total = rangeLength(track);
  const offset = daysBetween(track.from, date);
  return Math.min(Math.max(offset / total, 0), 1);
}

/**
 * NOTE: Inverse of `fractionOf`: a date from a track fraction.
 *
 * Same `total` denominator as `fractionOf` — otherwise the pair wouldn't be
 * true inverses and dragging to the right edge would miss by a day. `floor`,
 * not `round`: a fraction of 1.0 must stay within the track, not roll over
 * to the day past its end.
 */
export function dateAtFraction(track: DateRange, fraction: number): IsoDate {
  const total = rangeLength(track);
  const clamped = Math.min(Math.max(fraction, 0), 1);
  // WHY: An epsilon before `floor`: `fractionOf` is plain division, and the
  // inverse multiplication by `total` doesn't always return an exact integer
  // number of days — 63/365*365 can yield 62.999999999999993, and without
  // the epsilon such a day would round down past itself.
  const offset = Math.min(total - 1, Math.floor(clamped * total + 1e-9));
  return addDays(track.from, offset);
}
