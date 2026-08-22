/**
 * Wire (backend JSON) ↔ domain (`domain/types.ts`) mapping.
 *
 * The backend serializes enums with `JsonStringEnumConverter(CamelCase)`
 * (`Program.cs`) and C# properties as camelCase (ASP.NET Core web defaults);
 * the client's own enums are `UPPER_SNAKE` (`domain/types.ts`). Every one of
 * them converts with the same generic `camelToUpperSnake`/`upperSnakeToCamel`
 * pair — verified against every enum in `api/src/ShiftOMator.Domain/Enums.cs`.
 * The one exception is `Weekday`, which is numeric on the client (Luxon
 * convention) and a weekday name on the wire (`IsoWeekday`).
 *
 * `Assignment` is also *structurally* different: the wire shape flattens
 * `content` into `contentKind`/`shiftId`/`marker`/`timeOverride` (an EF-mapped
 * class can't hold a discriminated union); `toWireAssignment`/`fromWireAssignment`
 * do the reshaping in both directions.
 *
 * Phase 8 deleted `Region` on the backend and merged its fields (name,
 * primary location, member locations, comp-off policy) into `PlanningUnit`;
 * `ShiftRole`/`ShiftDefinition` merged into the single `Shift` entity. This
 * file follows both renames.
 */

import type {
  Absence,
  AbsenceCapacityRule,
  AbsenceType,
  Acknowledgement,
  AssignmentContent,
  AssignmentHistoryEntry,
  AssignmentSource,
  Assignment,
  CompDayEntry,
  CompDayStatus,
  CompDayTrigger,
  CoverageCell,
  DayConfiguration,
  DraftChange,
  DraftOp,
  DraftSession,
  DraftTargetType,
  GroupBy,
  Holiday,
  IsoDate,
  Issue,
  IssueCategory,
  IssueCode,
  IssueLevel,
  Location,
  Person,
  PersonPreferences,
  PlanningUnit,
  PublishConflict,
  PublishResult,
  ReferenceData,
  RosterMarker,
  Shift,
  ShiftEligibility,
  ShiftRequirement,
  TimeOverride,
  UnitKind,
  Weekday,
} from '../domain/types.ts';

// ---------------------------------------------------------------------------
// Generic enum + primitive conversions
// ---------------------------------------------------------------------------

/** `pendingApproval` → `PENDING_APPROVAL`. Covers every wire enum but Weekday. */
export function camelToUpperSnake<T extends string>(value: string): T {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase() as T;
}

