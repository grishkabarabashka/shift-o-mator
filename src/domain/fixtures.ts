/**
 * Тестовые данные.
 *
 * ВАЖНО: реальных данных пока нет. Всё, что помечено `ASSUMPTION`, — коды ролей,
 * их окна, минимумы покрытия, смещения comp days — предположения, подлежащие
 * замене после разговора с владельцем. См. Docs/10-open-questions.md.
 *
 * Данные детерминированы: один и тот же вызов даёт один и тот же датасет,
 * иначе тесты и скриншоты поплывут.
 */

import { DateTime } from 'luxon';
import type {
  Absence,
  AbsenceCapacityRule,
  Assignment,
  CoverageRule,
  Holiday,
  IsoDate,
  Location,
  Person,
  PlanningUnit,
  RoleEligibility,
  ScheduleDataset,
  ShiftRole,
  Weekday,
} from './types.ts';

const SYSTEM: string = 'system';
const CREATED_AT = '2026-08-01T00:00:00Z';

/** Период, который открывается по умолчанию. */
export const DEFAULT_PERIOD = { from: '2026-08-01', to: '2026-08-31' } as const;

// ---------------------------------------------------------------------------
// Детерминированный генератор
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], rnd: () => number): T {
  const item = items[Math.floor(rnd() * items.length)];
  if (item === undefined) throw new Error('Пустой список для выбора');
  return item;
}

// ---------------------------------------------------------------------------
// Локации
// ---------------------------------------------------------------------------

const WEEKEND: readonly Weekday[] = [6, 7];

export const locations: readonly Location[] = [
  { id: 'loc-ny', name: 'New York', timeZone: 'America/New_York', holidayCalendarKey: 'US', weekendDays: WEEKEND },
  { id: 'loc-chi', name: 'Chicago', timeZone: 'America/Chicago', holidayCalendarKey: 'US', weekendDays: WEEKEND },
  { id: 'loc-pune', name: 'Pune', timeZone: 'Asia/Kolkata', holidayCalendarKey: 'IN', weekendDays: WEEKEND },
  { id: 'loc-lon', name: 'London', timeZone: 'Europe/London', holidayCalendarKey: 'GB', weekendDays: WEEKEND },
  { id: 'loc-zrh', name: 'Zurich', timeZone: 'Europe/Zurich', holidayCalendarKey: 'CH', weekendDays: WEEKEND },
  { id: 'loc-sgp', name: 'Singapore', timeZone: 'Asia/Singapore', holidayCalendarKey: 'SG', weekendDays: WEEKEND },
];

/** ASSUMPTION: сокращённые календари на 2026 год, только заметные даты. */
export const holidays: readonly Holiday[] = [
  { calendarKey: 'US', date: '2026-01-01', name: "New Year's Day" },
  { calendarKey: 'US', date: '2026-05-25', name: 'Memorial Day' },
  { calendarKey: 'US', date: '2026-07-03', name: 'Independence Day (observed)' },
  { calendarKey: 'US', date: '2026-09-07', name: 'Labor Day' },
  { calendarKey: 'US', date: '2026-11-26', name: 'Thanksgiving' },
  { calendarKey: 'US', date: '2026-12-25', name: 'Christmas Day' },

  { calendarKey: 'GB', date: '2026-01-01', name: "New Year's Day" },
  { calendarKey: 'GB', date: '2026-04-03', name: 'Good Friday' },
  { calendarKey: 'GB', date: '2026-05-04', name: 'Early May Bank Holiday' },
  { calendarKey: 'GB', date: '2026-08-31', name: 'Summer Bank Holiday' },
  { calendarKey: 'GB', date: '2026-12-25', name: 'Christmas Day' },
  { calendarKey: 'GB', date: '2026-12-28', name: 'Boxing Day (observed)' },

  { calendarKey: 'CH', date: '2026-01-01', name: 'Neujahr' },
  { calendarKey: 'CH', date: '2026-04-03', name: 'Karfreitag' },
  { calendarKey: 'CH', date: '2026-08-01', name: 'Bundesfeier' },
  { calendarKey: 'CH', date: '2026-12-25', name: 'Weihnachten' },

  { calendarKey: 'IN', date: '2026-01-26', name: 'Republic Day' },
  { calendarKey: 'IN', date: '2026-08-15', name: 'Independence Day' },
  { calendarKey: 'IN', date: '2026-10-02', name: 'Gandhi Jayanti' },
  { calendarKey: 'IN', date: '2026-11-08', name: 'Diwali' },

  { calendarKey: 'SG', date: '2026-01-01', name: "New Year's Day" },
  { calendarKey: 'SG', date: '2026-05-01', name: 'Labour Day' },
  { calendarKey: 'SG', date: '2026-08-10', name: 'National Day (observed)' },
  { calendarKey: 'SG', date: '2026-12-25', name: 'Christmas Day' },
];

