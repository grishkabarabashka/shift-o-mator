/**
 * Тестовые данные.
 *
 * Коды ролей, окна и минимумы покрытия — реальная операционная практика, а не
 * выдумка (см. Docs/01-domain-model.md). Всё, что помечено `ASSUMPTION`,
 * реальными данными не подтверждено; список — в Docs/14-open-questions.md.
 *
 * Люди синтетические: последовательные имена из пулов, без исходного ростера.
 *
 * Данные детерминированы: один и тот же вызов даёт один и тот же датасет,
 * иначе тесты и скриншоты поплывут.
 */

import { DateTime } from 'luxon';
import type {
  Absence,
  AbsenceCapacityRule,
  Assignment,
  CompDayEntry,
  CompOffPolicy,
  DayConfiguration,
  Holiday,
  IsoDate,
  Location,
  Person,
  PlanningUnit,
  Region,
  RoleEligibility,
  RoleRequirement,
  ScheduleDataset,
  ShiftDefinition,
  ShiftRole,
  Weekday,
} from './types.ts';

const SYSTEM = 'system';
const CREATED_AT = '2026-08-01T00:00:00Z';
const EPOCH: IsoDate = '2020-01-01';

/** Период, который открывается по умолчанию. */
export const DEFAULT_PERIOD = { from: '2026-08-01', to: '2026-08-31' } as const;
export const DEFAULT_UNIT = 'unit-amer';

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

// ---------------------------------------------------------------------------
// Локации
// ---------------------------------------------------------------------------

const WEEKEND: readonly Weekday[] = [6, 7];

export const locations: readonly Location[] = [
  { id: 'loc-sgp', name: 'Singapore', timeZone: 'Asia/Singapore', holidayCalendarKey: 'SG', weekendDays: WEEKEND },
  { id: 'loc-pune', name: 'Pune', timeZone: 'Asia/Kolkata', holidayCalendarKey: 'IN', weekendDays: WEEKEND },
  { id: 'loc-lon', name: 'London', timeZone: 'Europe/London', holidayCalendarKey: 'GB', weekendDays: WEEKEND },
  { id: 'loc-ste', name: 'Stevenage', timeZone: 'Europe/London', holidayCalendarKey: 'GB', weekendDays: WEEKEND },
  { id: 'loc-zrh', name: 'Zurich', timeZone: 'Europe/Zurich', holidayCalendarKey: 'CH', weekendDays: WEEKEND },
  { id: 'loc-chi', name: 'Chicago', timeZone: 'America/Chicago', holidayCalendarKey: 'US', weekendDays: WEEKEND },
  { id: 'loc-nyc', name: 'New York', timeZone: 'America/New_York', holidayCalendarKey: 'US', weekendDays: WEEKEND },
  { id: 'loc-hfd', name: 'Hartford', timeZone: 'America/New_York', holidayCalendarKey: 'US', weekendDays: WEEKEND },
];

const US_LOCATIONS = ['loc-chi', 'loc-nyc', 'loc-hfd'];
const GB_LOCATIONS = ['loc-lon', 'loc-ste'];

/** ASSUMPTION: сокращённые календари на 2026 год, только заметные даты. */
export const holidays: readonly Holiday[] = [
  { id: 'hol-2026-01-01', date: '2026-01-01', name: "New Year's Day", locationIds: [...US_LOCATIONS, ...GB_LOCATIONS, 'loc-zrh', 'loc-sgp'], isFullDay: true },
  { id: 'hol-2026-05-25', date: '2026-05-25', name: 'Memorial Day', locationIds: US_LOCATIONS, isFullDay: true },
  { id: 'hol-2026-07-03', date: '2026-07-03', name: 'Independence Day (observed)', locationIds: US_LOCATIONS, isFullDay: true },
  { id: 'hol-2026-09-07', date: '2026-09-07', name: 'Labor Day', locationIds: US_LOCATIONS, isFullDay: true },
  { id: 'hol-2026-11-26', date: '2026-11-26', name: 'Thanksgiving', locationIds: US_LOCATIONS, isFullDay: true },
  { id: 'hol-2026-12-25', date: '2026-12-25', name: 'Christmas Day', locationIds: [...US_LOCATIONS, ...GB_LOCATIONS, 'loc-zrh', 'loc-sgp'], isFullDay: true },

  { id: 'hol-2026-04-03', date: '2026-04-03', name: 'Good Friday', locationIds: [...GB_LOCATIONS, 'loc-zrh'], isFullDay: true },
  { id: 'hol-2026-05-04', date: '2026-05-04', name: 'Early May Bank Holiday', locationIds: GB_LOCATIONS, isFullDay: true },
  { id: 'hol-2026-08-31', date: '2026-08-31', name: 'Summer Bank Holiday', locationIds: GB_LOCATIONS, isFullDay: true },
  { id: 'hol-2026-12-28', date: '2026-12-28', name: 'Boxing Day (observed)', locationIds: GB_LOCATIONS, isFullDay: true },

  { id: 'hol-2026-08-01', date: '2026-08-01', name: 'Bundesfeier', locationIds: ['loc-zrh'], isFullDay: true },

  { id: 'hol-2026-01-26', date: '2026-01-26', name: 'Republic Day', locationIds: ['loc-pune'], isFullDay: true },
  { id: 'hol-2026-08-15', date: '2026-08-15', name: 'Independence Day', locationIds: ['loc-pune'], isFullDay: true },
  { id: 'hol-2026-10-02', date: '2026-10-02', name: 'Gandhi Jayanti', locationIds: ['loc-pune'], isFullDay: true },
  { id: 'hol-2026-11-08', date: '2026-11-08', name: 'Diwali', locationIds: ['loc-pune'], isFullDay: true },

  { id: 'hol-2026-05-01', date: '2026-05-01', name: 'Labour Day', locationIds: ['loc-sgp'], isFullDay: true },
  { id: 'hol-2026-08-10', date: '2026-08-10', name: 'National Day (observed)', locationIds: ['loc-sgp'], isFullDay: true },
];

