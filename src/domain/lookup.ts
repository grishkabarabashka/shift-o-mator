/**
 * Индексы по датасету. Чистые функции движка получают их аргументом, чтобы не
 * пересобирать `Map` на каждый день периода.
 */

import type {
  Absence,
  Assignment,
  CompDayEntry,
  DayConfiguration,
  HolidayCalendarKey,
  IsoDate,
  Location,
  LocationId,
  Person,
  PersonId,
  PlanningUnit,
  Region,
  RegionId,
  RoleId,
  ScheduleDataset,
  ShiftDefinition,
  ShiftId,
  ShiftRole,
  UnitId,
} from './types.ts';

export interface DatasetIndex {
  readonly locations: ReadonlyMap<LocationId, Location>;
  readonly regions: ReadonlyMap<RegionId, Region>;
  readonly units: ReadonlyMap<UnitId, PlanningUnit>;
  readonly shifts: ReadonlyMap<ShiftId, ShiftDefinition>;
  readonly roles: ReadonlyMap<RoleId, ShiftRole>;
  readonly people: ReadonlyMap<PersonId, Person>;
  readonly rolesByRegion: ReadonlyMap<RegionId, readonly ShiftRole[]>;
  readonly peopleByRegion: ReadonlyMap<RegionId, readonly Person[]>;
  readonly peopleByUnit: ReadonlyMap<UnitId, readonly Person[]>;
  readonly dayConfigsByRegion: ReadonlyMap<RegionId, readonly DayConfiguration[]>;
  /** Праздничные даты по ключу календаря. */
  readonly holidayDates: ReadonlyMap<HolidayCalendarKey, ReadonlySet<IsoDate>>;
  readonly holidayNames: ReadonlyMap<string, string>;
  /** Праздники по локации: локация → множество дат. */
  readonly holidaysByLocation: ReadonlyMap<LocationId, ReadonlySet<IsoDate>>;
  readonly absencesByPerson: ReadonlyMap<PersonId, readonly Absence[]>;
  readonly compDaysByPerson: ReadonlyMap<PersonId, readonly CompDayEntry[]>;
  readonly assignmentsByPerson: ReadonlyMap<PersonId, readonly Assignment[]>;
  readonly assignmentsByCell: ReadonlyMap<string, Assignment>;
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

export function holidayKey(calendarKey: HolidayCalendarKey, date: IsoDate): string {
  return `${calendarKey}|${date}`;
}

/** Ключ ячейки сетки. */
export function cellKey(personId: PersonId, date: IsoDate): string {
  return `${personId}|${date}`;
}

export function buildIndex(data: ScheduleDataset): DatasetIndex {
  const holidayDates = new Map<HolidayCalendarKey, Set<IsoDate>>();
  const holidayNames = new Map<string, string>();
  const holidaysByLocation = new Map<LocationId, Set<IsoDate>>();

  const locationsByCalendar = groupBy(data.locations, (l) => l.holidayCalendarKey);

  for (const holiday of data.holidays) {
    for (const locationId of holiday.locationIds) {
      let dates = holidaysByLocation.get(locationId);
      if (!dates) {
        dates = new Set<IsoDate>();
        holidaysByLocation.set(locationId, dates);
      }
      dates.add(holiday.date);

      const location = data.locations.find((l) => l.id === locationId);
      if (!location) continue;
      let byCalendar = holidayDates.get(location.holidayCalendarKey);
      if (!byCalendar) {
        byCalendar = new Set<IsoDate>();
        holidayDates.set(location.holidayCalendarKey, byCalendar);
      }
      byCalendar.add(holiday.date);
      holidayNames.set(holidayKey(location.holidayCalendarKey, holiday.date), holiday.name);
    }
  }

  // Локации без собственных праздников всё равно должны иметь запись,
  // иначе поиск по локации вернёт undefined вместо пустого множества.
  for (const location of data.locations) {
    if (!holidaysByLocation.has(location.id)) holidaysByLocation.set(location.id, new Set());
  }
  for (const calendarKey of locationsByCalendar.keys()) {
    if (!holidayDates.has(calendarKey)) holidayDates.set(calendarKey, new Set());
  }

  const assignmentsByCell = new Map<string, Assignment>();
  for (const assignment of data.assignments) {
    assignmentsByCell.set(cellKey(assignment.personId, assignment.date), assignment);
  }

  return {
    locations: byId(data.locations, (l) => l.id),
    regions: byId(data.regions, (r) => r.id),
    units: byId(data.units, (u) => u.id),
    shifts: byId(data.shifts, (s) => s.id),
    roles: byId(data.roles, (r) => r.id),
    people: byId(data.people, (p) => p.id),
    rolesByRegion: groupBy(data.roles, (r) => r.regionId),
    peopleByRegion: groupBy(data.people, (p) => p.regionId),
    peopleByUnit: groupBy(data.people, (p) => p.unitId),
    dayConfigsByRegion: groupBy(data.dayConfigurations, (c) => c.regionId),
    holidayDates,
    holidayNames,
    holidaysByLocation,
    absencesByPerson: groupBy(data.absences, (a) => a.personId),
    compDaysByPerson: groupBy(data.compDays, (c) => c.personId),
    assignmentsByPerson: groupBy(data.assignments, (a) => a.personId),
    assignmentsByCell,
  };
}

/** Достаёт сущность или бросает — используется там, где отсутствие означает баг. */
export function mustGet<K, V>(map: ReadonlyMap<K, V>, key: K, what: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`${what} not found: ${String(key)}`);
  return value;
}
