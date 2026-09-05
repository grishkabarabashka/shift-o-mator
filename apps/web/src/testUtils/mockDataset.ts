/**
 * Compact hand-built dataset for the MSW-backed tests (Phase 5 step 6).
 *
 * Replaces the ~700-line `domain/fixtures.ts` deleted with the memory
 * repository: small on purpose, but keeps the same shape of reality the old
 * fixtures exercised — three locations, a Friday-only shift group, a shift
 * belonging to a different unit that must never leak into AMER's picker.
 *
 * Phase 8 deleted Region and merged `ShiftRole`/`ShiftDefinition` into one
 * `Shift` entity; this fixture follows.
 */

import { TEST_EVENT_TYPES, TEST_PRESENCE_TYPES } from '../domain/testkit.ts';
import type {
  DayConfiguration,
  Location,
  Person,
  PlanningUnit,
  ScheduleDataset,
  Shift,
  CompDayEntry,
} from '../domain/types.ts';

export const DEFAULT_UNIT = 'unit-amer';

export const locChicago: Location = {
  id: 'loc-chi',
  name: 'Chicago',
  country: 'United States',
  timeZone: 'America/Chicago',
  holidayCalendarKey: 'US',
  weekendDays: [6, 7],
};
export const locNewYork: Location = {
  id: 'loc-nyc',
  name: 'New York',
  country: 'United States',
  timeZone: 'America/New_York',
  holidayCalendarKey: 'US',
  weekendDays: [6, 7],
};
export const locPune: Location = {
  id: 'loc-pune',
  name: 'Pune',
  country: 'India',
  timeZone: 'Asia/Kolkata',
  holidayCalendarKey: 'IN',
  weekendDays: [6, 7],
};
export const locLondon: Location = {
  id: 'loc-lon',
  name: 'London',
  country: 'United Kingdom',
  timeZone: 'Europe/London',
  holidayCalendarKey: 'UK',
  weekendDays: [6, 7],
};

const compOffPolicy = {
  windowBeforeDays: 14,
  windowAfterDays: 14,
  excludedWeekdays: [1, 5] as const,
  agingThresholdDays: 14,
  requiresApprovalWhenNoSlot: true,
};

export const amerUnit: PlanningUnit = {
  id: DEFAULT_UNIT,
  name: 'Americas',
  kind: 'REGION',
  groupBy: 'LOCATION',
  primaryLocationId: locNewYork.id,
  locationIds: [locNewYork.id, locChicago.id, locPune.id],
  compOffPolicy,
};
export const emeaUnit: PlanningUnit = {
  id: 'unit-emea',
  name: 'EMEA',
  kind: 'REGION',
  groupBy: 'LOCATION',
  primaryLocationId: locLondon.id,
  locationIds: [locLondon.id],
  compOffPolicy,
};

export const leadShift: Shift = {
  id: 'AMER:Lead',
  unitId: amerUnit.id,
  code: 'Lead',
  label: 'Shift lead',
  color: '#3f6fb5',
  hotkey: 'l',
  timeZone: 'America/New_York',
  start: '09:00',
  end: '18:00',
  crossesMidnight: false,
  breakMinutes: 60,
  countsAsCoverage: true,
  editableTime: false,
};
export const leadFridayShift: Shift = {
  ...leadShift,
  id: 'AMER:Lead-E',
  code: 'Lead-E',
  label: 'Shift lead (Friday early)',
};
export const coverShift: Shift = {
  id: 'AMER:Cover',
  unitId: amerUnit.id,
  code: 'Cover',
  label: 'Cover / engineering',
  color: '#4a7d3f',
  hotkey: 'o',
  timeZone: 'America/New_York',
  start: '09:00',
  end: '18:00',
  crossesMidnight: false,
  breakMinutes: 60,
  countsAsCoverage: true,
  editableTime: false,
};
export const batchShift: Shift = {
  id: 'AMER:Batch-E',
  unitId: amerUnit.id,
  code: 'Batch-E',
  label: 'Batch early',
  color: '#8a6a2f',
  hotkey: 'b',
  timeZone: 'America/Chicago',
  start: '09:00',
  end: '18:00',
  crossesMidnight: false,
  breakMinutes: 60,
  countsAsCoverage: true,
  editableTime: false,
};
/** EMEA-only shift — must never appear in an AMER person's picker/coverage. */
export const emeaModShift: Shift = {
  id: 'EMEA:M',
  unitId: emeaUnit.id,
  code: 'M',
  label: 'EMEA moderator',
  color: '#a03f3f',
  timeZone: 'Europe/London',
  start: '08:00',
  end: '16:00',
  crossesMidnight: false,
  breakMinutes: 60,
  countsAsCoverage: true,
  editableTime: false,
};

export const emeaWeekdayConfig: DayConfiguration = {
  id: 'dc-emea-weekday',
  unitId: emeaUnit.id,
  key: 'WEEKDAY',
  weekdays: [1, 2, 3, 4, 5],
  effectiveFrom: '2020-01-01',
  shiftRequirements: [{ shiftId: emeaModShift.id, min: 1, isDefault: true }],
};

