/**
 * Конструкторы минимальных датасетов для тестов движка.
 *
 * Фикстуры для этого не годятся: они большие и меняются, а тест должен
 * проверять одно правило на данных, которые целиком видны в самом тесте.
 */

import type {
  Absence,
  Assignment,
  AssignmentContent,
  CompDayEntry,
  CompOffPolicy,
  DayConfiguration,
  Holiday,
  Location,
  Person,
  PlanningUnit,
  Region,
  ScheduleDataset,
  ShiftDefinition,
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

export const testCompOffPolicy: CompOffPolicy = {
  windowBeforeDays: 14,
  windowAfterDays: 14,
  excludedWeekdays: [1, 5],
  agingThresholdDays: 14,
  requiresApprovalWhenNoSlot: true,
};

export const testRegion: Region = {
  id: 'R1',
  name: 'Test region',
  primaryTimeZone: 'America/New_York',
  primaryLocationId: nyLocation.id,
  locationIds: [nyLocation.id, puneLocation.id],
  compOffPolicy: testCompOffPolicy,
};

export const testUnit: PlanningUnit = {
  id: 'unit-1',
  name: 'Test unit',
  kind: 'REGION',
  regionId: testRegion.id,
  groupBy: 'LOCATION',
};

export const testShift: ShiftDefinition = {
  id: 'sh-1',
  regionId: testRegion.id,
  code: 'TEST',
  name: 'Test shift',
  timeZone: 'America/New_York',
  start: '09:00',
  end: '17:00',
  crossesMidnight: false,
  breakMinutes: 60,
};

export const leadRole: ShiftRole = {
  id: 'r-lead',
  regionId: testRegion.id,
  code: 'Lead',
  label: 'Shift lead',
  color: '#3f6fb5',
  hotkey: 'l',
  timeZone: 'America/New_York',
  start: '07:00',
  end: '15:00',
  crossesMidnight: false,
  breakMinutes: 60,
  countsAsCoverage: true,
  editableTime: false,
};

export const nightRole: ShiftRole = {
  id: 'r-night',
  regionId: testRegion.id,
  code: 'Night',
  label: 'Night cover',
  color: '#5c4a7d',
  hotkey: 'n',
  timeZone: 'America/New_York',
  start: '22:00',
  end: '06:00',
  crossesMidnight: true,
  breakMinutes: 0,
  countsAsCoverage: true,
  editableTime: false,
};

/** Будни Пн–Пт, обе роли без требований — тест добавляет свои. */
export function makeDayConfig(
  overrides: Partial<DayConfiguration> & Pick<DayConfiguration, 'id' | 'key'>,
): DayConfiguration {
  return {
    regionId: testRegion.id,
    weekdays: overrides.key === 'weekend' ? [6, 7] : [1, 2, 3, 4, 5],
    effectiveFrom: '2020-01-01',
    roleRequirements: [],
    ...overrides,
  };
}

export function makePerson(overrides: Partial<Person> & Pick<Person, 'id'>): Person {
  return {
    displayName: overrides.id,
    initials: overrides.id.slice(0, 2).toUpperCase(),
    regionId: testRegion.id,
    unitId: testUnit.id,
    locationId: nyLocation.id,
    defaultShiftId: testShift.id,
    orgCategory: 'SUPPORT',
    isActive: true,
    isIncluded: true,
    eligibility: [{ roleId: leadRole.id, targetShare: 1 }],
    availableWeekdays: [1, 2, 3, 4, 5, 6, 7],
    weekendEligible: true,
    constraints: { minRestHours: 11, maxConsecutiveDays: 6 },
    calendarToken: `tok-${overrides.id}`,
    ...overrides,
  };
}

let assignmentSeq = 0;

export function makeAssignment(
  personId: string,
  roleIdOrContent: string | AssignmentContent,
  date: string,
  overrides: Partial<Assignment> = {},
): Assignment {
  assignmentSeq += 1;
  const content: AssignmentContent =
    typeof roleIdOrContent === 'string'
      ? { kind: 'ROLE', roleId: roleIdOrContent }
      : roleIdOrContent;
  return {
    id: `as-${assignmentSeq}`,
    personId,
    date,
    regionId: testRegion.id,
    content,
    isWeekend: false,
    source: 'MANUAL',
    version: 1,
    createdBy: 'p-planner',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export interface DatasetOverrides {
  readonly locations?: readonly Location[];
  readonly holidays?: readonly Holiday[];
  readonly regions?: readonly Region[];
  readonly units?: readonly PlanningUnit[];
  readonly shifts?: readonly ShiftDefinition[];
  readonly roles?: readonly ShiftRole[];
  readonly dayConfigurations?: readonly DayConfiguration[];
  readonly people?: readonly Person[];
  readonly assignments?: readonly Assignment[];
  readonly absences?: readonly Absence[];
  readonly compDays?: readonly CompDayEntry[];
}

export function makeDataset(overrides: DatasetOverrides = {}): ScheduleDataset {
  return {
    locations: overrides.locations ?? [nyLocation, puneLocation],
    holidays: overrides.holidays ?? [],
    regions: overrides.regions ?? [testRegion],
    units: overrides.units ?? [testUnit],
    shifts: overrides.shifts ?? [testShift],
    roles: overrides.roles ?? [leadRole, nightRole],
    dayConfigurations: overrides.dayConfigurations ?? [],
    people: overrides.people ?? [makePerson({ id: 'p-1' })],
    absenceCapacityRules: [],
    assignments: overrides.assignments ?? [],
    absences: overrides.absences ?? [],
    compDays: overrides.compDays ?? [],
    acknowledgements: [],
    history: [],
  };
}