// ---------------------------------------------------------------------------
// Единицы планирования
// ---------------------------------------------------------------------------

/** ASSUMPTION: смещение за праздник (+3) взято наугад, см. открытый вопрос 4. */
const standardCompDayPolicy = {
  rules: [
    { workedOn: 'SATURDAY', defaultOffsetDays: -2 },
    { workedOn: 'SUNDAY', defaultOffsetDays: 2 },
    { workedOn: 'HOLIDAY', defaultOffsetDays: 3 },
  ],
  expiryWeeks: 12,
} as const;

export const units: readonly PlanningUnit[] = [
  {
    id: 'unit-amer',
    name: 'Americas',
    plannerPersonIds: ['p-amer-planner'],
    compDayPolicy: standardCompDayPolicy,
    coverageCalendarLocationId: 'loc-ny',
  },
  {
    id: 'unit-emea',
    name: 'EMEA',
    plannerPersonIds: ['p-emea-planner'],
    compDayPolicy: standardCompDayPolicy,
    coverageCalendarLocationId: 'loc-lon',
  },
  {
    id: 'unit-apac',
    name: 'APAC',
    plannerPersonIds: ['p-apac-planner'],
    compDayPolicy: standardCompDayPolicy,
    coverageCalendarLocationId: 'loc-sgp',
  },
  {
    id: 'unit-st',
    name: 'Service transition',
    plannerPersonIds: ['p-st-planner'],
    compDayPolicy: standardCompDayPolicy,
    coverageCalendarLocationId: 'loc-lon',
  },
];

// ---------------------------------------------------------------------------
// Роли
// ---------------------------------------------------------------------------

const COLOR = {
  lead: '#3f6fb5',
  leadLate: '#5a5ea8',
  batch: '#2f7d64',
  batchLate: '#4a7d3f',
  cava: '#8a6a2f',
  night: '#5c4a7d',
  transition: '#7a5170',
} as const;

/**
 * ASSUMPTION: все окна и коды — предположения. Открытый вопрос 1.
 * Роли принадлежат единице (ADR-0004): совпадение кодов между единицами
 * ничего не означает.
 */
