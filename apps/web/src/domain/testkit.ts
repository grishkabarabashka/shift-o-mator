/**
 * NOTE: Constructors for minimal datasets used by engine tests.
 *
 * Fixtures don't fit here: they are large and change over time, while a test
 * should verify one rule against data that is entirely visible in the test itself.
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
  ScheduleDataset,
  Shift,
  Weekday,
} from './types.ts';

const WEEKEND: readonly Weekday[] = [6, 7];

export const nyLocation: Location = {
  id: 'loc-ny',
  name: 'New York',
  country: 'United States',
  timeZone: 'America/New_York',
  holidayCalendarKey: 'US',
  weekendDays: WEEKEND,
};

export const puneLocation: Location = {
  id: 'loc-pune',
  name: 'Pune',
  country: 'India',
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

export const testUnit: PlanningUnit = {
  id: 'unit-1',
  name: 'Test unit',
  kind: 'REGION',
  groupBy: 'LOCATION',
  primaryLocationId: nyLocation.id,
  locationIds: [nyLocation.id, puneLocation.id],
  compOffPolicy: testCompOffPolicy,
};

export const leadShift: Shift = {
  id: 'r-lead',
  unitId: testUnit.id,
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

export const nightShift: Shift = {
  id: 'r-night',
  unitId: testUnit.id,
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

/** NOTE: Weekdays Mon-Fri, both shifts with no requirements — the test adds its own. */
export function makeDayConfig(
  overrides: Partial<DayConfiguration> & Pick<DayConfiguration, 'id' | 'key'>,
): DayConfiguration {
  return {
    unitId: testUnit.id,
    weekdays: overrides.key === 'weekend' ? [6, 7] : [1, 2, 3, 4, 5],
    effectiveFrom: '2020-01-01',
    shiftRequirements: [],
    ...overrides,
  };
}

export function makePerson(overrides: Partial<Person> & Pick<Person, 'id'>): Person {
  return {
    displayName: overrides.id,
    initials: overrides.id.slice(0, 2).toUpperCase(),
    unitId: testUnit.id,
    locationId: nyLocation.id,
    defaultShiftId: leadShift.id,
    orgCategory: 'SUPPORT',
    isActive: true,
    isIncluded: true,
    eligibility: [{ shiftId: leadShift.id, targetShare: 1 }],
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
  shiftIdOrContent: string | AssignmentContent,
  date: string,
  overrides: Partial<Assignment> = {},
): Assignment {
  assignmentSeq += 1;
  const content: AssignmentContent =
    typeof shiftIdOrContent === 'string'
      ? { kind: 'SHIFT', shiftId: shiftIdOrContent }
      : shiftIdOrContent;
  return {
    id: `as-${assignmentSeq}`,
    personId,
    date,
    unitId: testUnit.id,
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
  readonly units?: readonly PlanningUnit[];
  readonly shifts?: readonly Shift[];
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
    units: overrides.units ?? [testUnit],
    shifts: overrides.shifts ?? [leadShift, nightShift],
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