// ---------------------------------------------------------------------------
// Регионы
// ---------------------------------------------------------------------------

/**
 * ASSUMPTION: окно поиска и порог «висит слишком долго» не подтверждены.
 * Исключённые дни — Пн и Пт — операционное правило (Docs/05-comp-days.md).
 */
const standardCompOffPolicy: CompOffPolicy = {
  windowBeforeDays: 14,
  windowAfterDays: 14,
  excludedWeekdays: [1, 5],
  agingThresholdDays: 14,
  requiresApprovalWhenNoSlot: true,
};

export const regions: readonly Region[] = [
  {
    id: 'AMER',
    name: 'Americas',
    primaryTimeZone: 'America/New_York',
    primaryLocationId: 'loc-nyc',
    locationIds: ['loc-nyc', 'loc-chi', 'loc-hfd', 'loc-pune'],
    compOffPolicy: standardCompOffPolicy,
  },
  {
    id: 'EMEA',
    name: 'EMEA',
    primaryTimeZone: 'Europe/London',
    primaryLocationId: 'loc-lon',
    locationIds: ['loc-lon', 'loc-ste', 'loc-zrh', 'loc-pune'],
    compOffPolicy: standardCompOffPolicy,
  },
  {
    id: 'APAC',
    name: 'APAC',
    primaryTimeZone: 'Asia/Singapore',
    primaryLocationId: 'loc-sgp',
    locationIds: ['loc-sgp', 'loc-pune'],
    compOffPolicy: standardCompOffPolicy,
  },
];

// ---------------------------------------------------------------------------
// Единицы планирования — ортогональны регионам (ADR-0020)
// ---------------------------------------------------------------------------

export const units: readonly PlanningUnit[] = [
  { id: 'unit-amer', name: 'Americas', kind: 'REGION', regionId: 'AMER', groupBy: 'LOCATION' },
  { id: 'unit-emea', name: 'EMEA', kind: 'REGION', regionId: 'EMEA', groupBy: 'LOCATION' },
  { id: 'unit-apac', name: 'APAC', kind: 'REGION', regionId: 'APAC', groupBy: 'LOCATION' },
  { id: 'unit-st', name: 'Service Transition', kind: 'CROSS_REGION', groupBy: 'REGION' },
];

// ---------------------------------------------------------------------------
// Смены — контрактные окна людей (ADR-0018)
// ---------------------------------------------------------------------------

export const shifts: readonly ShiftDefinition[] = [
  { id: 'sh-apac-sgp', regionId: 'APAC', code: 'APAC-SG', name: 'Singapore', timeZone: 'Asia/Singapore', start: '07:00', end: '15:30', crossesMidnight: false, breakMinutes: 30 },
  { id: 'sh-apac-pune', regionId: 'APAC', code: 'APAC-IN', name: 'Pune APAC', timeZone: 'Asia/Kolkata', start: '06:30', end: '15:00', crossesMidnight: false, breakMinutes: 30 },
  { id: 'sh-apac-mid', regionId: 'APAC', code: 'APAC-MID', name: 'APAC mid', timeZone: 'Asia/Singapore', start: '09:00', end: '18:00', crossesMidnight: false, breakMinutes: 60 },

  { id: 'sh-emea-lon', regionId: 'EMEA', code: 'EMEA-UK', name: 'London', timeZone: 'Europe/London', start: '08:30', end: '16:30', crossesMidnight: false, breakMinutes: 30 },
  { id: 'sh-emea-zrh', regionId: 'EMEA', code: 'EMEA-CH', name: 'Zurich', timeZone: 'Europe/Zurich', start: '08:00', end: '18:00', crossesMidnight: false, breakMinutes: 60 },
  { id: 'sh-emea-pune', regionId: 'EMEA', code: 'EMEA-IN', name: 'Pune EMEA', timeZone: 'Asia/Kolkata', start: '13:00', end: '21:30', crossesMidnight: false, breakMinutes: 30 },

  { id: 'sh-amer-chi', regionId: 'AMER', code: 'AMER-CHI', name: 'Chicago', timeZone: 'America/Chicago', start: '09:00', end: '17:30', crossesMidnight: false, breakMinutes: 60 },
  { id: 'sh-amer-nyc', regionId: 'AMER', code: 'AMER-NY', name: 'New York', timeZone: 'America/New_York', start: '11:00', end: '19:30', crossesMidnight: false, breakMinutes: 60 },
  { id: 'sh-amer-hfd', regionId: 'AMER', code: 'AMER-ST', name: 'Hartford ST early', timeZone: 'America/New_York', start: '08:00', end: '16:30', crossesMidnight: false, breakMinutes: 30 },
  { id: 'sh-amer-pune', regionId: 'AMER', code: 'AMER-IN', name: 'Pune AMER batch-late', timeZone: 'Asia/Kolkata', start: '18:00', end: '02:30', crossesMidnight: true, breakMinutes: 30 },
];

// ---------------------------------------------------------------------------
// Роли — реальные коды и окна (Docs/01-domain-model.md)
// ---------------------------------------------------------------------------

const COLOR = {
  lead: '#3f6fb5',
  leadLate: '#5a5ea8',
  crew: '#2f7d64',
  crewLate: '#3f8f6a',
  batch: '#8a6a2f',
  batchLate: '#a07a30',
  cover: '#4a7d3f',
  transition: '#7a5170',
  weekend: '#a05a4a',
  onCall: '#5c4a7d',
  ch: '#5b7fa6',
} as const;

interface RoleSpec {
  readonly code: string;
  readonly label: string;
  readonly description: string;
  readonly color: string;
  readonly hotkey?: string;
  readonly timeZone: string;
  readonly start: string;
  readonly end: string;
  readonly crossesMidnight?: boolean;
  readonly breakMinutes?: number;
  readonly countsAsCoverage?: boolean;
}