export const roles: readonly ShiftRole[] = [
  // Americas — окна в нью-йоркском времени
  { id: 'r-amer-sl', unitId: 'unit-amer', code: 'SL', label: 'Shift lead', color: COLOR.lead, hotkey: 'l', timeZone: 'America/New_York', start: '07:00', end: '15:00', crossesMidnight: false, editableTime: false, countsAsCoverage: true },
  { id: 'r-amer-sl-l', unitId: 'unit-amer', code: 'SL_L', label: 'Shift lead late', color: COLOR.leadLate, hotkey: 'k', timeZone: 'America/New_York', start: '13:00', end: '21:00', crossesMidnight: false, editableTime: false, countsAsCoverage: true },
  { id: 'r-amer-batch', unitId: 'unit-amer', code: 'BATCH', label: 'Batch', color: COLOR.batch, hotkey: 'b', timeZone: 'America/New_York', start: '06:00', end: '14:00', crossesMidnight: false, editableTime: true, countsAsCoverage: true },
  { id: 'r-amer-batch-late', unitId: 'unit-amer', code: 'BATCH_L', label: 'Batch late', color: COLOR.batchLate, hotkey: 't', timeZone: 'America/New_York', start: '14:00', end: '22:00', crossesMidnight: false, editableTime: true, countsAsCoverage: true },
  { id: 'r-amer-cava', unitId: 'unit-amer', code: 'CAVA', label: 'Cover & availability', color: COLOR.cava, hotkey: 'c', timeZone: 'America/New_York', start: '09:00', end: '17:00', crossesMidnight: false, editableTime: true, countsAsCoverage: true },

  // EMEA — окна в лондонском времени
  { id: 'r-emea-sl', unitId: 'unit-emea', code: 'SL', label: 'Shift lead', color: COLOR.lead, hotkey: 'l', timeZone: 'Europe/London', start: '07:00', end: '15:00', crossesMidnight: false, editableTime: false, countsAsCoverage: true },
  { id: 'r-emea-batch', unitId: 'unit-emea', code: 'BATCH', label: 'Batch', color: COLOR.batch, hotkey: 'b', timeZone: 'Europe/London', start: '06:00', end: '14:00', crossesMidnight: false, editableTime: true, countsAsCoverage: true },
  { id: 'r-emea-batch-late', unitId: 'unit-emea', code: 'BATCH_L', label: 'Batch late', color: COLOR.batchLate, hotkey: 't', timeZone: 'Europe/London', start: '13:00', end: '21:00', crossesMidnight: false, editableTime: true, countsAsCoverage: true },
  { id: 'r-emea-cava', unitId: 'unit-emea', code: 'CAVA', label: 'Cover & availability', color: COLOR.cava, hotkey: 'c', timeZone: 'Europe/London', start: '09:00', end: '17:00', crossesMidnight: false, editableTime: true, countsAsCoverage: true },

  // APAC — окна в сингапурском времени
  { id: 'r-apac-sl', unitId: 'unit-apac', code: 'SL', label: 'Shift lead', color: COLOR.lead, hotkey: 'l', timeZone: 'Asia/Singapore', start: '08:00', end: '16:00', crossesMidnight: false, editableTime: false, countsAsCoverage: true },
  { id: 'r-apac-batch', unitId: 'unit-apac', code: 'BATCH', label: 'Batch', color: COLOR.batch, hotkey: 'b', timeZone: 'Asia/Singapore', start: '07:00', end: '15:00', crossesMidnight: false, editableTime: true, countsAsCoverage: true },
  { id: 'r-apac-cava', unitId: 'unit-apac', code: 'CAVA', label: 'Cover & availability', color: COLOR.cava, hotkey: 'c', timeZone: 'Asia/Singapore', start: '09:00', end: '17:00', crossesMidnight: false, editableTime: true, countsAsCoverage: true },
  { id: 'r-apac-night', unitId: 'unit-apac', code: 'NIGHT', label: 'Night cover', color: COLOR.night, hotkey: 'n', timeZone: 'Asia/Singapore', start: '22:00', end: '06:00', crossesMidnight: true, editableTime: false, countsAsCoverage: true },

  // Service transition — три роли с разными окнами вместо привязки ко времени человека
  { id: 'r-st-amer', unitId: 'unit-st', code: 'ST_AMER', label: 'ST Americas', color: COLOR.transition, hotkey: 'a', timeZone: 'America/New_York', start: '09:00', end: '17:00', crossesMidnight: false, editableTime: true, countsAsCoverage: true },
  { id: 'r-st-emea', unitId: 'unit-st', code: 'ST_EMEA', label: 'ST EMEA', color: COLOR.transition, hotkey: 'e', timeZone: 'Europe/London', start: '09:00', end: '17:00', crossesMidnight: false, editableTime: true, countsAsCoverage: true },
  { id: 'r-st-apac', unitId: 'unit-st', code: 'ST_APAC', label: 'ST APAC', color: COLOR.transition, hotkey: 'p', timeZone: 'Asia/Singapore', start: '09:00', end: '17:00', crossesMidnight: false, editableTime: true, countsAsCoverage: true },
];

// ---------------------------------------------------------------------------
// Люди
// ---------------------------------------------------------------------------

