/**
 * Работа с датами и временем. Правила зафиксированы в Docs/02-time.md:
 *
 * - всё хранится в UTC как полуоткрытые интервалы `[start, end)`;
 * - окно смены задано локальным временем в именованной таймзоне роли, а не
 *   UTC-смещением — это даёт корректное поведение на переходах DST;
 * - ни одна функция здесь не вызывает `DateTime.now()` внутри себя: текущее
 *   время передаётся параметром, иначе тесты зависят от дня запуска.
 */

import { DateTime, Interval } from 'luxon';
import type { DatasetIndex } from '../domain/lookup.ts';
import type {
  CoverageScope,
  DateRange,
  IanaZone,
  IsoDate,
  IsoInstant,
  Location,
  PlanningUnit,
  ShiftRole,
  TimeOverride,
  UtcInterval,
  Weekday,
} from '../domain/types.ts';

const ISO_DATE = 'yyyy-MM-dd';

export function parseDate(date: IsoDate, zone: IanaZone = 'UTC'): DateTime {
  const dt = DateTime.fromISO(date, { zone });
  if (!dt.isValid) throw new Error(`Некорректная дата: ${date}`);
  return dt;
}

export function toIsoDate(dt: DateTime): IsoDate {
  return dt.toFormat(ISO_DATE);
}

export function toIsoInstant(dt: DateTime): IsoInstant {
  const iso = dt.toUTC().toISO({ suppressMilliseconds: true });
  if (iso === null) throw new Error('Некорректный момент времени');
  return iso;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return toIsoDate(parseDate(date).plus({ days }));
}

export function weekdayOf(date: IsoDate): Weekday {
  return parseDate(date).weekday as Weekday;
}

/** Календарная разница в днях: `to - from`. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return parseDate(to).diff(parseDate(from), 'days').days;
}

/** Все даты периода включительно. */
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
// Календарь локации
// ---------------------------------------------------------------------------

export function isWeekendIn(date: IsoDate, location: Location): boolean {
  return location.weekendDays.includes(weekdayOf(date));
}

export function isHolidayIn(date: IsoDate, location: Location, index: DatasetIndex): boolean {
  return index.holidayDates.get(location.holidayCalendarKey)?.has(date) ?? false;
}

export function holidayNameIn(
  date: IsoDate,
  location: Location,
  index: DatasetIndex,
): string | undefined {
  return index.holidayNames.get(`${location.holidayCalendarKey}|${date}`);
}

/**
 * Нерабочий день по календарю локации. Именно эта проверка порождает
 * начисление comp day — см. ADR-0002 и ADR-0007.
 */
export function isNonWorkingDayIn(
  date: IsoDate,
  location: Location,
  index: DatasetIndex,
): boolean {
  return isWeekendIn(date, location) || isHolidayIn(date, location, index);
}

/** Число рабочих дней в периоде по календарю локации, обе границы включительно. */
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

/**
 * Классификация дня для правил покрытия. Берётся календарь референсной локации
 * единицы (`coverageCalendarLocationId`), а не локации конкретного человека.
 */
export function coverageDayKind(
  date: IsoDate,
  unit: PlanningUnit,
  index: DatasetIndex,
): Exclude<CoverageScope, 'DATE'> {
  const location = index.locations.get(unit.coverageCalendarLocationId);
  if (!location) throw new Error(`Референсная локация единицы ${unit.id} не найдена`);
  if (isHolidayIn(date, location, index)) return 'HOLIDAY';
  if (isWeekendIn(date, location)) return 'WEEKEND';
  return 'WEEKDAY';
}

// ---------------------------------------------------------------------------
// Окно смены
// ---------------------------------------------------------------------------

function timeOfDayParts(value: string): { hour: number; minute: number } {
  const [hourText, minuteText] = value.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`Некорректное время суток: ${value}`);
  }
  return { hour, minute };
}

/**
 * Интервал смены в UTC.
 *
 * Дата трактуется в таймзоне роли (ADR-0001). Если окно переходит через
 * полночь, конец приходится на следующий календарный день той же таймзоны.
 */
export function shiftInterval(
  role: ShiftRole,
  date: IsoDate,
  override?: TimeOverride,
): UtcInterval {
  const start = override?.start ?? role.start;
  const end = override?.end ?? role.end;
  const crossesMidnight = override?.crossesMidnight ?? role.crossesMidnight;

  const base = parseDate(date, role.timeZone);
  const startAt = base.set(timeOfDayParts(start));
  const endBase = crossesMidnight ? base.plus({ days: 1 }) : base;
  const endAt = endBase.set(timeOfDayParts(end));

  if (endAt <= startAt) {
    throw new Error(
      `Окно роли ${role.code} за ${date} пустое или отрицательное: ${start}–${end}`,
    );
  }

  return { start: toIsoInstant(startAt), end: toIsoInstant(endAt) };
}

export function intervalHours(interval: UtcInterval): number {
  return DateTime.fromISO(interval.end).diff(DateTime.fromISO(interval.start), 'hours').hours;
}

/** Часы между концом одной смены и началом другой. Отрицательные — пересечение. */
export function restHoursBetween(earlier: UtcInterval, later: UtcInterval): number {
  return DateTime.fromISO(later.start).diff(DateTime.fromISO(earlier.end), 'hours').hours;
}

export function intervalsOverlap(a: UtcInterval, b: UtcInterval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Пересечение двух интервалов или `undefined`, если его нет. */
export function intersectIntervals(a: UtcInterval, b: UtcInterval): UtcInterval | undefined {
  if (!intervalsOverlap(a, b)) return undefined;
  return {
    start: a.start > b.start ? a.start : b.start,
    end: a.end < b.end ? a.end : b.end,
  };
}

// ---------------------------------------------------------------------------
// Отображение
// ---------------------------------------------------------------------------

export function formatInZone(instant: IsoInstant, zone: IanaZone, format = 'HH:mm'): string {
  return DateTime.fromISO(instant, { zone }).toFormat(format);
}

/** Локальная дата момента в указанной таймзоне. */
export function localDateOf(instant: IsoInstant, zone: IanaZone): IsoDate {
  return toIsoDate(DateTime.fromISO(instant, { zone }));
}

/** Период из N дней, начиная с указанной даты. */
export function rangeOfDays(from: IsoDate, days: number): DateRange {
  return { from, to: addDays(from, days - 1) };
}

/** Календарный месяц, содержащий указанную дату. */
export function monthRange(date: IsoDate): DateRange {
  const dt = parseDate(date);
  return { from: toIsoDate(dt.startOf('month')), to: toIsoDate(dt.endOf('month')) };
}

/** Luxon-интервал для шкалы timeline. */
export function toLuxonInterval(interval: UtcInterval): Interval {
  return Interval.fromDateTimes(
    DateTime.fromISO(interval.start),
    DateTime.fromISO(interval.end),
  );
}