const CT = 'America/Chicago';
const ET = 'America/New_York';
const UK = 'Europe/London';
const CH = 'Europe/Zurich';
const SG = 'Asia/Singapore';

const AMER_ROLES: readonly RoleSpec[] = [
  { code: 'Lead', label: 'Shift lead', description: 'Oversee shift, escalations, communications, EMEA and Singapore handovers. Source duty ≈09:45–18:45 CT.', color: COLOR.lead, hotkey: 'l', timeZone: CT, start: '09:00', end: '18:00', breakMinutes: 60 },
  { code: 'Crew', label: 'Incident crew', description: 'Monitor the incident queue, resolve and escalate requests, run incident channels.', color: COLOR.crew, hotkey: 'c', timeZone: CT, start: '09:00', end: '18:00', breakMinutes: 60 },
  { code: 'Crew-BC', label: 'Crew business close', description: 'Late coverage for end-of-day processing; monitor incidents and alerts.', color: COLOR.crewLate, hotkey: 'v', timeZone: CT, start: '08:00', end: '17:00', breakMinutes: 60 },
  { code: 'Batch-E', label: 'Batch early', description: 'Early batch monitoring and alert handling.', color: COLOR.batch, hotkey: 'b', timeZone: CT, start: '09:00', end: '18:00', breakMinutes: 60 },
  { code: 'Batch-L', label: 'Batch late', description: 'Late batch monitoring, end-of-day and APAC-start batch, secondary incident support.', color: COLOR.batchLate, hotkey: 't', timeZone: CT, start: '09:00', end: '18:00', breakMinutes: 60 },
  { code: 'Batch-U', label: 'Batch understudy', description: 'Batch understudy, associated with the New York team.', color: COLOR.batch, hotkey: 'u', timeZone: CT, start: '08:00', end: '17:00', breakMinutes: 60 },
  { code: 'Cover', label: 'Cover / engineering', description: 'Flexible incident and alert coverage, SRE, automation, improvement work and in-hours training.', color: COLOR.cover, hotkey: 'o', timeZone: CT, start: '09:00', end: '18:00', breakMinutes: 60 },
  { code: 'ST Amer', label: 'Service transition AMER', description: 'Service transition duty on the AMER early pattern.', color: COLOR.transition, hotkey: 'a', timeZone: ET, start: '08:00', end: '16:30', breakMinutes: 30 },

  { code: 'Lead-E', label: 'Lead early (Friday)', description: 'Friday morning lead; receives the EMEA handover and hands over to the late crew.', color: COLOR.lead, hotkey: 'e', timeZone: CT, start: '09:00', end: '18:00', breakMinutes: 60 },
  { code: 'Crew-E', label: 'Crew early (Friday)', description: 'Friday early incident crew.', color: COLOR.crew, hotkey: 'r', timeZone: CT, start: '09:00', end: '18:00', breakMinutes: 60 },
  { code: 'Crew-L', label: 'Crew late (Friday)', description: 'Friday late incident crew and late lead; takes over lead duties and prepares the Pune handover.', color: COLOR.crewLate, hotkey: 'w', timeZone: CT, start: '10:00', end: '18:45', breakMinutes: 60 },

  { code: 'Primary', label: 'Weekend primary', description: 'Primary weekend cover.', color: COLOR.weekend, hotkey: 'p', timeZone: CT, start: '10:30', end: '18:45', breakMinutes: 30 },
  { code: 'Secondary', label: 'Weekend secondary', description: 'Secondary weekend cover.', color: COLOR.weekend, hotkey: 's', timeZone: CT, start: '10:30', end: '18:45', breakMinutes: 30 },
  { code: 'ST', label: 'Weekend service transition', description: 'Weekend service transition cover.', color: COLOR.transition, hotkey: 'd', timeZone: CT, start: '10:30', end: '18:45', breakMinutes: 30 },
  { code: 'Shadow', label: 'Weekend shadow', description: 'Shadow or trainee accompanying weekend cover.', color: COLOR.weekend, hotkey: 'h', timeZone: CT, start: '10:30', end: '18:45', breakMinutes: 30, countsAsCoverage: false },
  { code: 'OnCall S3', label: 'On-call severity 3', description: 'Severity-tier on-call duty. Occupies the day like any other role.', color: COLOR.onCall, hotkey: 'n', timeZone: ET, start: '17:00', end: '09:00', crossesMidnight: true, breakMinutes: 0 },
];

const EMEA_ROLES: readonly RoleSpec[] = [
  { code: 'E', label: 'Global queue', description: 'EMEA standard shift on the global queue.', color: COLOR.crew, hotkey: 'e', timeZone: UK, start: '08:30', end: '16:30', breakMinutes: 30 },
  { code: 'BM', label: 'Batch monitoring', description: 'Batch monitoring.', color: COLOR.batch, hotkey: 'b', timeZone: UK, start: '08:00', end: '16:00', breakMinutes: 30 },
  { code: 'BM-Lead', label: 'Batch monitoring lead', description: 'Batch monitoring lead.', color: COLOR.batchLate, hotkey: 'm', timeZone: UK, start: '08:00', end: '16:00', breakMinutes: 30 },
  { code: 'Shift-Lead', label: 'Shift lead', description: 'EMEA shift lead; APAC handover in, AMER handover out.', color: COLOR.lead, hotkey: 'l', timeZone: UK, start: '08:30', end: '16:30', breakMinutes: 30 },
  { code: 'MOD', label: 'Manager on duty', description: 'Manager on duty.', color: COLOR.leadLate, hotkey: 'o', timeZone: UK, start: '09:00', end: '17:00', breakMinutes: 60 },
  { code: 'CH-Early', label: 'Zurich early', description: 'Swiss-region morning checks.', color: COLOR.ch, hotkey: 'y', timeZone: CH, start: '08:00', end: '17:00', breakMinutes: 60 },
  { code: 'CH-SL', label: 'Zurich shift lead', description: 'Swiss queue and monitoring lead.', color: COLOR.ch, hotkey: 'k', timeZone: CH, start: '09:00', end: '18:00', breakMinutes: 60 },
  { code: 'CH-Late', label: 'Zurich late', description: 'Status reporting and late duties.', color: COLOR.ch, hotkey: 'j', timeZone: CH, start: '09:00', end: '18:00', breakMinutes: 60 },
  { code: 'CH-OC', label: 'Zurich on-call', description: 'Night, weekend and bank-holiday on-call.', color: COLOR.onCall, hotkey: 'n', timeZone: CH, start: '18:00', end: '08:00', crossesMidnight: true, breakMinutes: 0 },
  { code: 'ST EMEA', label: 'Service transition EMEA', description: 'Service transition duty on the EMEA pattern. ASSUMPTION: not in the source role list.', color: COLOR.transition, hotkey: 'a', timeZone: UK, start: '09:00', end: '17:00', breakMinutes: 60 },
];