const NAME_POOLS: Record<string, { first: readonly string[]; last: readonly string[] }> = {
  'loc-ny': {
    first: ['Michael', 'Sarah', 'David', 'Emily', 'James', 'Olivia', 'Robert', 'Laura', 'Kevin', 'Rachel'],
    last: ['Reed', 'Carter', 'Brooks', 'Whitfield', 'Grant', 'Nash', 'Simmons', 'Doyle', 'Pierce', 'Vance'],
  },
  'loc-chi': {
    first: ['Thomas', 'Megan', 'Brian', 'Alison', 'Patrick', 'Nicole', 'Gregory', 'Dana'],
    last: ['Foley', 'Kowalski', 'Ramirez', 'Sullivan', 'Brennan', 'Novak', 'Castillo', 'Hoffman'],
  },
  'loc-pune': {
    first: ['Rohan', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Anjali', 'Karan', 'Divya', 'Suresh', 'Neha', 'Nikhil', 'Pooja'],
    last: ['Deshpande', 'Kulkarni', 'Joshi', 'Iyer', 'Rao', 'Menon', 'Bhatt', 'Nair', 'Pillai', 'Chauhan', 'Gokhale', 'Shetty'],
  },
  'loc-lon': {
    first: ['Daniel', 'Charlotte', 'Oliver', 'Sophie', 'Marcus', 'Hannah', 'Adam', 'Grace', 'Nathan', 'Imogen'],
    last: ['Whitmore', 'Ellis', 'Bennett', 'Harding', 'Cole', 'Reid', 'Fletcher', 'Lowry', 'Ashworth', 'Pemberton'],
  },
  'loc-zrh': {
    first: ['Lukas', 'Anna', 'Stefan', 'Nadine', 'Thomas', 'Elena', 'Matthias', 'Corinne'],
    last: ['Brunner', 'Keller', 'Meier', 'Frei', 'Baumann', 'Ritter', 'Schwarz', 'Zimmermann'],
  },
  'loc-sgp': {
    first: ['Wei Ming', 'Siti', 'Jason', 'Mei Ling', 'Arun', 'Cheryl', 'Daniel', 'Preeti', 'Hui Xin', 'Marcus'],
    last: ['Tan', 'Rahman', 'Lim', 'Ho', 'Kumar', 'Ng', 'Koh', 'Sharma', 'Chua', 'Wong'],
  },
};

interface UnitStaffing {
  readonly unitId: string;
  /** Сколько человек берётся из каждой локации. */
  readonly headcount: ReadonlyArray<readonly [string, number]>;
  readonly plannerId: string;
  readonly plannerLocationId: string;
  readonly plannerName: string;
  /** Роли, по которым раздаются eligibility, и вероятность попадания в пул. */
  readonly rolePool: ReadonlyArray<readonly [string, number]>;
}

const STAFFING: readonly UnitStaffing[] = [
  {
    unitId: 'unit-amer',
    headcount: [['loc-ny', 8], ['loc-chi', 6], ['loc-pune', 12]],
    plannerId: 'p-amer-planner',
    plannerLocationId: 'loc-ny',
    plannerName: 'Diane Halloran',
    rolePool: [['r-amer-sl', 0.35], ['r-amer-sl-l', 0.25], ['r-amer-batch', 0.55], ['r-amer-batch-late', 0.45], ['r-amer-cava', 0.85]],
  },
  {
    unitId: 'unit-emea',
    headcount: [['loc-lon', 10], ['loc-zrh', 8]],
    plannerId: 'p-emea-planner',
    plannerLocationId: 'loc-lon',
    plannerName: 'Marta Nowak',
    rolePool: [['r-emea-sl', 0.35], ['r-emea-batch', 0.55], ['r-emea-batch-late', 0.45], ['r-emea-cava', 0.85]],
  },
  {
    unitId: 'unit-apac',
    headcount: [['loc-sgp', 11], ['loc-pune', 8]],
    plannerId: 'p-apac-planner',
    plannerLocationId: 'loc-sgp',
    plannerName: 'Kenneth Yeo',
    rolePool: [['r-apac-sl', 0.35], ['r-apac-batch', 0.6], ['r-apac-cava', 0.85], ['r-apac-night', 0.4]],
  },
  {
    unitId: 'unit-st',
    headcount: [['loc-ny', 3], ['loc-lon', 3], ['loc-sgp', 3], ['loc-pune', 3]],
    plannerId: 'p-st-planner',
    plannerLocationId: 'loc-lon',
    plannerName: 'Ruth Kavanagh',
    rolePool: [],
  },
];

/** У инженера service transition ровно одна роль — по географии его локации. */
const ST_ROLE_BY_LOCATION: Record<string, string> = {
  'loc-ny': 'r-st-amer',
  'loc-chi': 'r-st-amer',
  'loc-lon': 'r-st-emea',
  'loc-zrh': 'r-st-emea',
  'loc-sgp': 'r-st-apac',
  'loc-pune': 'r-st-apac',
};

const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5];
const ALL_DAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

