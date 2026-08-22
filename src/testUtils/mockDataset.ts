/**
 * Compact hand-built dataset for the MSW-backed tests (Phase 5 step 6).
 *
 * Replaces the ~700-line `domain/fixtures.ts` deleted with the memory
 * repository: small on purpose, but keeps the same shape of reality the old
 * fixtures exercised — three locations, a Friday-only role group, a role
 * belonging to a different region that must never leak into AMER's picker.
 */

import type {
  DayConfiguration,
  Location,
  Person,
  PlanningUnit,
  Region,
  ScheduleDataset,
  ShiftDefinition,
  ShiftRole,
} from '../domain/types.ts';

export const DEFAULT_UNIT = 'unit-amer';

export const locChicago: Location = {
  id: 'loc-chi',
  name: 'Chicago',
  timeZone: 'America/Chicago',
  holidayCalendarKey: 'US',
  weekendDays: [6, 7],
};
export const locNewYork: Location = {
  id: 'loc-nyc',
  name: 'New York',
  timeZone: 'America/New_York',
  holidayCalendarKey: 'US',
  weekendDays: [6, 7],
};
export const locPune: Location = {
  id: 'loc-pune',
  name: 'Pune',
  timeZone: 'Asia/Kolkata',
  holidayCalendarKey: 'IN',
  weekendDays: [6, 7],
};
export const locLondon: Location = {
  id: 'loc-lon',
  name: 'London',
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

export const amerRegion: Region = {
  id: 'AMER',
  name: 'Americas',
  primaryTimeZone: 'America/New_York',
  primaryLocationId: locNewYork.id,
  locationIds: [locNewYork.id, locChicago.id, locPune.id],
  compOffPolicy,
};
export const emeaRegion: Region = {
  id: 'EMEA',
  name: 'EMEA',
  primaryTimeZone: 'Europe/London',
  primaryLocationId: locLondon.id,
  locationIds: [locLondon.id],
  compOffPolicy,
};

export const amerUnit: PlanningUnit = {
  id: DEFAULT_UNIT,
  name: 'Americas',
  kind: 'REGION',
  regionId: amerRegion.id,
  groupBy: 'LOCATION',
};
export const emeaUnit: PlanningUnit = {
  id: 'unit-emea',
  name: 'EMEA',
  kind: 'REGION',
  regionId: emeaRegion.id,
  groupBy: 'LOCATION',
};

export const amerShift: ShiftDefinition = {
  id: 'sh-amer',
  regionId: amerRegion.id,
  code: 'AMER',
  name: 'AMER standard',
  timeZone: 'America/New_York',
  start: '09:00',
  end: '17:00',
  crossesMidnight: false,
  breakMinutes: 60,
};

export const leadRole: ShiftRole = {
  id: 'AMER:Lead',
  regionId: amerRegion.id,
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
export const leadFridayRole: ShiftRole = {
  ...leadRole,
  id: 'AMER:Lead-E',
  code: 'Lead-E',
  label: 'Shift lead (Friday early)',
};
export const coverRole: ShiftRole = {
  id: 'AMER:Cover',
  regionId: amerRegion.id,
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
export const batchRole: ShiftRole = {
  id: 'AMER:Batch-E',
  regionId: amerRegion.id,
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
/** EMEA-only role — must never appear in an AMER person's picker/coverage. */
export const emeaModRole: ShiftRole = {
  id: 'EMEA:M',
  regionId: emeaRegion.id,
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

export const emeaShift: ShiftDefinition = {
  id: 'sh-emea',
  regionId: emeaRegion.id,
  code: 'EMEA',
  name: 'EMEA standard',
  timeZone: 'Europe/London',
  start: '08:00',
  end: '16:00',
  crossesMidnight: false,
  breakMinutes: 60,
};

export const emeaWeekdayConfig: DayConfiguration = {
  id: 'dc-emea-weekday',
  regionId: emeaRegion.id,
  key: 'weekday',
  weekdays: [1, 2, 3, 4, 5],
  effectiveFrom: '2020-01-01',
  roleRequirements: [{ roleId: emeaModRole.id, min: 1, isDefault: true }],
};

export const weekdayConfig: DayConfiguration = {
  id: 'dc-amer-weekday',
  regionId: amerRegion.id,
  key: 'weekday',
  weekdays: [1, 2, 3, 4],
  effectiveFrom: '2020-01-01',
  roleRequirements: [
    { roleId: leadRole.id, min: 1, isDefault: true },
    { roleId: coverRole.id, min: 1, isDefault: true },
    { roleId: batchRole.id, min: 1, isDefault: true },
  ],
};
export const fridayConfig: DayConfiguration = {
  id: 'dc-amer-friday',
  regionId: amerRegion.id,
  key: 'friday',
  weekdays: [5],
  effectiveFrom: '2020-01-01',
  roleRequirements: [
    { roleId: leadFridayRole.id, min: 1, isDefault: true },
    { roleId: coverRole.id, min: 1, isDefault: true },
  ],
};
export const weekendConfig: DayConfiguration = {
  id: 'dc-amer-weekend',
  regionId: amerRegion.id,
  key: 'weekend',
  weekdays: [6, 7],
  effectiveFrom: '2020-01-01',
  roleRequirements: [{ roleId: coverRole.id, min: 1, isDefault: true }],
};

function makePerson(id: string, displayName: string, locationId: string): Person {
  return {
    id,
    displayName,
    initials: displayName
      .split(' ')
      .map((p) => p[0])
      .join(''),
    regionId: amerRegion.id,
    unitId: amerUnit.id,
    locationId,
    defaultShiftId: amerShift.id,
    orgCategory: 'SUPPORT',
    isActive: true,
    isIncluded: true,
    eligibility: [
      { roleId: coverRole.id, targetShare: 0.5 },
      { roleId: leadRole.id, targetShare: 0.3 },
      { roleId: leadFridayRole.id, targetShare: 0.2 },
    ],
    availableWeekdays: [1, 2, 3, 4, 5],
    weekendEligible: false,
    constraints: { minRestHours: 11, maxConsecutiveDays: 6 },
    calendarToken: `tok-${id}`,
  };
}

function makeEmeaPerson(id: string, displayName: string): Person {
  return {
    id,
    displayName,
    initials: displayName
      .split(' ')
      .map((p) => p[0])
      .join(''),
    regionId: emeaRegion.id,
    unitId: emeaUnit.id,
    locationId: locLondon.id,
    defaultShiftId: emeaShift.id,
    orgCategory: 'SUPPORT',
    isActive: true,
    isIncluded: true,
    eligibility: [{ roleId: emeaModRole.id, targetShare: 1 }],
    availableWeekdays: [1, 2, 3, 4, 5],
    weekendEligible: false,
    constraints: { minRestHours: 11, maxConsecutiveDays: 6 },
    calendarToken: `tok-${id}`,
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
];

export function buildMockDataset(): ScheduleDataset {
  return {
    locations: [locChicago, locNewYork, locPune, locLondon],
    holidays: [],
    regions: [amerRegion, emeaRegion],
    units: [amerUnit, emeaUnit],
    shifts: [amerShift, emeaShift],
    roles: [leadRole, leadFridayRole, coverRole, batchRole, emeaModRole],
    dayConfigurations: [weekdayConfig, fridayConfig, weekendConfig, emeaWeekdayConfig],
    people,
    absenceCapacityRules: [],
    assignments: [],
    absences: [],
    compDays: [],
    acknowledgements: [],
    history: [],
  };
}
