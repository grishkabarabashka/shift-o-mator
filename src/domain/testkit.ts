/**
 * Конструкторы минимальных датасетов для тестов движка.
 *
 * Фикстуры для этого не годятся: они большие и меняются, а тест должен
 * проверять одно правило на данных, которые целиком видны в самом тесте.
 */

import type {
  Absence,
  Assignment,
  CompDayEntry,
  CoverageRule,
  Holiday,
  Location,
  Person,
  PlanningUnit,
  ScheduleDataset,
  ShiftRole,
  Weekday,
} from './types.ts';

const WEEKEND: readonly Weekday[] = [6, 7];

export const nyLocation: Location = {
  id: 'loc-ny',
  name: 'New York',
  timeZone: 'America/New_York',
  holidayCalendarKey: 'US',
  weekendDays: WEEKEND,
};

export const puneLocation: Location = {
  id: 'loc-pune',
  name: 'Pune',
  timeZone: 'Asia/Kolkata',
  holidayCalendarKey: 'IN',
  weekendDays: WEEKEND,
};

export const testUnit: PlanningUnit = {
  id: 'unit-1',
  name: 'Test unit',
  plannerPersonIds: ['p-planner'],
  compDayPolicy: {
    rules: [
      { workedOn: 'SATURDAY', defaultOffsetDays: -2 },
      { workedOn: 'SUNDAY', defaultOffsetDays: 2 },
      { workedOn: 'HOLIDAY', defaultOffsetDays: 3 },
    ],
    expiryWeeks: 12,
  },
  coverageCalendarLocationId: nyLocation.id,
};

export const leadRole: ShiftRole = {
  id: 'r-sl',
  unitId: testUnit.id,
  code: 'SL',
  label: 'Shift lead',
  color: '#3f6fb5',
  hotkey: 'l',
  timeZone: 'America/New_York',
  start: '07:00',
  end: '15:00',
  crossesMidnight: false,
  editableTime: false,
  countsAsCoverage: true,
};

export const nightRole: ShiftRole = {
  id: 'r-night',
  unitId: testUnit.id,
  code: 'NIGHT',
  label: 'Night cover',
  color: '#5c4a7d',
  hotkey: 'n',
  timeZone: 'America/New_York',
  start: '22:00',
  end: '06:00',
  crossesMidnight: true,
  editableTime: false,
  countsAsCoverage: true,
};

export function makePerson(overrides: Partial<Person> & Pick<Person, 'id'>): Person {
  return {
    displayName: overrides.id,
    employeeId: overrides.id,
    unitId: testUnit.id,
    locationId: nyLocation.id,
    isPlannerOnly: false,
    eligibility: [{ roleId: leadRole.id, targetShare: 1 }],
    availableWeekdays: [1, 2, 3, 4, 5, 6, 7],
    constraints: { minRestHours: 11, maxConsecutiveDays: 6 },
    calendarToken: `tok-${overrides.id}`,
    ...overrides,
  };
}

let assignmentSeq = 0;

export function makeAssignment(
  personId: string,
  roleId: string,
  date: string,
  overrides: Partial<Assignment> = {},
): Assignment {
  assignmentSeq += 1;
  return {
    id: `as-${assignmentSeq}`,
    personId,
    roleId,
    date,
    source: 'MANUAL',
    createdBy: 'p-planner',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export interface DatasetOverrides {
  readonly locations?: readonly Location[];
  readonly holidays?: readonly Holiday[];
  readonly units?: readonly PlanningUnit[];
  readonly roles?: readonly ShiftRole[];
  readonly people?: readonly Person[];
  readonly coverageRules?: readonly CoverageRule[];
  readonly assignments?: readonly Assignment[];
  readonly absences?: readonly Absence[];
  readonly compDays?: readonly CompDayEntry[];
}

export function makeDataset(overrides: DatasetOverrides = {}): ScheduleDataset {
  return {
    locations: overrides.locations ?? [nyLocation, puneLocation],
    holidays: overrides.holidays ?? [],
    units: overrides.units ?? [testUnit],
    roles: overrides.roles ?? [leadRole, nightRole],
    people: overrides.people ?? [makePerson({ id: 'p-1' })],
    coverageRules: overrides.coverageRules ?? [],
    absenceCapacityRules: [],
    assignments: overrides.assignments ?? [],
    absences: overrides.absences ?? [],
    compDays: overrides.compDays ?? [],
    acknowledgements: [],
  };
}