const APAC_ROLES: readonly RoleSpec[] = [
  { code: 'M', label: 'Morning standard', description: 'APAC morning standard shift.', color: COLOR.crew, hotkey: 'm', timeZone: SG, start: '07:00', end: '15:30', breakMinutes: 30 },
  { code: 'G', label: 'General / mid', description: 'General-India and APAC mid shift.', color: COLOR.cover, hotkey: 'g', timeZone: SG, start: '09:00', end: '18:00', breakMinutes: 60 },
  { code: 'MC', label: 'Morning check', description: 'Sunday morning check duty, one person per Sunday by rotation.', color: COLOR.lead, hotkey: 'k', timeZone: SG, start: '08:00', end: '12:00', breakMinutes: 0 },
  { code: 'ST APAC', label: 'Service transition APAC', description: 'Service transition duty on the APAC pattern. ASSUMPTION: not in the source role list.', color: COLOR.transition, hotkey: 'a', timeZone: SG, start: '09:00', end: '17:00', breakMinutes: 60 },
];

function buildRoles(): ShiftRole[] {
  const result: ShiftRole[] = [];
  const groups: ReadonlyArray<readonly [string, readonly RoleSpec[]]> = [
    ['AMER', AMER_ROLES],
    ['EMEA', EMEA_ROLES],
    ['APAC', APAC_ROLES],
  ];
  for (const [regionId, specs] of groups) {
    for (const spec of specs) {
      result.push({
        id: roleId(regionId, spec.code),
        regionId,
        code: spec.code,
        label: spec.label,
        description: spec.description,
        color: spec.color,
        ...(spec.hotkey !== undefined ? { hotkey: spec.hotkey } : {}),
        timeZone: spec.timeZone,
        start: spec.start,
        end: spec.end,
        crossesMidnight: spec.crossesMidnight ?? false,
        breakMinutes: spec.breakMinutes ?? 0,
        countsAsCoverage: spec.countsAsCoverage ?? true,
        editableTime: false,
      });
    }
  }
  return result;
}

/** Стабильный идентификатор роли: регион плюс код. */
export function roleId(regionId: string, code: string): string {
  return `${regionId}:${code}`;
}

export const roles: readonly ShiftRole[] = buildRoles();

// ---------------------------------------------------------------------------
// Конфигурации дней — реальные минимумы (Docs/01-domain-model.md)
// ---------------------------------------------------------------------------

type ReqSpec = readonly [
  code: string,
  min: number,
  max?: number | undefined,
  isDefault?: boolean | undefined,
];

function requirements(regionId: string, specs: readonly ReqSpec[]): RoleRequirement[] {
  return specs.map(([code, min, max, isDefault]) => ({
    roleId: roleId(regionId, code),
    min,
    ...(max !== undefined ? { max } : {}),
    isDefault: isDefault ?? false,
  }));
}

export const dayConfigurations: readonly DayConfiguration[] = [
  {
    id: 'dc-amer-weekday',
    regionId: 'AMER',
    key: 'weekday',
    weekdays: [1, 2, 3, 4],
    effectiveFrom: EPOCH,
    roleRequirements: requirements('AMER', [
      ['Lead', 1, 1],
      ['Crew', 1, undefined, true],
      ['Crew-BC', 0, 1],
      ['Batch-E', 1, 1],
      ['Batch-L', 1, 1],
      ['Batch-U', 0, 1],
      ['Cover', 0, 3, true],
      ['ST Amer', 1, 1],
    ]),
  },
  {
    id: 'dc-amer-friday',
    regionId: 'AMER',
    key: 'friday',
    weekdays: [5],
    effectiveFrom: EPOCH,
    roleRequirements: requirements('AMER', [
      ['Lead-E', 1, 1],
      ['Crew-E', 1, 3, true],
      ['Crew-L', 1, 1],
      ['Batch-E', 1, 1],
      ['Batch-L', 1, 1],
      ['Cover', 0, 3],
      ['ST Amer', 1, 1],
    ]),
  },
  {
    id: 'dc-amer-weekend',
    regionId: 'AMER',
    key: 'weekend',
    weekdays: [6, 7],
    effectiveFrom: EPOCH,
    roleRequirements: requirements('AMER', [
      ['Primary', 1, 1, true],
      ['Secondary', 0, 1],
      ['ST', 0, 1],
      ['Shadow', 0, 1],
    ]),
  },
  {
    id: 'dc-amer-holiday',
    regionId: 'AMER',
    key: 'holiday',
    weekdays: [],
    effectiveFrom: EPOCH,
    roleRequirements: requirements('AMER', [
      ['Primary', 1, 1, true],
      ['OnCall S3', 0, 1],
    ]),
  },

  {
    id: 'dc-emea-weekday',
    regionId: 'EMEA',
    key: 'weekday',
    weekdays: [1, 2, 3, 4, 5],
    effectiveFrom: EPOCH,
    roleRequirements: requirements('EMEA', [
      ['Shift-Lead', 1, 2],
      ['BM', 1, undefined],
      ['BM-Lead', 0, 1],
      ['E', 1, undefined, true],
      ['MOD', 0, 1],
      ['CH-Early', 1, 1],
      ['CH-SL', 1, 1],
      ['CH-Late', 0, 1],
      ['ST EMEA', 1, 1],
    ]),
  },
  {
    id: 'dc-emea-weekend',
    regionId: 'EMEA',
    key: 'weekend',
    weekdays: [6, 7],
    effectiveFrom: EPOCH,
    roleRequirements: requirements('EMEA', [['CH-OC', 1, 1, true]]),
  },
  {
    id: 'dc-emea-holiday',
    regionId: 'EMEA',
    key: 'holiday',
    weekdays: [],
    effectiveFrom: EPOCH,
    roleRequirements: requirements('EMEA', [['CH-OC', 1, 1, true]]),
  },

  {
    id: 'dc-apac-weekday',
    regionId: 'APAC',
    key: 'weekday',
    weekdays: [1, 2, 3, 4, 5],
    effectiveFrom: EPOCH,
    roleRequirements: requirements('APAC', [
      ['M', 1, undefined, true],
      ['G', 0, 2],
      ['ST APAC', 1, 1],
    ]),
  },
  {
    id: 'dc-apac-weekend',
    regionId: 'APAC',
    key: 'weekend',
    weekdays: [6, 7],
    effectiveFrom: EPOCH,
    roleRequirements: requirements('APAC', [['MC', 1, 1, true]]),
  },
  {
    id: 'dc-apac-holiday',
    regionId: 'APAC',
    key: 'holiday',
    weekdays: [],
    effectiveFrom: EPOCH,
    roleRequirements: requirements('APAC', [['M', 1, 1, true]]),
  },
];