export const weekdayConfig: DayConfiguration = {
  id: 'dc-amer-weekday',
  unitId: amerUnit.id,
  key: 'WEEKDAY',
  weekdays: [1, 2, 3, 4],
  effectiveFrom: '2020-01-01',
  shiftRequirements: [
    { shiftId: leadShift.id, min: 1, isDefault: true },
    { shiftId: coverShift.id, min: 1, isDefault: true },
    { shiftId: batchShift.id, min: 1, isDefault: true },
  ],
};
export const fridayConfig: DayConfiguration = {
  id: 'dc-amer-friday',
  unitId: amerUnit.id,
  key: 'FRIDAY',
  weekdays: [5],
  effectiveFrom: '2020-01-01',
  shiftRequirements: [
    { shiftId: leadFridayShift.id, min: 1, isDefault: true },
    { shiftId: coverShift.id, min: 1, isDefault: true },
  ],
};
export const weekendConfig: DayConfiguration = {
  id: 'dc-amer-weekend',
  unitId: amerUnit.id,
  key: 'WEEKEND',
  weekdays: [6, 7],
  effectiveFrom: '2020-01-01',
  shiftRequirements: [{ shiftId: coverShift.id, min: 1, isDefault: true }],
};

function makePerson(id: string, displayName: string, locationId: string): Person {
  return {
    id,
    defaultPresenceTypeId: 'pt-office',
    displayName,
    initials: displayName
      .split(' ')
      .map((p) => p[0])
      .join(''),
    unitId: amerUnit.id,
    locationId,
    defaultShiftId: leadShift.id,
    orgCategory: 'SUPPORT',
    isActive: true,
    isIncluded: true,
    eligibility: [
      { shiftId: coverShift.id, targetShare: 0.5 },
      { shiftId: leadShift.id, targetShare: 0.3 },
      { shiftId: leadFridayShift.id, targetShare: 0.2 },
    ],
    availableWeekdays: [1, 2, 3, 4, 5],
    weekendEligible: false,
    constraints: { minRestHours: 11, maxConsecutiveDays: 6 },
  };
}

function makeEmeaPerson(id: string, displayName: string): Person {
  return {
    id,
    defaultPresenceTypeId: 'pt-office',
    displayName,
    initials: displayName
      .split(' ')
      .map((p) => p[0])
      .join(''),
    unitId: emeaUnit.id,
    locationId: locLondon.id,
    defaultShiftId: emeaModShift.id,
    orgCategory: 'SUPPORT',
    isActive: true,
    isIncluded: true,
    eligibility: [{ shiftId: emeaModShift.id, targetShare: 1 }],
    availableWeekdays: [1, 2, 3, 4, 5],
    weekendEligible: false,
    constraints: { minRestHours: 11, maxConsecutiveDays: 6 },
  };
}

/**
 * A manager: `isIncluded: false`, so no shift is ever planned for them.
 *
 * They still need a row. `isIncluded` decides who is *planned*; it was also deciding who
 * is *drawn*, and the result was that an administrator existed in the list only while you
 * were acting as them.
 */
function makeManager(id: string, displayName: string): Person {
  return {
    ...makePerson(id, displayName, locNewYork.id),
    orgCategory: 'MANAGEMENT',
    isIncluded: false,
    eligibility: [],
  };
}

export const people: Person[] = [
  makePerson('p-alice', 'Alice Anders', locNewYork.id),
  makePerson('p-bob', 'Bob Brown', locNewYork.id),
  makePerson('p-carol', 'Carol Chu', locChicago.id),
  makePerson('p-dave', 'Dave Diaz', locChicago.id),
  makePerson('p-erin', 'Erin Evans', locPune.id),
  makePerson('p-frank', 'Frank Ford', locPune.id),
  makeEmeaPerson('p-priya', 'Priya Patel'),
  // Two managers, and the reason is the test rather than realism: the mock signs you in as
  // the first MANAGEMENT person, exactly as the server does, and a manager who *is* the
  // caller was drawn under the old rule as well. With a second one, the row that only the
  // corrected rule draws is somebody else.
  makeManager('p-morgan', 'Morgan Mills'),
  makeManager('p-nadia', 'Nadia Novak'),
];

/**
 * One earned comp day, so the placement flow has something to place (ADR-0052).
 *
 * Dates are relative to today because the Schedule window now runs forward from the
 * selected day: a fixed date would fall outside it as soon as the clock moved.
 */
function demoCompDay(): CompDayEntry {
  const earned = new Date();
  earned.setUTCDate(earned.getUTCDate() - 7);
  const proposed = new Date();
  proposed.setUTCDate(proposed.getUTCDate() + 3);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  return {
    id: 'cd-mock-1',
    personId: 'p-alice',
    earnedForAssignmentId: 'as-mock-weekend',
    earnedForDate: iso(earned),
    trigger: 'SATURDAY',
    proposedDate: iso(proposed),
    status: 'PROPOSED',
    version: 1,
  };
}

export function buildMockDataset(): ScheduleDataset {
  return {
    locations: [locChicago, locNewYork, locPune, locLondon],
    holidays: [],
    units: [amerUnit, emeaUnit],
    shifts: [leadShift, leadFridayShift, coverShift, batchShift, emeaModShift],
    dayConfigurations: [weekdayConfig, fridayConfig, weekendConfig, emeaWeekdayConfig],
    people,
    absenceCapacityRules: [],
    assignments: [],
    absences: [],
    compDays: [demoCompDay()],
    presence: [],
    eventTypes: TEST_EVENT_TYPES,
    presenceTypes: TEST_PRESENCE_TYPES,
    acknowledgements: [],
    history: [],
  };
}