function normalizeShares(entries: readonly (readonly [string, number])[]): RoleEligibility[] {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total === 0) return [];
  return entries.map(([roleId, weight]) => ({
    roleId,
    targetShare: Math.round((weight / total) * 100) / 100,
  }));
}

function buildPeople(): Person[] {
  const rnd = mulberry32(20260801);
  const people: Person[] = [];
  const usedNames = new Set<string>();
  const counters = new Map<string, number>();

  const nextName = (locationId: string): string => {
    const pool = NAME_POOLS[locationId];
    if (!pool) throw new Error(`Нет пула имён для локации ${locationId}`);
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const index = (counters.get(locationId) ?? 0) + attempt;
      const first = pool.first[index % pool.first.length];
      const last = pool.last[(index * 3 + attempt) % pool.last.length];
      const name = `${first} ${last}`;
      if (!usedNames.has(name)) {
        usedNames.add(name);
        counters.set(locationId, index + 1);
        return name;
      }
    }
    throw new Error(`Не удалось подобрать уникальное имя для ${locationId}`);
  };

  let employeeSeq = 41000;

  for (const unit of STAFFING) {
    people.push({
      id: unit.plannerId,
      displayName: unit.plannerName,
      employeeId: String((employeeSeq += 1)),
      unitId: unit.unitId,
      locationId: unit.plannerLocationId,
      isPlannerOnly: true,
      eligibility: [],
      availableWeekdays: WEEKDAYS,
      constraints: { minRestHours: 11, maxConsecutiveDays: 5 },
      calendarToken: `tok-${unit.plannerId}`,
    });

    for (const [locationId, headcount] of unit.headcount) {
      for (let i = 0; i < headcount; i += 1) {
        const displayName = nextName(locationId);
        const id = `p-${displayName.toLowerCase().replace(/[^a-z]+/g, '-')}`;

        let eligibility: RoleEligibility[];
        let availableWeekdays: readonly Weekday[];

        if (unit.unitId === 'unit-st') {
          const roleId = ST_ROLE_BY_LOCATION[locationId];
          if (!roleId) throw new Error(`Нет ST-роли для локации ${locationId}`);
          eligibility = [{ roleId, targetShare: 1 }];
          availableWeekdays = WEEKDAYS;
        } else {
          const chosen = unit.rolePool.filter(([, probability]) => rnd() < probability);
          const pool = chosen.length > 0 ? chosen : [pick(unit.rolePool, rnd)];
          eligibility = normalizeShares(pool);
          availableWeekdays = ALL_DAYS;
        }

        people.push({
          id,
          displayName,
          employeeId: String((employeeSeq += 1)),
          unitId: unit.unitId,
          locationId,
          isPlannerOnly: false,
          eligibility,
          availableWeekdays,
          constraints: {
            minRestHours: 11,
            maxConsecutiveDays: rnd() < 0.2 ? 4 : 6,
            maxWeekendDaysPer4Weeks: 2,
          },
          calendarToken: `tok-${id}`,
        });
      }
    }
  }

  return people;
}

export const people: readonly Person[] = buildPeople();

// ---------------------------------------------------------------------------
// Правила покрытия
// ---------------------------------------------------------------------------

