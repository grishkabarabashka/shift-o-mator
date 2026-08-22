/**
 * Индексы по датасету. Чистые функции движка получают их аргументом, чтобы не
 * пересобирать `Map` на каждый день периода.
 */

import type {
  Absence,
  Assignment,
  CompDayEntry,
  HolidayCalendarKey,
  IsoDate,
  Location,
  LocationId,
  Person,
  PersonId,
  PlanningUnit,
  RoleId,
  ScheduleDataset,
  ShiftRole,
  UnitId,
} from './types.ts';

export interface DatasetIndex {
  readonly locations: ReadonlyMap<LocationId, Location>;
  readonly units: ReadonlyMap<UnitId, PlanningUnit>;
  readonly roles: ReadonlyMap<RoleId, ShiftRole>;
  readonly people: ReadonlyMap<PersonId, Person>;
  readonly rolesByUnit: ReadonlyMap<UnitId, readonly ShiftRole[]>;
  readonly peopleByUnit: ReadonlyMap<UnitId, readonly Person[]>;
  /** Праздничные даты по ключу календаря. */
  readonly holidayDates: ReadonlyMap<HolidayCalendarKey, ReadonlySet<IsoDate>>;
  readonly holidayNames: ReadonlyMap<string, string>;
  readonly absencesByPerson: ReadonlyMap<PersonId, readonly Absence[]>;
  readonly compDaysByPerson: ReadonlyMap<PersonId, readonly CompDayEntry[]>;
  readonly assignmentsByPerson: ReadonlyMap<PersonId, readonly Assignment[]>;
  readonly assignmentsByDate: ReadonlyMap<IsoDate, readonly Assignment[]>;
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = result.get(k);
    if (bucket) bucket.push(item);
    else result.set(k, [item]);
  }
  return result;
}

function byId<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T> {
  const result = new Map<K, T>();
  for (const item of items) result.set(key(item), item);
  return result;
}

/** Ключ праздника для поиска названия. */
export function holidayKey(calendarKey: HolidayCalendarKey, date: IsoDate): string {
  return `${calendarKey}|${date}`;
}

export function buildIndex(data: ScheduleDataset): DatasetIndex {
  const holidayDates = new Map<HolidayCalendarKey, Set<IsoDate>>();
  const holidayNames = new Map<string, string>();
  for (const holiday of data.holidays) {
    let dates = holidayDates.get(holiday.calendarKey);
    if (!dates) {
      dates = new Set<IsoDate>();
      holidayDates.set(holiday.calendarKey, dates);
    }
    dates.add(holiday.date);
    holidayNames.set(holidayKey(holiday.calendarKey, holiday.date), holiday.name);
  }

  return {
    locations: byId(data.locations, (l) => l.id),
    units: byId(data.units, (u) => u.id),
    roles: byId(data.roles, (r) => r.id),
    people: byId(data.people, (p) => p.id),
    rolesByUnit: groupBy(data.roles, (r) => r.unitId),
    peopleByUnit: groupBy(data.people, (p) => p.unitId),
    holidayDates,
    holidayNames,
    absencesByPerson: groupBy(data.absences, (a) => a.personId),
    compDaysByPerson: groupBy(data.compDays, (c) => c.personId),
    assignmentsByPerson: groupBy(data.assignments, (a) => a.personId),
    assignmentsByDate: groupBy(data.assignments, (a) => a.date),
  };
}

/** Достаёт сущность или бросает — используется там, где отсутствие означает баг. */
export function mustGet<K, V>(map: ReadonlyMap<K, V>, key: K, what: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`${what} не найден: ${String(key)}`);
  return value;
}
