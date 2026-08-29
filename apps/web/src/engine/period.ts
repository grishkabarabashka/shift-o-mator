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


import type { DateRange, IsoDate } from '../domain/types.ts';
import { addDays, daysBetween, parseDate, toIsoDate } from './dates.ts';

export type ScheduleZoom = 'week' | 'month' | 'two-months' | 'quarter' | 'half-year';

export interface ZoomSpec {
  readonly id: ScheduleZoom;
  /** Label on the switcher. */
  readonly label: string;
  /** Full label for aria and the tooltip. */
  readonly title: string;
  /**
   * NOTE: The grid is editable up to two months. Three and six are a read-only
   * heatmap: 80 x 180 editable cells fit neither the screen nor a reasonable
   * render time.
   */
  readonly detail: boolean;
  /**
   * How far the window runs from its start, in months — or in `days`, for the one zoom
   * short enough that a month is the wrong unit.
   */
  readonly months: number;
  readonly days?: number;
}

/**
 * Days of context kept behind the anchor, so the selected day is not glued to the left
 * edge and yesterday stays visible without navigating.
 */
export const LEAD_IN_DAYS = 2;

export const ZOOMS: readonly ZoomSpec[] = [
  // WHY a week exists at all: it is the horizon a planner actually works in, and the
  // shortest view on offer was a month — thirty-one columns squeezed to forty-five pixels
  // to fit the screen. Nine columns give each day room for the shift code, the absence
  // band and the person's name in one glance. Columns stretch to the width available, so
  // this fits exactly and has nothing to scroll.
  { id: 'week', label: 'Week', title: 'A week from the selected day, with two days behind it', detail: true, months: 0, days: 7 + LEAD_IN_DAYS },
  { id: 'month', label: 'Month', title: 'One month from the selected day', detail: true, months: 1 },
  { id: 'two-months', label: '2 Months', title: 'Two months from the selected day — still editable', detail: true, months: 2 },
  { id: 'quarter', label: '3 Months', title: 'Three months — read-only heatmap', detail: false, months: 3 },
  { id: 'half-year', label: '6 Months', title: 'Six months — read-only heatmap', detail: false, months: 6 },
];

const ZOOM_BY_ID = new Map(ZOOMS.map((zoom) => [zoom.id, zoom]));

export function zoomSpec(id: ScheduleZoom): ZoomSpec {
  const spec = ZOOM_BY_ID.get(id);
  if (!spec) throw new Error(`Unknown zoom ${id}`);
  return spec;
}


/**
 * NOTE: The window for the selected zoom, **starting from the anchor** rather than
 * snapping to a calendar month.
 *
 * WHY it changed: the anchor is "the day the planner wants to see", and aligning to the
 * 1st meant picking the 27th showed the 1st–31st with the interesting part at the far
 * right, and Today did the same. What a planner is actually looking at is the near future
 * from where they are, so the window runs a month *forward* from the selected day, with
 * two days of context behind it.
 *
 * The cost is that column headers no longer line up with a calendar month. That was the
 * original reason for the alignment, and it is the smaller loss: the headers carry their
 * own dates.
 */
export function rangeFor(zoom: ScheduleZoom, anchor: IsoDate): DateRange {
  const spec = zoomSpec(zoom);
  const from = parseDate(anchor).minus({ days: LEAD_IN_DAYS });
  // A zoom shorter than a month counts in days: `plus({ months: 0 })` is the anchor
  // itself, and a window of one day is not a week.
  const end = spec.days !== undefined
    ? from.plus({ days: spec.days })
    : from.plus({ months: spec.months });
  return { from: toIsoDate(from), to: toIsoDate(end.minus({ days: 1 })) };
}

/**
 * NOTE: The anchor after stepping forward or backward — **by one day**.
 *
 * WHY not by the width of the window: a planner following a rota moves along it, and a
 * whole-month jump per arrow press made the near boundary impossible to sit on. Jumping a
 * month is still one click, on its own control — see <see cref="jumpAnchorMonths"/>.
 */
export function stepAnchor(anchor: IsoDate, direction: 1 | -1): IsoDate {
  return addDays(anchor, direction);
}

/** NOTE: The anchor a whole month away — the coarse companion to `stepAnchor`. */
export function jumpAnchorMonths(anchor: IsoDate, direction: 1 | -1): IsoDate {
  return toIsoDate(parseDate(anchor).plus({ months: direction }));
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