interface CoverageSpec {
  readonly roleId: string;
  readonly weekday?: { min: number; target?: number; max?: number };
  readonly weekend?: { min: number; target?: number; max?: number };
  readonly holiday?: { min: number; target?: number; max?: number };
}

/** ASSUMPTION: минимумы взяты по описанию текущей практики. Открытый вопрос 3. */
const COVERAGE_SPECS: ReadonlyArray<readonly [string, readonly CoverageSpec[]]> = [
  [
    'unit-amer',
    [
      { roleId: 'r-amer-sl', weekday: { min: 1, target: 1, max: 1 }, weekend: { min: 1, target: 1, max: 1 }, holiday: { min: 1, target: 1, max: 1 } },
      { roleId: 'r-amer-sl-l', weekday: { min: 1, target: 1, max: 1 } },
      { roleId: 'r-amer-batch', weekday: { min: 1, target: 2 }, weekend: { min: 1, target: 1 }, holiday: { min: 1, target: 1 } },
      { roleId: 'r-amer-batch-late', weekday: { min: 1, target: 1 } },
      { roleId: 'r-amer-cava', weekday: { min: 2, target: 3 }, weekend: { min: 1, target: 2 }, holiday: { min: 1, target: 1 } },
    ],
  ],
  [
    'unit-emea',
    [
      { roleId: 'r-emea-sl', weekday: { min: 1, target: 1, max: 1 }, weekend: { min: 1, target: 1, max: 1 }, holiday: { min: 1, target: 1, max: 1 } },
      { roleId: 'r-emea-batch', weekday: { min: 1, target: 2 }, weekend: { min: 1, target: 1 }, holiday: { min: 1, target: 1 } },
      { roleId: 'r-emea-batch-late', weekday: { min: 1, target: 1 } },
      { roleId: 'r-emea-cava', weekday: { min: 2, target: 3 }, weekend: { min: 1, target: 2 }, holiday: { min: 1, target: 1 } },
    ],
  ],
  [
    'unit-apac',
    [
      { roleId: 'r-apac-sl', weekday: { min: 1, target: 1, max: 1 }, weekend: { min: 1, target: 1, max: 1 }, holiday: { min: 1, target: 1, max: 1 } },
      { roleId: 'r-apac-batch', weekday: { min: 1, target: 2 }, weekend: { min: 1, target: 1 }, holiday: { min: 1, target: 1 } },
      { roleId: 'r-apac-cava', weekday: { min: 2, target: 2 }, weekend: { min: 1, target: 1 }, holiday: { min: 1, target: 1 } },
      { roleId: 'r-apac-night', weekday: { min: 1, target: 1 }, weekend: { min: 1, target: 1 }, holiday: { min: 1, target: 1 } },
    ],
  ],
  [
    'unit-st',
    [
      { roleId: 'r-st-amer', weekday: { min: 1, target: 1 } },
      { roleId: 'r-st-emea', weekday: { min: 1, target: 1 } },
      { roleId: 'r-st-apac', weekday: { min: 1, target: 1 } },
    ],
  ],
];

function buildCoverageRules(): CoverageRule[] {
  const rules: CoverageRule[] = [];
  for (const [unitId, specs] of COVERAGE_SPECS) {
    for (const spec of specs) {
      const scopes = [
        ['WEEKDAY', spec.weekday],
        ['WEEKEND', spec.weekend],
        ['HOLIDAY', spec.holiday],
      ] as const;
      for (const [appliesTo, requirement] of scopes) {
        if (!requirement) continue;
        rules.push({
          id: `cr-${spec.roleId}-${appliesTo.toLowerCase()}`,
          unitId,
          roleId: spec.roleId,
          appliesTo,
          min: requirement.min,
          ...(requirement.target !== undefined ? { target: requirement.target } : {}),
          ...(requirement.max !== undefined ? { max: requirement.max } : {}),
        });
      }
    }
  }

  // ASSUMPTION: пример события как правила с датой — см. ADR-0008, открытый вопрос 7.
  rules.push({
    id: 'cr-amer-cava-dr-test',
    unitId: 'unit-amer',
    roleId: 'r-amer-cava',
    appliesTo: 'DATE',
    date: '2026-08-22',
    label: 'DR test',
    min: 3,
    target: 4,
  });
  rules.push({
    id: 'cr-emea-cava-month-end',
    unitId: 'unit-emea',
    roleId: 'r-emea-cava',
    appliesTo: 'DATE',
    date: '2026-08-31',
    label: 'Month end',
    min: 3,
    target: 3,
  });

  return rules;
}