// ---------------------------------------------------------------------------
// Люди
// ---------------------------------------------------------------------------

const NAME_POOLS: Record<string, { first: readonly string[]; last: readonly string[] }> = {
  'loc-nyc': {
    first: ['Michael', 'Sarah', 'David', 'Emily', 'James', 'Olivia', 'Robert', 'Laura', 'Kevin', 'Rachel'],
    last: ['Reed', 'Carter', 'Brooks', 'Whitfield', 'Grant', 'Nash', 'Simmons', 'Doyle', 'Pierce', 'Vance'],
  },
  'loc-chi': {
    first: ['Thomas', 'Megan', 'Brian', 'Alison', 'Patrick', 'Nicole', 'Gregory', 'Dana'],
    last: ['Foley', 'Kowalski', 'Ramirez', 'Sullivan', 'Brennan', 'Novak', 'Castillo', 'Hoffman'],
  },
  'loc-hfd': {
    first: ['Curtis', 'Bethany', 'Marcus', 'Joanne'],
    last: ['Aldridge', 'Prescott', 'Lambert', 'Whitaker'],
  },
  'loc-pune': {
    first: ['Rohan', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Anjali', 'Karan', 'Divya', 'Suresh', 'Neha', 'Nikhil', 'Pooja', 'Rahul', 'Meera'],
    last: ['Deshpande', 'Kulkarni', 'Joshi', 'Iyer', 'Rao', 'Menon', 'Bhatt', 'Nair', 'Pillai', 'Chauhan', 'Gokhale', 'Shetty', 'Verma', 'Sane'],
  },
  'loc-lon': {
    first: ['Daniel', 'Charlotte', 'Oliver', 'Sophie', 'Marcus', 'Hannah', 'Adam', 'Grace', 'Nathan', 'Imogen'],
    last: ['Whitmore', 'Ellis', 'Bennett', 'Harding', 'Cole', 'Reid', 'Fletcher', 'Lowry', 'Ashworth', 'Pemberton'],
  },
  'loc-ste': {
    first: ['Colin', 'Fiona', 'Derek'],
    last: ['Braithwaite', 'Kingsley', 'Marsden'],
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

interface StaffGroup {
  readonly regionId: string;
  readonly unitId: string;
  readonly locationId: string;
  readonly shiftId: string;
  readonly count: number;
  readonly orgCategory: Person['orgCategory'];
  /** Роли региона и вероятность попасть в пул. */
  readonly rolePool: ReadonlyArray<readonly [code: string, probability: number]>;
  readonly defaultRole: string;
  readonly weekendEligible: boolean;
}

const AMER_SUPPORT_POOL: ReadonlyArray<readonly [string, number]> = [
  ['Lead', 0.3],
  ['Lead-E', 0.25],
  ['Crew', 0.7],
  ['Crew-E', 0.5],
  ['Crew-L', 0.35],
  ['Crew-BC', 0.3],
  ['Batch-E', 0.4],
  ['Batch-L', 0.4],
  ['Batch-U', 0.2],
  ['Cover', 0.8],
  ['Primary', 0.45],
  ['Secondary', 0.35],
  ['Shadow', 0.2],
  ['OnCall S3', 0.25],
];

const EMEA_SUPPORT_POOL: ReadonlyArray<readonly [string, number]> = [
  ['Shift-Lead', 0.3],
  ['BM', 0.55],
  ['BM-Lead', 0.25],
  ['E', 0.85],
  ['MOD', 0.15],
];

const EMEA_CH_POOL: ReadonlyArray<readonly [string, number]> = [
  ['CH-Early', 0.7],
  ['CH-SL', 0.5],
  ['CH-Late', 0.5],
  ['CH-OC', 0.6],
  ['E', 0.4],
];

const APAC_SUPPORT_POOL: ReadonlyArray<readonly [string, number]> = [
  ['M', 0.9],
  ['G', 0.5],
  ['MC', 0.45],
];

const STAFFING: readonly StaffGroup[] = [
  // AMER region, AMER unit
  { regionId: 'AMER', unitId: 'unit-amer', locationId: 'loc-chi', shiftId: 'sh-amer-chi', count: 7, orgCategory: 'SUPPORT', rolePool: AMER_SUPPORT_POOL, defaultRole: 'Crew', weekendEligible: true },
  { regionId: 'AMER', unitId: 'unit-amer', locationId: 'loc-nyc', shiftId: 'sh-amer-nyc', count: 8, orgCategory: 'SUPPORT', rolePool: AMER_SUPPORT_POOL, defaultRole: 'Crew', weekendEligible: true },
  { regionId: 'AMER', unitId: 'unit-amer', locationId: 'loc-pune', shiftId: 'sh-amer-pune', count: 9, orgCategory: 'SUPPORT', rolePool: AMER_SUPPORT_POOL, defaultRole: 'Batch-L', weekendEligible: true },
  { regionId: 'AMER', unitId: 'unit-amer', locationId: 'loc-nyc', shiftId: 'sh-amer-nyc', count: 1, orgCategory: 'MANAGEMENT', rolePool: [], defaultRole: '', weekendEligible: false },

  // EMEA region, EMEA unit
  { regionId: 'EMEA', unitId: 'unit-emea', locationId: 'loc-lon', shiftId: 'sh-emea-lon', count: 8, orgCategory: 'SUPPORT', rolePool: EMEA_SUPPORT_POOL, defaultRole: 'E', weekendEligible: false },
  { regionId: 'EMEA', unitId: 'unit-emea', locationId: 'loc-ste', shiftId: 'sh-emea-lon', count: 3, orgCategory: 'SUPPORT', rolePool: EMEA_SUPPORT_POOL, defaultRole: 'E', weekendEligible: false },
  { regionId: 'EMEA', unitId: 'unit-emea', locationId: 'loc-zrh', shiftId: 'sh-emea-zrh', count: 6, orgCategory: 'SUPPORT', rolePool: EMEA_CH_POOL, defaultRole: 'CH-Early', weekendEligible: true },
  { regionId: 'EMEA', unitId: 'unit-emea', locationId: 'loc-pune', shiftId: 'sh-emea-pune', count: 6, orgCategory: 'SUPPORT', rolePool: EMEA_SUPPORT_POOL, defaultRole: 'E', weekendEligible: false },
  { regionId: 'EMEA', unitId: 'unit-emea', locationId: 'loc-lon', shiftId: 'sh-emea-lon', count: 1, orgCategory: 'MANAGEMENT', rolePool: [], defaultRole: '', weekendEligible: false },

  // APAC region, APAC unit
  { regionId: 'APAC', unitId: 'unit-apac', locationId: 'loc-sgp', shiftId: 'sh-apac-sgp', count: 8, orgCategory: 'SUPPORT', rolePool: APAC_SUPPORT_POOL, defaultRole: 'M', weekendEligible: true },
  { regionId: 'APAC', unitId: 'unit-apac', locationId: 'loc-pune', shiftId: 'sh-apac-pune', count: 6, orgCategory: 'SUPPORT', rolePool: APAC_SUPPORT_POOL, defaultRole: 'M', weekendEligible: true },
  { regionId: 'APAC', unitId: 'unit-apac', locationId: 'loc-sgp', shiftId: 'sh-apac-mid', count: 2, orgCategory: 'SUPPORT', rolePool: [['G', 1]], defaultRole: 'G', weekendEligible: false },

  // Service Transition unit — люди остаются в своих регионах (ADR-0020)
  { regionId: 'AMER', unitId: 'unit-st', locationId: 'loc-hfd', shiftId: 'sh-amer-hfd', count: 3, orgCategory: 'SERVICE_TRANSITION', rolePool: [['ST Amer', 1], ['ST', 0.6]], defaultRole: 'ST Amer', weekendEligible: true },
  { regionId: 'AMER', unitId: 'unit-st', locationId: 'loc-nyc', shiftId: 'sh-amer-nyc', count: 1, orgCategory: 'SERVICE_TRANSITION', rolePool: [['ST Amer', 1], ['ST', 0.6]], defaultRole: 'ST Amer', weekendEligible: true },
  { regionId: 'EMEA', unitId: 'unit-st', locationId: 'loc-lon', shiftId: 'sh-emea-lon', count: 3, orgCategory: 'SERVICE_TRANSITION', rolePool: [['ST EMEA', 1]], defaultRole: 'ST EMEA', weekendEligible: false },
  { regionId: 'APAC', unitId: 'unit-st', locationId: 'loc-sgp', shiftId: 'sh-apac-sgp', count: 3, orgCategory: 'SERVICE_TRANSITION', rolePool: [['ST APAC', 1]], defaultRole: 'ST APAC', weekendEligible: false },
  { regionId: 'EMEA', unitId: 'unit-st', locationId: 'loc-lon', shiftId: 'sh-emea-lon', count: 1, orgCategory: 'MANAGEMENT', rolePool: [], defaultRole: '', weekendEligible: false },
];

const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5];
const ALL_DAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

function normalizeShares(
  regionId: string,
  entries: readonly (readonly [string, number])[],
): RoleEligibility[] {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total === 0) return [];
  return entries.map(([code, weight]) => ({
    roleId: roleId(regionId, code),
    targetShare: Math.round((weight / total) * 100) / 100,
  }));
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 3);
}

