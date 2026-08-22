/**
 * NOTE: Date and time handling. Rules are fixed in Docs/02-time.md:
 *
 * - everything is stored in UTC as half-open intervals `[start, end)`;
 * - a shift's window is given in local time in the shift's named timezone,
 *   not as a UTC offset — this gives correct behavior across DST transitions;
 * - no function here calls `DateTime.now()` internally: the current time is
 *   always passed in as a parameter, otherwise tests would depend on the day
 *   they run.
 */

import { DateTime, Interval } from 'luxon';
import type { DatasetIndex } from '../domain/lookup.ts';
import type {
  DateRange,
  IanaZone,
  IsoDate,
  IsoInstant,
  Location,
  Shift,
  TimeOverride,
  UtcInterval,
  Weekday,
} from '../domain/types.ts';

const ISO_DATE = 'yyyy-MM-dd';

export function parseDate(date: IsoDate, zone: IanaZone = 'UTC'): DateTime {
  const dt = DateTime.fromISO(date, { zone });
  if (!dt.isValid) throw new Error(`Invalid date: ${date}`);
  return dt;
}

export function toIsoDate(dt: DateTime): IsoDate {
  return dt.toFormat(ISO_DATE);
}

export function toIsoInstant(dt: DateTime): IsoInstant {
  const iso = dt.toUTC().toISO({ suppressMilliseconds: true });
  if (iso === null) throw new Error('Invalid instant');
  return iso;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return toIsoDate(parseDate(date).plus({ days }));
}

export function weekdayOf(date: IsoDate): Weekday {
  return parseDate(date).weekday as Weekday;
}

/** NOTE: Calendar difference in days: `to - from`. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return parseDate(to).diff(parseDate(from), 'days').days;
}

/** NOTE: All dates in the range, inclusive. */
export function eachDate(range: DateRange): IsoDate[] {
  const result: IsoDate[] = [];
  let cursor = parseDate(range.from);
  const last = parseDate(range.to);
  if (last < cursor) return result;
  while (cursor <= last) {
    result.push(toIsoDate(cursor));
    cursor = cursor.plus({ days: 1 });
  }
  return result;
}

export function rangeContains(range: DateRange, date: IsoDate): boolean {
  return date >= range.from && date <= range.to;
}

export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.from <= b.to && b.from <= a.to;
}

// ---------------------------------------------------------------------------
// Location calendar
// ---------------------------------------------------------------------------

export function isWeekendIn(date: IsoDate, location: Location): boolean {
  return location.weekendDays.includes(weekdayOf(date));
}

/**
 * NOTE: Holiday check by location. The check goes by the specific location, not
 * by calendar key: two locations in the same country can have different
 * holiday sets.
 */
export function isHolidayIn(date: IsoDate, location: Location, index: DatasetIndex): boolean {
  return index.holidaysByLocation.get(location.id)?.has(date) ?? false;
}

export function holidayNameIn(
  date: IsoDate,
  location: Location,
  index: DatasetIndex,
): string | undefined {
  return index.holidayNames.get(`${location.holidayCalendarKey}|${date}`);
}

/**
 * NOTE: Non-working day per the location's calendar. This exact check is what
 * triggers comp day accrual — see ADR-0002 and ADR-0007.
 */
export function isNonWorkingDayIn(
  date: IsoDate,
  location: Location,
  index: DatasetIndex,
): boolean {
  return isWeekendIn(date, location) || isHolidayIn(date, location, index);
}

/** NOTE: Number of working days in the range per the location's calendar, both bounds inclusive. */
export function countWorkdays(
  range: DateRange,
  location: Location,
  index: DatasetIndex,
): number {
  let count = 0;
  for (const date of eachDate(range)) {
    if (!isNonWorkingDayIn(date, location, index)) count += 1;
  }
  return count;
}

/** NOTE: All of a location's holidays that fall within the range. */
export function holidaysIn(
  range: DateRange,
  location: Location,
  index: DatasetIndex,
): IsoDate[] {
  const dates = index.holidaysByLocation.get(location.id);
  if (!dates) return [];
  return [...dates].filter((date) => rangeContains(range, date)).sort();
}

// ---------------------------------------------------------------------------
// Shift window
// ---------------------------------------------------------------------------

function timeOfDayParts(value: string): { hour: number; minute: number } {
  const [hourText, minuteText] = value.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`Invalid time of day: ${value}`);
  }
  return { hour, minute };
}

/**
 * NOTE: Shift interval in UTC.
 *
 * The date is interpreted in the shift's timezone (ADR-0001). If the window
 * crosses midnight, the end falls on the next calendar day in that same
 * timezone.
 */
export function shiftInterval(
  shift: Shift,
  date: IsoDate,
  override?: TimeOverride,
): UtcInterval {
  const start = override?.start ?? shift.start;
  const end = override?.end ?? shift.end;
  const crossesMidnight = override?.crossesMidnight ?? shift.crossesMidnight;

  const base = parseDate(date, shift.timeZone);
  const startAt = base.set(timeOfDayParts(start));
  const endBase = crossesMidnight ? base.plus({ days: 1 }) : base;
  const endAt = endBase.set(timeOfDayParts(end));

  if (endAt <= startAt) {
    throw new Error(
      `Shift window for ${shift.code} on ${date} is empty or negative: ${start}–${end}`,
    );
  }

  return { start: toIsoInstant(startAt), end: toIsoInstant(endAt) };
}

export function intervalHours(interval: UtcInterval): number {
  return DateTime.fromISO(interval.end).diff(DateTime.fromISO(interval.start), 'hours').hours;
}

/** NOTE: Hours between the end of one shift and the start of another. Negative means overlap. */
export function restHoursBetween(earlier: UtcInterval, later: UtcInterval): number {
  return DateTime.fromISO(later.start).diff(DateTime.fromISO(earlier.end), 'hours').hours;
}

export function intervalsOverlap(a: UtcInterval, b: UtcInterval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** NOTE: Intersection of two intervals, or `undefined` if there is none. */
export function intersectIntervals(a: UtcInterval, b: UtcInterval): UtcInterval | undefined {
  if (!intervalsOverlap(a, b)) return undefined;
  return {
    start: a.start > b.start ? a.start : b.start,
    end: a.end < b.end ? a.end : b.end,
  };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function formatInZone(instant: IsoInstant, zone: IanaZone, format = 'HH:mm'): string {
  return DateTime.fromISO(instant, { zone }).toFormat(format);
}

/** NOTE: Local date of an instant in the given timezone. */
export function localDateOf(instant: IsoInstant, zone: IanaZone): IsoDate {
  return toIsoDate(DateTime.fromISO(instant, { zone }));
}

/** NOTE: A range of N days, starting from the given date. */
export function rangeOfDays(from: IsoDate, days: number): DateRange {
  return { from, to: addDays(from, days - 1) };
}

/** NOTE: The calendar month containing the given date. */
export function monthRange(date: IsoDate): DateRange {
  const dt = parseDate(date);
  return { from: toIsoDate(dt.startOf('month')), to: toIsoDate(dt.endOf('month')) };
}

/** NOTE: Luxon interval for the timeline scale. */
export function toLuxonInterval(interval: UtcInterval): Interval {
  return Interval.fromDateTimes(
    DateTime.fromISO(interval.start),
    DateTime.fromISO(interval.end),
  );
}