export const coverageRules: readonly CoverageRule[] = buildCoverageRules();

// ---------------------------------------------------------------------------
// Лимиты одновременных отсутствий
// ---------------------------------------------------------------------------

/** ASSUMPTION: текущие правила команды — не более 3 длинных и 4 коротких. */
function buildAbsenceCapacityRules(): AbsenceCapacityRule[] {
  const rules: AbsenceCapacityRule[] = [];
  const counted = ['VACATION', 'COMP_DAY', 'TRAINING'] as const;

  for (const unit of units) {
    rules.push({
      id: `acr-${unit.id}-unit-long`,
      unitId: unit.id,
      scope: { kind: 'UNIT' },
      durationBucket: 'LONG',
      longThresholdWorkdays: 5,
      maxConcurrent: 3,
      countsTypes: counted,
    });
    rules.push({
      id: `acr-${unit.id}-unit-short`,
      unitId: unit.id,
      scope: { kind: 'UNIT' },
      durationBucket: 'SHORT',
      longThresholdWorkdays: 5,
      maxConcurrent: 4,
      countsTypes: counted,
    });
  }

  // Ограничение по пулу shift lead — то, чего не видит счётчик по единице (ADR-0010).
  for (const roleId of ['r-amer-sl', 'r-emea-sl', 'r-apac-sl']) {
    const role = roles.find((r) => r.id === roleId);
    if (!role) continue;
    rules.push({
      id: `acr-${roleId}-pool-long`,
      unitId: role.unitId,
      scope: { kind: 'ROLE_POOL', roleId },
      durationBucket: 'LONG',
      longThresholdWorkdays: 5,
      maxConcurrent: 1,
      countsTypes: counted,
    });
  }

  return rules;
}

export const absenceCapacityRules: readonly AbsenceCapacityRule[] = buildAbsenceCapacityRules();

// ---------------------------------------------------------------------------
// Отсутствия
// ---------------------------------------------------------------------------

function buildAbsences(): Absence[] {
  const rnd = mulberry32(77102);
  const result: Absence[] = [];
  let seq = 0;

  const planningPeople = people.filter((p) => !p.isPlannerOnly);

  for (const person of planningPeople) {
    // Примерно каждый третий человек отдыхает в августе — летний сценарий.
    if (rnd() > 0.34) continue;
    const startDay = 1 + Math.floor(rnd() * 24);
    const length = rnd() < 0.55 ? 2 + Math.floor(rnd() * 3) : 6 + Math.floor(rnd() * 8);
    const from = DateTime.fromISO('2026-08-01').plus({ days: startDay - 1 });
    const to = from.plus({ days: length - 1 });
    seq += 1;
    result.push({
      id: `abs-${seq}`,
      personId: person.id,
      type: rnd() < 0.85 ? 'VACATION' : 'TRAINING',
      from: from.toFormat('yyyy-MM-dd'),
      to: to.toFormat('yyyy-MM-dd'),
      source: 'IMPORT',
      importBatchId: 'batch-2026-08-12',
      lastSeenInImportAt: '2026-08-12T06:30:00Z',
    });
  }

  return result;
}

export const absences: readonly Absence[] = buildAbsences();

// ---------------------------------------------------------------------------
// Назначения
// ---------------------------------------------------------------------------

const holidayDatesByCalendar = new Map<string, Set<IsoDate>>();
for (const holiday of holidays) {
  let set = holidayDatesByCalendar.get(holiday.calendarKey);
  if (!set) {
    set = new Set<IsoDate>();
    holidayDatesByCalendar.set(holiday.calendarKey, set);
  }
  set.add(holiday.date);
}