function buildPeople(): Person[] {
  const rnd = mulberry32(20260801);
  const people: Person[] = [];
  const usedNames = new Set<string>();
  const counters = new Map<string, number>();
  let employeeSeq = 41000;

  const nextName = (locationId: string): string => {
    const pool = NAME_POOLS[locationId];
    if (!pool) throw new Error(`No name pool for location ${locationId}`);
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
    throw new Error(`Could not find a unique name for ${locationId}`);
  };

  for (const group of STAFFING) {
    for (let i = 0; i < group.count; i += 1) {
      const displayName = nextName(group.locationId);
      const id = `p-${displayName.toLowerCase().replace(/[^a-z]+/g, '-')}`;
      const isManager = group.orgCategory === 'MANAGEMENT';

      const chosen = group.rolePool.filter(([, probability]) => rnd() < probability);
      const pool = chosen.length > 0 ? chosen : group.rolePool.slice(0, 1);
      const eligibility = isManager ? [] : normalizeShares(group.regionId, pool);

      // Гарантируем, что роль по умолчанию доступна человеку.
      if (!isManager && group.defaultRole) {
        const defaultId = roleId(group.regionId, group.defaultRole);
        if (!eligibility.some((e) => e.roleId === defaultId)) {
          eligibility.push({ roleId: defaultId, targetShare: 0.2 });
        }
      }

      people.push({
        id,
        displayName,
        initials: initialsOf(displayName),
        employeeId: String((employeeSeq += 1)),
        regionId: group.regionId,
        unitId: group.unitId,
        locationId: group.locationId,
        defaultShiftId: group.shiftId,
        orgCategory: group.orgCategory,
        isActive: true,
        isIncluded: !isManager,
        eligibility,
        availableWeekdays: group.weekendEligible ? ALL_DAYS : WEEKDAYS,
        ...(isManager || !group.defaultRole
          ? {}
          : { defaultRoleId: roleId(group.regionId, group.defaultRole) }),
        weekendEligible: group.weekendEligible,
        constraints: {
          minRestHours: 11,
          maxConsecutiveDays: rnd() < 0.2 ? 4 : 6,
          maxWeekendsPerQuarter: 3,
        },
        calendarToken: `tok-${id}`,
      });
    }
  }

  return people;
}