/** `PENDING_APPROVAL` → `pendingApproval`. Inverse of `camelToUpperSnake`. */
export function upperSnakeToCamel(value: string): string {
  return value.toLowerCase().replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

const WEEKDAY_TO_NAME: Record<Weekday, string> = {
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
  7: 'sunday',
};
const NAME_TO_WEEKDAY: Record<string, Weekday> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

export function weekdayFromWire(name: string): Weekday {
  const day = NAME_TO_WEEKDAY[name];
  if (!day) throw new Error(`Unknown wire weekday "${name}"`);
  return day;
}
export function weekdayToWire(day: Weekday): string {
  return WEEKDAY_TO_NAME[day];
}
export function weekdaysFromWire(names: readonly string[]): Weekday[] {
  return names.map(weekdayFromWire);
}
export function weekdaysToWire(days: readonly Weekday[]): string[] {
  return days.map(weekdayToWire);
}

/** `"09:00:00"` (TimeOnly) → `"09:00"` (TimeOfDay). */
export function timeFromWire(value: string): string {
  return value.slice(0, 5);
}
/** `"09:00"` → `"09:00:00"`. */
export function timeToWire(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

/** Normalizes a `DateTimeOffset` (`+00:00` suffix) to the `Z`-suffixed instant the
 * client expects — same moment, different string. */
export function instantFromWire(value: string): string {
  return new Date(value).toISOString();
}
export function instantToWire(value: string): string {
  return value;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

interface WireLocation {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly timeZone: string;
  readonly holidayCalendarKey: string;
  readonly weekendDays: readonly string[];
}

export function locationFromWire(w: WireLocation): Location {
  return {
    id: w.id,
    name: w.name,
    country: w.country,
    timeZone: w.timeZone,
    holidayCalendarKey: w.holidayCalendarKey,
    weekendDays: weekdaysFromWire(w.weekendDays),
  };
}

interface WireHoliday {
  readonly id: string;
  readonly date: IsoDate;
  readonly name: string;
  readonly locationIds: readonly string[];
  readonly isFullDay: boolean;
}

export function holidayFromWire(w: WireHoliday): Holiday {
  return { id: w.id, date: w.date, name: w.name, locationIds: w.locationIds, isFullDay: w.isFullDay };
}

interface WireCompOffPolicy {
  readonly windowBeforeDays: number;
  readonly windowAfterDays: number;
  readonly excludedWeekdays: readonly string[];
  readonly agingThresholdDays: number;
  readonly requiresApprovalWhenNoSlot: boolean;
}

interface WirePlanningUnit {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly groupBy: string;
  readonly primaryLocationId: string;
  readonly locationIds: readonly string[];
  readonly compOffPolicy: WireCompOffPolicy;
}

function compOffPolicyFromWire(w: WireCompOffPolicy) {
  return {
    windowBeforeDays: w.windowBeforeDays,
    windowAfterDays: w.windowAfterDays,
    excludedWeekdays: weekdaysFromWire(w.excludedWeekdays),
    agingThresholdDays: w.agingThresholdDays,
    requiresApprovalWhenNoSlot: w.requiresApprovalWhenNoSlot,
  };
}

export function unitFromWire(w: WirePlanningUnit): PlanningUnit {
  return {
    id: w.id,
    name: w.name,
    kind: camelToUpperSnake<UnitKind>(w.kind),
    groupBy: camelToUpperSnake<GroupBy>(w.groupBy),
    primaryLocationId: w.primaryLocationId,
    locationIds: w.locationIds,
    compOffPolicy: compOffPolicyFromWire(w.compOffPolicy),
  };
}

interface WireShift {
  readonly id: string;
  readonly unitId: string;
  readonly code: string;
  readonly label: string;
  readonly description?: string | null;
  readonly color: string;
  readonly hotkey?: string | null;
  readonly timeZone: string;
  readonly start: string;
  readonly end: string;
  readonly crossesMidnight: boolean;
  readonly breakMinutes: number;
  readonly countsAsCoverage: boolean;
  readonly editableTime: boolean;
}

export function shiftFromWire(w: WireShift): Shift {
  return {
    id: w.id,
    unitId: w.unitId,
    code: w.code,
    label: w.label,
    ...(w.description ? { description: w.description } : {}),
    color: w.color,
    ...(w.hotkey ? { hotkey: w.hotkey } : {}),
    timeZone: w.timeZone,
    start: timeFromWire(w.start),
    end: timeFromWire(w.end),
    crossesMidnight: w.crossesMidnight,
    breakMinutes: w.breakMinutes,
    countsAsCoverage: w.countsAsCoverage,
    editableTime: w.editableTime,
  };
}

interface WireShiftRequirement {
  readonly shiftId: string;
  readonly min: number;
  readonly max?: number | null;
  readonly isDefault: boolean;
  readonly timingOverrideStart?: string | null;
  readonly timingOverrideEnd?: string | null;
  readonly timingOverrideCrossesMidnight?: boolean | null;
}

function shiftRequirementFromWire(w: WireShiftRequirement): ShiftRequirement {
  const timingOverride: TimeOverride | undefined =
    w.timingOverrideStart && w.timingOverrideEnd
      ? {
          start: timeFromWire(w.timingOverrideStart),
          end: timeFromWire(w.timingOverrideEnd),
          crossesMidnight: w.timingOverrideCrossesMidnight ?? false,
        }
      : undefined;
  return {
    shiftId: w.shiftId,
    min: w.min,
    ...(w.max !== null && w.max !== undefined ? { max: w.max } : {}),
    isDefault: w.isDefault,
    ...(timingOverride ? { timingOverride } : {}),
  };
}

interface WireDayConfiguration {
  readonly id: string;
  readonly unitId: string;
  readonly key: string;
  readonly weekdays: readonly string[];
  readonly date?: IsoDate | null;
  readonly label?: string | null;
  readonly effectiveFrom: IsoDate;
  readonly shiftRequirements: readonly WireShiftRequirement[];
}

export function dayConfigurationFromWire(w: WireDayConfiguration): DayConfiguration {
  return {
    id: w.id,
    unitId: w.unitId,
    // DayConfigKey is already a single lowercase word on both sides ('weekday', 'friday', …).
    key: w.key as DayConfiguration['key'],
    weekdays: weekdaysFromWire(w.weekdays),
    ...(w.date ? { date: w.date } : {}),
    ...(w.label ? { label: w.label } : {}),
    effectiveFrom: w.effectiveFrom,
    shiftRequirements: w.shiftRequirements.map(shiftRequirementFromWire),
  };
}

interface WireShiftEligibility {
  readonly shiftId: string;
  readonly targetShare: number;
  readonly minPerWeek?: number | null;
  readonly maxPerWeek?: number | null;
}

function eligibilityFromWire(w: WireShiftEligibility): ShiftEligibility {
  return {
    shiftId: w.shiftId,
    targetShare: w.targetShare,
    ...(w.minPerWeek !== null && w.minPerWeek !== undefined ? { minPerWeek: w.minPerWeek } : {}),
    ...(w.maxPerWeek !== null && w.maxPerWeek !== undefined ? { maxPerWeek: w.maxPerWeek } : {}),
  };
}

interface WirePersonConstraints {
  readonly minRestHours: number;
  readonly maxConsecutiveDays: number;
  readonly maxWeekendsPerQuarter?: number | null;
}

interface WirePersonPreferences {
  readonly avoidsWeekdays?: readonly string[] | null;
  readonly preferredPartnerIds?: readonly string[] | null;
  readonly blackoutDates?: readonly IsoDate[] | null;
  readonly note?: string | null;
}

interface WirePerson {
  readonly id: string;
  readonly displayName: string;
  readonly initials: string;
  readonly employeeId?: string | null;
  readonly unitId: string;
  readonly locationId: string;
  readonly orgCategory: string;
  readonly isActive: boolean;
  readonly isIncluded: boolean;
  readonly availableWeekdays: readonly string[];
  readonly defaultShiftId?: string | null;
  readonly weekendEligible: boolean;
  readonly constraints: WirePersonConstraints;
  readonly preferences?: WirePersonPreferences | null;
  readonly calendarToken: string;
  readonly eligibility: readonly WireShiftEligibility[];
}

function preferencesFromWire(w: WirePersonPreferences): PersonPreferences {
  return {
    ...(w.avoidsWeekdays && w.avoidsWeekdays.length > 0
      ? { avoidsWeekdays: weekdaysFromWire(w.avoidsWeekdays) }
      : {}),
    ...(w.preferredPartnerIds && w.preferredPartnerIds.length > 0
      ? { preferredPartnerIds: w.preferredPartnerIds }
      : {}),
    ...(w.blackoutDates && w.blackoutDates.length > 0 ? { blackoutDates: w.blackoutDates } : {}),
    ...(w.note ? { note: w.note } : {}),
  };
}

export function personFromWire(w: WirePerson): Person {
  return {
    id: w.id,
    displayName: w.displayName,
    initials: w.initials,
    ...(w.employeeId ? { employeeId: w.employeeId } : {}),
    unitId: w.unitId,
    locationId: w.locationId,
    orgCategory: camelToUpperSnake(w.orgCategory),
    isActive: w.isActive,
    isIncluded: w.isIncluded,
    eligibility: w.eligibility.map(eligibilityFromWire),
    availableWeekdays: weekdaysFromWire(w.availableWeekdays),
    ...(w.defaultShiftId ? { defaultShiftId: w.defaultShiftId } : {}),
    weekendEligible: w.weekendEligible,
    constraints: {
      minRestHours: w.constraints.minRestHours,
      maxConsecutiveDays: w.constraints.maxConsecutiveDays,
      ...(w.constraints.maxWeekendsPerQuarter !== null && w.constraints.maxWeekendsPerQuarter !== undefined
        ? { maxWeekendsPerQuarter: w.constraints.maxWeekendsPerQuarter }
        : {}),
    },
    ...(w.preferences ? { preferences: preferencesFromWire(w.preferences) } : {}),
    calendarToken: w.calendarToken,
  };
}

interface WireAbsenceCapacityRule {
  readonly id: string;
  readonly unitId: string;
  readonly scopeKind: string;
  readonly scopeShiftId?: string | null;
  readonly durationBucket: string;
  readonly longThresholdWorkdays: number;
  readonly maxConcurrent: number;
  readonly countsTypes: readonly string[];
  readonly countsCompDays: boolean;
}

export function absenceCapacityRuleFromWire(w: WireAbsenceCapacityRule): AbsenceCapacityRule {
  return {
    id: w.id,
    unitId: w.unitId,
    scope: w.scopeShiftId ? { kind: 'SHIFT_POOL', shiftId: w.scopeShiftId } : { kind: 'UNIT' },
    durationBucket: camelToUpperSnake(w.durationBucket),
    longThresholdWorkdays: w.longThresholdWorkdays,
    maxConcurrent: w.maxConcurrent,
    countsTypes: w.countsTypes.map((t) => camelToUpperSnake<AbsenceType>(t)),
    countsCompDays: w.countsCompDays,
  };
}

export interface WireReferenceData {
  readonly locations: readonly WireLocation[];
  readonly holidays: readonly WireHoliday[];
  readonly units: readonly WirePlanningUnit[];
  readonly shifts: readonly WireShift[];
  readonly dayConfigurations: readonly WireDayConfiguration[];
  readonly people: readonly WirePerson[];
  readonly absenceCapacityRules: readonly WireAbsenceCapacityRule[];
}

export function referenceFromWire(w: WireReferenceData): ReferenceData {
  return {
    locations: w.locations.map(locationFromWire),
    holidays: w.holidays.map(holidayFromWire),
    units: w.units.map(unitFromWire),
    shifts: w.shifts.map(shiftFromWire),
    dayConfigurations: w.dayConfigurations.map(dayConfigurationFromWire),
    people: w.people.map(personFromWire),
    absenceCapacityRules: w.absenceCapacityRules.map(absenceCapacityRuleFromWire),
  };
}

// ---------------------------------------------------------------------------
// Plan data — assignment / absence / comp day
// ---------------------------------------------------------------------------

interface WireTimeOverride {
  readonly start: string;
  readonly end: string;
  readonly crossesMidnight: boolean;
}

interface WireAssignment {
  readonly id: string;
  readonly personId: string;
  readonly date: IsoDate;
  readonly unitId: string;
  readonly contentKind: string;
  readonly shiftId?: string | null;
  readonly timeOverride?: WireTimeOverride | null;
  readonly marker?: string | null;
  readonly isWeekend: boolean;
  readonly note?: string | null;
  readonly source: string;
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedBy?: string | null;
  readonly updatedAt?: string | null;
}

export function assignmentFromWire(w: WireAssignment): Assignment {
  const content: AssignmentContent =
    w.contentKind === 'shift'
      ? {
          kind: 'SHIFT',
          shiftId: w.shiftId ?? '',
          ...(w.timeOverride
            ? {
                timeOverride: {
                  start: timeFromWire(w.timeOverride.start),
                  end: timeFromWire(w.timeOverride.end),
                  crossesMidnight: w.timeOverride.crossesMidnight,
                },
              }
            : {}),
        }
      : { kind: 'MARKER', marker: camelToUpperSnake<RosterMarker>(w.marker ?? 'off') };

  return {
    id: w.id,
    personId: w.personId,
    date: w.date,
    unitId: w.unitId,
    content,
    isWeekend: w.isWeekend,
    ...(w.note ? { note: w.note } : {}),
    source: camelToUpperSnake<AssignmentSource>(w.source),
    version: w.version,
    createdBy: w.createdBy,
    createdAt: instantFromWire(w.createdAt),
    ...(w.updatedBy ? { updatedBy: w.updatedBy } : {}),
    ...(w.updatedAt ? { updatedAt: instantFromWire(w.updatedAt) } : {}),
  };
}

export function assignmentToWire(a: Assignment): WireAssignment {
  return {
    id: a.id,
    personId: a.personId,
    date: a.date,
    unitId: a.unitId,
    contentKind: a.content.kind === 'SHIFT' ? 'shift' : 'marker',
    shiftId: a.content.kind === 'SHIFT' ? a.content.shiftId : null,
    timeOverride:
      a.content.kind === 'SHIFT' && a.content.timeOverride
        ? {
            start: timeToWire(a.content.timeOverride.start),
            end: timeToWire(a.content.timeOverride.end),
            crossesMidnight: a.content.timeOverride.crossesMidnight,
          }
        : null,
    marker: a.content.kind === 'MARKER' ? upperSnakeToCamel(a.content.marker) : null,
    isWeekend: a.isWeekend,
    note: a.note ?? null,
    source: upperSnakeToCamel(a.source),
    version: a.version,
    createdBy: a.createdBy,
    createdAt: instantToWire(a.createdAt),
    updatedBy: a.updatedBy ?? null,
    updatedAt: a.updatedAt ? instantToWire(a.updatedAt) : null,
  };
}

interface WireAbsence {
  readonly id: string;
  readonly personId: string;
  readonly type: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly source: string;
  readonly importBatchId?: string | null;
  readonly lastSeenInImportAt?: string | null;
  readonly syncedToHrAt?: string | null;
  readonly note?: string | null;
}

export function absenceFromWire(w: WireAbsence): Absence {
  return {
    id: w.id,
    personId: w.personId,
    type: camelToUpperSnake(w.type),
    from: w.from,
    to: w.to,
    source: camelToUpperSnake(w.source),
    ...(w.importBatchId ? { importBatchId: w.importBatchId } : {}),
    ...(w.lastSeenInImportAt ? { lastSeenInImportAt: instantFromWire(w.lastSeenInImportAt) } : {}),
    ...(w.syncedToHrAt ? { syncedToHrAt: instantFromWire(w.syncedToHrAt) } : {}),
    ...(w.note ? { note: w.note } : {}),
  };
}

export function absenceToWire(a: Absence): WireAbsence {
  return {
    id: a.id,
    personId: a.personId,
    type: upperSnakeToCamel(a.type),
    from: a.from,
    to: a.to,
    source: upperSnakeToCamel(a.source),
    importBatchId: a.importBatchId ?? null,
    lastSeenInImportAt: a.lastSeenInImportAt ? instantToWire(a.lastSeenInImportAt) : null,
    syncedToHrAt: a.syncedToHrAt ? instantToWire(a.syncedToHrAt) : null,
    note: a.note ?? null,
  };
}

interface WireCompDayEntry {
  readonly id: string;
  readonly personId: string;
  readonly earnedForAssignmentId: string;
  readonly earnedForDate: IsoDate;
  readonly trigger: string;
  readonly proposedDate?: IsoDate | null;
  readonly actualDate?: IsoDate | null;
  readonly status: string;
  readonly syncedToHrAt?: string | null;
}

export function compDayFromWire(w: WireCompDayEntry): CompDayEntry {
  return {
    id: w.id,
    personId: w.personId,
    earnedForAssignmentId: w.earnedForAssignmentId,
    earnedForDate: w.earnedForDate,
    trigger: camelToUpperSnake<CompDayTrigger>(w.trigger),
    ...(w.proposedDate ? { proposedDate: w.proposedDate } : {}),
    ...(w.actualDate ? { actualDate: w.actualDate } : {}),
    status: camelToUpperSnake<CompDayStatus>(w.status),
    ...(w.syncedToHrAt ? { syncedToHrAt: instantFromWire(w.syncedToHrAt) } : {}),
  };
}

export function compDayToWire(c: CompDayEntry): WireCompDayEntry {
  return {
    id: c.id,
    personId: c.personId,
    earnedForAssignmentId: c.earnedForAssignmentId,
    earnedForDate: c.earnedForDate,
    trigger: upperSnakeToCamel(c.trigger),
    proposedDate: c.proposedDate ?? null,
    actualDate: c.actualDate ?? null,
    status: upperSnakeToCamel(c.status),
    syncedToHrAt: c.syncedToHrAt ? instantToWire(c.syncedToHrAt) : null,
  };
}

// ---------------------------------------------------------------------------
// Coverage + issues (computed server-side, read-only on the client)
// ---------------------------------------------------------------------------

interface WireCoverageCell {
  readonly date: IsoDate;
  readonly unitId: string;
  readonly shiftId: string;
  readonly actual: number;
  readonly min: number;
  readonly max?: number | null;
  readonly level: string;
  readonly appliedKey: string;
  readonly ruleLabel?: string | null;
}

export function coverageCellFromWire(w: WireCoverageCell): CoverageCell {
  return {
    date: w.date,
    unitId: w.unitId,
    shiftId: w.shiftId,
    actual: w.actual,
    min: w.min,
    ...(w.max !== null && w.max !== undefined ? { max: w.max } : {}),
    level: camelToUpperSnake(w.level),
    appliedKey: w.appliedKey as CoverageCell['appliedKey'],
    ...(w.ruleLabel ? { ruleLabel: w.ruleLabel } : {}),
  };
}

interface WireIssue {
  readonly key: string;
  readonly level: string;
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly unitId: string;
  readonly date?: IsoDate | null;
  readonly personId?: string | null;
  readonly shiftId?: string | null;
}

export function issueFromWire(w: WireIssue): Issue {
  return {
    key: w.key,
    level: camelToUpperSnake<IssueLevel>(w.level),
    category: camelToUpperSnake<IssueCategory>(w.category),
    code: camelToUpperSnake<IssueCode>(w.code),
    message: w.message,
    unitId: w.unitId,
    ...(w.date ? { date: w.date } : {}),
    ...(w.personId ? { personId: w.personId } : {}),
    ...(w.shiftId ? { shiftId: w.shiftId } : {}),
  };
}

interface WireAcknowledgement {
  readonly issueKey: string;
  readonly comment: string;
  readonly byPersonId: string;
  readonly at: string;
}

export function acknowledgementFromWire(w: WireAcknowledgement): Acknowledgement {
  return {
    issueKey: w.issueKey,
    comment: w.comment,
    byPersonId: w.byPersonId,
    at: instantFromWire(w.at),
  };
}

// ---------------------------------------------------------------------------
// Resolved day configuration (part of the GET /api/schedule response)
// ---------------------------------------------------------------------------

export interface ResolvedDayConfig {
  readonly date: IsoDate;
  readonly unitId: string;
  readonly dayConfigurationId: string;
  readonly key: DayConfiguration['key'];
  readonly label?: string;
}

interface WireResolvedDayConfig {
  readonly date: IsoDate;
  readonly unitId: string;
  readonly dayConfigurationId: string;
  readonly key: string;
  readonly label?: string | null;
}

export function resolvedDayConfigFromWire(w: WireResolvedDayConfig): ResolvedDayConfig {
  return {
    date: w.date,
    unitId: w.unitId,
    dayConfigurationId: w.dayConfigurationId,
    key: w.key as DayConfiguration['key'],
    ...(w.label ? { label: w.label } : {}),
  };
}

// ---------------------------------------------------------------------------
// Draft session / draft change
// ---------------------------------------------------------------------------

interface WireDraftSession {
  readonly id: string;
  readonly editorPersonId: string;
  readonly unitId: string;
  readonly rangeFrom: IsoDate;
  readonly rangeTo: IsoDate;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function draftSessionFromWire(w: WireDraftSession): DraftSession {
  return {
    id: w.id,
    editorPersonId: w.editorPersonId,
    unitId: w.unitId,
    range: { from: w.rangeFrom, to: w.rangeTo },
    status: camelToUpperSnake(w.status),
    createdAt: instantFromWire(w.createdAt),
    updatedAt: instantFromWire(w.updatedAt),
  };
}

interface WireDraftChange {
  readonly id: string;
  readonly draftSessionId: string;
  readonly seq: number;
  readonly at: string;
  readonly targetType: string;
  readonly op: string;
  readonly beforeJson?: string | null;
  readonly afterJson?: string | null;
}

export function draftChangeFromWire(w: WireDraftChange): DraftChange {
  const targetType = camelToUpperSnake<DraftTargetType>(w.targetType);
  const at = instantFromWire(w.at);
  const before = w.beforeJson ? (JSON.parse(w.beforeJson) as unknown) : null;
  const after = w.afterJson ? (JSON.parse(w.afterJson) as unknown) : null;

  switch (targetType) {
    case 'ASSIGNMENT':
      return {
        id: w.id,
        seq: w.seq,
        at,
        targetType,
        op: camelToUpperSnake<DraftOp>(w.op),
        before: before ? assignmentFromWire(before as never) : null,
        after: after ? assignmentFromWire(after as never) : null,
      };
    case 'ABSENCE':
      return {
        id: w.id,
        seq: w.seq,
        at,
        targetType,
        op: camelToUpperSnake<DraftOp>(w.op),
        before: before ? absenceFromWire(before as never) : null,
        after: after ? absenceFromWire(after as never) : null,
      };
    default:
      return {
        id: w.id,
        seq: w.seq,
        at,
        targetType: 'COMP_DAY',
        op: camelToUpperSnake<DraftOp>(w.op),
        before: before ? compDayFromWire(before as never) : null,
        after: after ? compDayFromWire(after as never) : null,
      };
  }
}

/** For `POST /api/drafts/{id}/changes`: `entityId` + wire-shaped `after`/`before`. */
/**
 * Тело одного элемента `POST /api/drafts/{id}/changes/sync`.
 *
 * Ни `op`, ни `entityId` здесь нет намеренно: операцию выводит сервер, сверяя
 * ключ с опубликованными данными, а локально придуманный id назначения ему не
 * нужен — он подставит свой, если в ячейке уже лежит опубликованная строка.
 */
export function syncItemToWireBody(item: {
  readonly targetType: DraftChange['targetType'];
  readonly key: string;
  readonly after: Assignment | Absence | CompDayEntry | null;
}): {
  readonly targetType: string;
  readonly key: string;
  readonly after: unknown;
} {
  const after =
    item.after === null
      ? null
      : item.targetType === 'ASSIGNMENT'
        ? assignmentToWire(item.after as Assignment)
        : item.targetType === 'ABSENCE'
          ? absenceToWire(item.after as Absence)
          : compDayToWire(item.after as CompDayEntry);

  return { targetType: upperSnakeToCamel(item.targetType), key: item.key, after };
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

interface WirePublishSuccess {
  readonly remainingGaps: number;
  readonly history: readonly WireAssignmentHistoryEntry[];
  readonly generatedCompDays: readonly WireCompDayEntry[];
}

interface WireConflictDetail {
  readonly changeId: string;
  readonly targetType: string;
  readonly entityId: string;
  readonly reason: string;
}

/**
 * The backend's `ConflictDetail` carries only an `entityId`, not full
 * before/after snapshots (see `DraftService.ConflictDetail`) — `published`
 * and `draft` come back `null`. `ReviewDialog.tsx` only ever renders
 * `conflict.reason`/`conflict.changeId`, so this loses nothing the UI uses
 * today; a fuller diff would need an extra round trip per conflict.
 */
export function publishConflictFromWire(w: WireConflictDetail): PublishConflict {
  return {
    changeId: w.changeId,
    targetType: camelToUpperSnake<DraftTargetType>(w.targetType),
    published: null,
    draft: null,
    reason: w.reason,
  };
}

/**
 * `created`/`updated`/`deleted` aren't in the publish response (the backend
 * only returns `remainingGaps`/`history`/`generatedCompDays`) — derived here
 * from the change list the caller already has (mirrors what
 * `MemoryScheduleRepository.publishDraft` used to compute).
 */
export function publishResultFromWire(
  w: WirePublishSuccess,
  changes: readonly DraftChange[],
): PublishResult {
  let created = 0;
  let updated = 0;
  let deleted = 0;
  for (const change of changes) {
    if (change.targetType !== 'ASSIGNMENT') continue;
    if (change.op === 'CREATE') created += 1;
    else if (change.op === 'UPDATE') updated += 1;
    else if (change.op === 'DELETE') deleted += 1;
  }
  return {
    created,
    updated,
    deleted,
    compDaysGenerated: w.generatedCompDays.length,
    remainingGaps: w.remainingGaps,
  };
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

interface WireAssignmentHistoryEntry {
  readonly id: string;
  readonly assignmentId: string;
  readonly action: string;
  readonly snapshotJson?: string | null;
  readonly actorId: string;
  readonly at: string;
}

export function historyEntryFromWire(w: WireAssignmentHistoryEntry): AssignmentHistoryEntry {
  return {
    id: w.id,
    assignmentId: w.assignmentId,
    action: camelToUpperSnake(w.action),
    snapshot: w.snapshotJson ? assignmentFromWire(JSON.parse(w.snapshotJson)) : null,
    actorId: w.actorId,
    at: instantFromWire(w.at),
  };
}