/**
 * Частично заполненный август: примерно 80% требуемого минимума. Дыры оставлены
 * намеренно, чтобы полоса покрытия при первом открытии показывала все три уровня.
 */
function buildAssignments(): Assignment[] {
  const rnd = mulberry32(31337);
  const result: Assignment[] = [];
  let seq = 0;

  const absenceByPerson = new Map<string, Absence[]>();
  for (const absence of absences) {
    const bucket = absenceByPerson.get(absence.personId);
    if (bucket) bucket.push(absence);
    else absenceByPerson.set(absence.personId, [absence]);
  }

  const isAbsent = (personId: string, date: IsoDate): boolean =>
    (absenceByPerson.get(personId) ?? []).some((a) => date >= a.from && date <= a.to);

  const dates: IsoDate[] = [];
  for (let cursor = DateTime.fromISO(DEFAULT_PERIOD.from); cursor <= DateTime.fromISO(DEFAULT_PERIOD.to); cursor = cursor.plus({ days: 1 })) {
    dates.push(cursor.toFormat('yyyy-MM-dd'));
  }

  for (const unit of units) {
    const unitRoles = roles.filter((r) => r.unitId === unit.id);
    const unitPeople = people.filter((p) => p.unitId === unit.id && !p.isPlannerOnly);
    const coverageLocation = locations.find((l) => l.id === unit.coverageCalendarLocationId);
    if (!coverageLocation) continue;
    const unitHolidays = holidayDatesByCalendar.get(coverageLocation.holidayCalendarKey) ?? new Set<IsoDate>();

    // Курсор round-robin на роль — распределяет нагрузку ровнее случайного выбора.
    const cursorByRole = new Map<string, number>();

    for (const date of dates) {
      const weekday = DateTime.fromISO(date).weekday;
      const isWeekend = weekday === 6 || weekday === 7;
      const isHoliday = unitHolidays.has(date);
      const takenToday = new Set<string>();

      for (const role of unitRoles) {
        const rule = coverageRules.find(
          (r) =>
            r.roleId === role.id &&
            ((r.appliesTo === 'DATE' && r.date === date) ||
              (r.appliesTo === 'HOLIDAY' && isHoliday) ||
              (r.appliesTo === 'WEEKEND' && isWeekend && !isHoliday) ||
              (r.appliesTo === 'WEEKDAY' && !isWeekend && !isHoliday)),
        );
        if (!rule) continue;

        const wanted = rule.target ?? rule.min;
        // Иногда недобираем — так в полосе покрытия появляются жёлтые и красные клетки.
        const roll = rnd();
        const toPlace = roll < 0.12 ? Math.max(0, rule.min - 1) : roll < 0.4 ? rule.min : wanted;

        const candidates = unitPeople.filter(
          (p) =>
            p.eligibility.some((e) => e.roleId === role.id) &&
            p.availableWeekdays.includes(weekday as Weekday) &&
            !takenToday.has(p.id) &&
            !isAbsent(p.id, date),
        );
        if (candidates.length === 0) continue;

        const cursor = cursorByRole.get(role.id) ?? 0;
        for (let placed = 0; placed < toPlace && placed < candidates.length; placed += 1) {
          const person = candidates[(cursor + placed) % candidates.length];
          if (!person || takenToday.has(person.id)) continue;
          takenToday.add(person.id);
          seq += 1;
          result.push({
            id: `as-${seq}`,
            personId: person.id,
            roleId: role.id,
            date,
            source: 'GENERATED',
            createdBy: SYSTEM,
            createdAt: CREATED_AT,
          });
        }
        cursorByRole.set(role.id, cursor + toPlace);
      }
    }
  }

  return result;
}

export const assignments: readonly Assignment[] = buildAssignments();

// ---------------------------------------------------------------------------
// Датасет
// ---------------------------------------------------------------------------

export function createFixtureDataset(): ScheduleDataset {
  return {
    locations,
    holidays,
    units,
    roles,
    people,
    coverageRules,
    absenceCapacityRules,
    assignments,
    absences,
    compDays: [],
    acknowledgements: [],
  };
}
