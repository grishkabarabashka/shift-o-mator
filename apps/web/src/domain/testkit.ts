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
  EventType,
  PresenceRecord,
  PresenceType,
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
    weekdays: overrides.key === 'WEEKEND' ? [6, 7] : [1, 2, 3, 4, 5],
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
    defaultPresenceTypeId: 'pt-office',
    isActive: true,
    isIncluded: true,
    eligibility: [{ shiftId: leadShift.id, targetShare: 1 }],
    availableWeekdays: [1, 2, 3, 4, 5, 6, 7],
    weekendEligible: true,
    constraints: { minRestHours: 11, maxConsecutiveDays: 6 },
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
  readonly presence?: readonly PresenceRecord[];
  readonly eventTypes?: readonly EventType[];
  readonly presenceTypes?: readonly PresenceType[];
}

/** NOTE: One row per kind (ADR-0043). Presence renders from a fallback when these are
 * missing, so a test that leaves them out still gets marks — this is what lets a test
 * assert on a *configured* label or colour. */
export const TEST_PRESENCE_TYPES: readonly PresenceType[] = [
  { id: 'pt-office', label: 'In the office', glyph: 'O', color: '#15803d', namesALocation: true, countsAs: 'ON_SITE', requiresApproval: false, isActive: true, sortOrder: 1 },
  { id: 'pt-remote', label: 'Remote', glyph: 'R', color: '#2563eb', namesALocation: false, countsAs: 'REMOTE', requiresApproval: true, isActive: true, sortOrder: 2 },
  { id: 'pt-travel', label: 'Travelling', glyph: 'T', color: '#b45309', namesALocation: false, countsAs: 'AWAY', requiresApproval: false, isActive: true, sortOrder: 3 },
  { id: 'pt-customer-site', label: 'On customer site', glyph: 'C', color: '#9333ea', namesALocation: false, countsAs: 'AWAY', requiresApproval: false, isActive: true, sortOrder: 4 },
];

/** NOTE: Minimal set so a projection has something to resolve (ADR-0049). */
export const TEST_EVENT_TYPES: readonly EventType[] = [
  {
    id: 'et-vacation',
    code: 'VACATION',
    label: 'Annual leave',
    shortLabel: 'Leave',
    color: '#7c9cf5',
    category: 'LEAVE',
    blocksAssignment: true,
    countsTowardCapacity: true,
    requiresApproval: true,
    allowsHalfDay: true,
    isActive: true,
    sortOrder: 1,
  },
  {
    id: 'et-sick',
    code: 'SICK',
    label: 'Sick leave',
    shortLabel: 'Sick',
    color: '#e08c8c',
    category: 'SICKNESS',
    blocksAssignment: true,
    countsTowardCapacity: false,
    // Requested like any other leave (ADR-0052).
    requiresApproval: true,
    allowsHalfDay: true,
    isActive: true,
    sortOrder: 2,
  },
  {
    id: 'et-unavailable',
    code: 'UNAVAILABLE',
    label: 'Not available',
    shortLabel: 'N/A',
    color: '#8f97a3',
    category: 'OTHER',
    // What replaced the OFF / NOT_SCHEDULED markers: a declaration of availability, so
    // no approval, and the only seeded type that can be written directly.
    blocksAssignment: true,
    countsTowardCapacity: false,
    requiresApproval: false,
    allowsHalfDay: true,
    isActive: true,
    sortOrder: 3,
  },
];

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
    eventTypes: overrides.eventTypes ?? TEST_EVENT_TYPES,
    presenceTypes: overrides.presenceTypes ?? TEST_PRESENCE_TYPES,
    presence: overrides.presence ?? [],
    acknowledgements: [],
    history: [],
  };
}