export const people: readonly Person[] = buildPeople();

// ---------------------------------------------------------------------------
// Лимиты одновременных отсутствий — правило владельца продукта (ADR-0010)
// ---------------------------------------------------------------------------

function buildAbsenceCapacityRules(): AbsenceCapacityRule[] {
  const rules: AbsenceCapacityRule[] = [];
  const counted = ['VACATION', 'SICK', 'OTHER'] as const;

  for (const region of regions) {
    rules.push({
      id: `acr-${region.id}-long`,
      regionId: region.id,
      scope: { kind: 'REGION' },
      durationBucket: 'LONG',
      longThresholdWorkdays: 5,
      maxConcurrent: 3,
      countsTypes: counted,
      countsCompDays: true,
    });
    rules.push({
      id: `acr-${region.id}-short`,
      regionId: region.id,
      scope: { kind: 'REGION' },
      durationBucket: 'SHORT',
      longThresholdWorkdays: 5,
      maxConcurrent: 4,
      countsTypes: counted,
      countsCompDays: true,
    });
  }

  // ASSUMPTION: какие пулы критичны, владельцем не подтверждено.
  const criticalPools: ReadonlyArray<readonly [string, string]> = [
    ['AMER', 'Lead'],
    ['EMEA', 'Shift-Lead'],
    ['APAC', 'M'],
  ];
  for (const [regionId, code] of criticalPools) {
    rules.push({
      id: `acr-${regionId}-pool-${code}`,
      regionId,
      scope: { kind: 'ROLE_POOL', roleId: roleId(regionId, code) },
      durationBucket: 'LONG',
      longThresholdWorkdays: 5,
      maxConcurrent: 1,
      countsTypes: counted,
      countsCompDays: true,
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

  for (const person of people) {
    if (!person.isIncluded) continue;
    // Примерно каждый третий отдыхает в августе — летний сценарий.
    if (rnd() > 0.32) continue;
    const startDay = 1 + Math.floor(rnd() * 24);
    const length = rnd() < 0.55 ? 2 + Math.floor(rnd() * 3) : 6 + Math.floor(rnd() * 8);
    const from = DateTime.fromISO('2026-08-01').plus({ days: startDay - 1 });
    const to = from.plus({ days: length - 1 });
    seq += 1;
    result.push({
      id: `abs-${seq}`,
      personId: person.id,
      type: rnd() < 0.9 ? 'VACATION' : 'SICK',
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
// Назначения — частично заполненный август
// ---------------------------------------------------------------------------

const holidayDatesByLocation = new Map<string, Set<IsoDate>>();
for (const location of locations) holidayDatesByLocation.set(location.id, new Set());
for (const holiday of holidays) {
  for (const locationId of holiday.locationIds) {
    holidayDatesByLocation.get(locationId)?.add(holiday.date);
  }
}

function resolveConfigKey(regionId: string, date: IsoDate): DayConfiguration | undefined {
  const region = regions.find((r) => r.id === regionId);
  if (!region) return undefined;
  const weekday = DateTime.fromISO(date).weekday as Weekday;
  const isHoliday = holidayDatesByLocation.get(region.primaryLocationId)?.has(date) ?? false;
  const configs = dayConfigurations.filter((c) => c.regionId === regionId);

  if (isHoliday) {
    const holidayConfig = configs.find((c) => c.key === 'holiday');
    if (holidayConfig) return holidayConfig;
  }
  return configs.find((c) => c.key !== 'holiday' && c.weekdays.includes(weekday));
}

/**
 * Примерно 80% требуемого минимума. Дыры оставлены намеренно, чтобы полоса
 * покрытия при первом открытии показывала все уровни.
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
  for (
    let cursor = DateTime.fromISO(DEFAULT_PERIOD.from);
    cursor <= DateTime.fromISO(DEFAULT_PERIOD.to);
    cursor = cursor.plus({ days: 1 })
  ) {
    dates.push(cursor.toFormat('yyyy-MM-dd'));
  }

  const cursorByRole = new Map<string, number>();

  for (const region of regions) {
    const regionPeople = people.filter((p) => p.regionId === region.id && p.isIncluded);

    for (const date of dates) {
      const config = resolveConfigKey(region.id, date);
      if (!config) continue;
      const weekday = DateTime.fromISO(date).weekday as Weekday;
      const takenToday = new Set<string>();

      for (const requirement of config.roleRequirements) {
        const roll = rnd();
        const wanted =
          roll < 0.12 ? Math.max(0, requirement.min - 1) : roll < 0.45 ? requirement.min : requirement.min + (requirement.max !== undefined && requirement.max > requirement.min ? 1 : 0);
        if (wanted === 0) continue;

        const candidates = regionPeople.filter(
          (p) =>
            p.eligibility.some((e) => e.roleId === requirement.roleId) &&
            p.availableWeekdays.includes(weekday) &&
            !takenToday.has(p.id) &&
            !isAbsent(p.id, date),
        );
        if (candidates.length === 0) continue;

        const cursor = cursorByRole.get(requirement.roleId) ?? 0;
        for (let placed = 0; placed < wanted && placed < candidates.length; placed += 1) {
          const person = candidates[(cursor + placed) % candidates.length];
          if (!person || takenToday.has(person.id)) continue;
          takenToday.add(person.id);
          const location = locations.find((l) => l.id === person.locationId);
          seq += 1;
          result.push({
            id: `as-${seq}`,
            personId: person.id,
            date,
            regionId: region.id,
            content: { kind: 'ROLE', roleId: requirement.roleId },
            isWeekend: location ? location.weekendDays.includes(weekday) : false,
            source: 'GENERATED',
            version: 1,
            createdBy: SYSTEM,
            createdAt: CREATED_AT,
          });
        }
        cursorByRole.set(requirement.roleId, cursor + wanted);
      }
    }
  }

  return result;
}

export const assignments: readonly Assignment[] = buildAssignments();

// ---------------------------------------------------------------------------
// Отгулы за уже расставленные выходные
// ---------------------------------------------------------------------------

/**
 * Фикстуры должны быть внутренне непротиворечивы: если человек уже поставлен
 * на субботу, отгул за неё уже начислен. Иначе первая же правка планировщика
 * подберёт весь этот хвост и припишет его себе.
 *
 * Дата подбирается тем же правилом, что и в движке, но без обращения к нему:
 * `domain` не зависит от `engine`.
 */
function buildCompDays(): CompDayEntry[] {
  const result: CompDayEntry[] = [];
  const occupied = new Map<string, Set<IsoDate>>();

  const assignedCells = new Set(assignments.map((a) => `${a.personId}|${a.date}`));
  const absenceByPerson = new Map<string, Absence[]>();
  for (const absence of absences) {
    const bucket = absenceByPerson.get(absence.personId);
    if (bucket) bucket.push(absence);
    else absenceByPerson.set(absence.personId, [absence]);
  }

  const ordered = [...assignments].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );

  for (const assignment of ordered) {
    const person = people.find((p) => p.id === assignment.personId);
    if (!person) continue;
    const location = locations.find((l) => l.id === person.locationId);
    const region = regions.find((r) => r.id === person.regionId);
    if (!location || !region) continue;

    const weekday = DateTime.fromISO(assignment.date).weekday as Weekday;
    const isHoliday = holidayDatesByLocation.get(location.id)?.has(assignment.date) ?? false;
    const isWeekend = location.weekendDays.includes(weekday);
    if (!isHoliday && !isWeekend) continue;

    const policy = region.compOffPolicy;
    const taken = occupied.get(person.id) ?? new Set<IsoDate>();
    const slot = findSlot(assignment.date, person.id, location.id, policy, assignedCells, taken);

    result.push({
      id: `cd-${assignment.id}`,
      personId: person.id,
      earnedForAssignmentId: assignment.id,
      earnedForDate: assignment.date,
      trigger: isHoliday ? 'HOLIDAY' : weekday === 7 ? 'SUNDAY' : 'SATURDAY',
      ...(slot !== undefined ? { proposedDate: slot } : {}),
      status: slot !== undefined ? 'PROPOSED' : 'PENDING_APPROVAL',
    });

    if (slot !== undefined) {
      taken.add(slot);
      occupied.set(person.id, taken);
    }
  }

  function findSlot(
    earnedFor: IsoDate,
    personId: string,
    locationId: string,
    policy: CompOffPolicy,
    assignedCellKeys: ReadonlySet<string>,
    taken: ReadonlySet<IsoDate>,
  ): IsoDate | undefined {
    const location = locations.find((l) => l.id === locationId);
    if (!location) return undefined;
    const holidays = holidayDatesByLocation.get(locationId);
    const personAbsences = absenceByPerson.get(personId) ?? [];

    const isFree = (date: IsoDate): boolean => {
      const weekday = DateTime.fromISO(date).weekday as Weekday;
      if (policy.excludedWeekdays.includes(weekday)) return false;
      if (location.weekendDays.includes(weekday)) return false;
      if (holidays?.has(date)) return false;
      if (taken.has(date)) return false;
      if (assignedCellKeys.has(`${personId}|${date}`)) return false;
      return !personAbsences.some((a) => date >= a.from && date <= a.to);
    };

    const base = DateTime.fromISO(earnedFor);
    const maxOffset = Math.max(policy.windowAfterDays, policy.windowBeforeDays);
    for (let offset = 1; offset <= maxOffset; offset += 1) {
      if (offset <= policy.windowAfterDays) {
        const after = base.plus({ days: offset }).toFormat('yyyy-MM-dd');
        if (isFree(after)) return after;
      }
      if (offset <= policy.windowBeforeDays) {
        const before = base.minus({ days: offset }).toFormat('yyyy-MM-dd');
        if (isFree(before)) return before;
      }
    }
    return undefined;
  }

  return result;
}

export const compDays: readonly CompDayEntry[] = buildCompDays();

// ---------------------------------------------------------------------------
// Датасет
// ---------------------------------------------------------------------------

export function createFixtureDataset(): ScheduleDataset {
  return {
    locations,
    holidays,
    regions,
    units,
    shifts,
    roles,
    dayConfigurations,
    people,
    absenceCapacityRules,
    assignments,
    absences,
    compDays,
    acknowledgements: [],
    history: [],
  };
}
