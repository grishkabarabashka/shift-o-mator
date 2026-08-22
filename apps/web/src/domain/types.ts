/**
 * NOTE: shift-o-mator domain model.
 *
 * Decisions live in Docs/adr/. Key ones for this file:
 *   Phase 8   Region removed; PlanningUnit is the single rule axis
 *   ADR-0001  a shift carries its own absolute time (unified Shift entity)
 *   ADR-0016  a day configuration carries a shift set, not just minimums
 *   ADR-0017  Absence is a range; the grid cell is a projection
 *   ADR-0015  drafts and publish
 *   ADR-0021  configuration is versioned by effective date
 *
 * This module depends on nothing but the standard library.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** NOTE: Calendar date, `YYYY-MM-DD`. Interpreted in the timezone given by context. */
export type IsoDate = string;

/** NOTE: A moment in UTC, ISO 8601 with a `Z` suffix. */
export type IsoInstant = string;

/** NOTE: Time of day `HH:mm`, no date, no timezone. */
export type TimeOfDay = string;

/** NOTE: IANA timezone identifier, e.g. `America/New_York`. */
export type IanaZone = string;

/** NOTE: ISO weekday: 1 = Monday, 7 = Sunday (Luxon's numbering). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const MONDAY = 1 as const;
export const FRIDAY = 5 as const;
export const SATURDAY = 6 as const;
export const SUNDAY = 7 as const;

export type LocationId = string;
export type UnitId = string;

/**
 * NOTE: Pseudo-unit "all": no unit filter applied.
 *
 * A planning unit is a default filter, not a boundary (ADR-0020), and the
 * default should be "see everyone". The team is small, and the question people
 * open this product for — "are we covered globally" — can't be answered one
 * unit at a time. Picking a specific unit narrows the list; it does not gate
 * access.
 */
export const ALL_UNITS: UnitId = 'ALL';
export type ShiftId = string;
export type PersonId = string;
export type AssignmentId = string;
export type AbsenceId = string;
export type CompDayEntryId = string;
export type DayConfigId = string;
export type DraftSessionId = string;

/** NOTE: Half-open time interval `[start, end)` in UTC. */
export interface UtcInterval {
  readonly start: IsoInstant;
  readonly end: IsoInstant;
}

/** NOTE: A period, both bounds inclusive. */
export interface DateRange {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

// ---------------------------------------------------------------------------
// Location and calendar
// ---------------------------------------------------------------------------

export type HolidayCalendarKey = string;

/**
 * NOTE: A location is responsible for exactly two things: the calendar of
 * non-working days and the display timezone. Nothing to do with shift timing.
 * Many-to-many with PlanningUnit — Pune hosts people from three different
 * units.
 */
export interface Location {
  readonly id: LocationId;
  readonly name: string;
  readonly country: string;
  readonly timeZone: IanaZone;
  readonly holidayCalendarKey: HolidayCalendarKey;
  readonly weekendDays: readonly Weekday[];
}

export interface Holiday {
  readonly id: string;
  readonly date: IsoDate;
  readonly name: string;
  readonly locationIds: readonly LocationId[];
  readonly isFullDay: boolean;
}

// ---------------------------------------------------------------------------
// Planning unit — the single rule axis
// ---------------------------------------------------------------------------

export type CompDayTrigger = 'SATURDAY' | 'SUNDAY' | 'HOLIDAY';

/**
 * NOTE: Comp-day policy. The date is chosen by searching a window, not by a
 * fixed offset, and comp days never expire — ADR-0007. Now belongs to the
 * unit (previously the region).
 */
export interface CompOffPolicy {
  readonly windowBeforeDays: number;
  readonly windowAfterDays: number;
  /** NOTE: Weekdays a comp day is never placed on. Mon and Fri by default. */
  readonly excludedWeekdays: readonly Weekday[];
  /** NOTE: Days after accrual before an untaken comp day is flagged. */
  readonly agingThresholdDays: number;
  readonly requiresApprovalWhenNoSlot: boolean;
}

export type UnitKind = 'REGION' | 'CROSS_REGION';

/** NOTE: What grid rows are grouped by within a unit. */
export type GroupBy = 'LOCATION' | 'REGION' | 'ORG_CATEGORY';

/**
 * NOTE: A planning unit is the single rule axis (Region removed, Phase 8): it
 * determines which shifts and day configurations apply, whose absence
 * calendar counts, and whose comp-day policy applies. A default filter for
 * the screen, not an access boundary.
 */
export interface PlanningUnit {
  readonly id: UnitId;
  readonly name: string;
  readonly kind: UnitKind;
  readonly groupBy: GroupBy;
  /** NOTE: Whose holiday calendar decides "is this a holiday for the roster". */
  readonly primaryLocationId: LocationId;
  readonly locationIds: readonly LocationId[];
  readonly compOffPolicy: CompOffPolicy;
}

// ---------------------------------------------------------------------------
// Shift
// ---------------------------------------------------------------------------

/**
 * NOTE: The single time entity: a shift carries an absolute window in a fixed
 * timezone (Phase 8 — merger of the former ShiftRole/ShiftDefinition).
 * Belongs to a planning unit; there is no global catalog.
 */
export interface Shift {
  readonly id: ShiftId;
  readonly unitId: UnitId;
  readonly code: string;
  readonly label: string;
  /** NOTE: Operational purpose of the shift: shown in the picker and settings. */
  readonly description?: string;
  readonly color: string;
  readonly hotkey?: string;
  readonly timeZone: IanaZone;
  readonly start: TimeOfDay;
  readonly end: TimeOfDay;
  readonly crossesMidnight: boolean;
  readonly breakMinutes: number;
  readonly countsAsCoverage: boolean;
  readonly editableTime: boolean;
}

// ---------------------------------------------------------------------------
// Day configuration
// ---------------------------------------------------------------------------

/**
 * NOTE: `date` is reserved for event-based configurations and not yet
 * implemented — ADR-0008. Resolution order: DATE → HOLIDAY → WEEKEND →
 * weekday group.
 */
export type DayConfigKey = 'weekday' | 'friday' | 'weekend' | 'holiday' | 'date';

export interface ShiftRequirement {
  readonly shiftId: ShiftId;
  /** NOTE: Hard requirement. Below this is a gap. Zero is a legal state
   * (ADR Phase 8): a unit can carry a shift with no coverage obligation. */
  readonly min: number;
  /** NOTE: Above this is a warning. `undefined` means no ceiling. */
  readonly max?: number;
  /** NOTE: Offered in the picker even without a requirement. */
  readonly isDefault: boolean;
  /** NOTE: The shift runs at a different time within this day group. */
  readonly timingOverride?: TimeOverride;
}

/**
 * NOTE: A group of days with its own shift set — ADR-0016. Versioned by
 * effective date: a rule raised today must not repaint last March
 * (ADR-0021).
 */
export interface DayConfiguration {
  readonly id: DayConfigId;
  readonly unitId: UnitId;
  readonly key: DayConfigKey;
  /** NOTE: For weekday groups. Each weekday belongs to exactly one group. */
  readonly weekdays: readonly Weekday[];
  /** NOTE: Only for `key === 'date'`. */
  readonly date?: IsoDate;
  readonly label?: string;
  readonly effectiveFrom: IsoDate;
  readonly shiftRequirements: readonly ShiftRequirement[];
}

// ---------------------------------------------------------------------------
// Person
// ---------------------------------------------------------------------------

export type OrgCategory = 'SUPPORT' | 'SERVICE_TRANSITION' | 'MANAGEMENT';

/**
 * NOTE: Shift eligibility carries a target share instead of a boolean flag —
 * ADR-0006. The share is the fairness metric; candidate ordering is computed
 * separately.
 */
export interface ShiftEligibility {
  readonly shiftId: ShiftId;
  readonly targetShare: number;
  readonly minPerWeek?: number;
  readonly maxPerWeek?: number;
}

export interface PersonConstraints {
  readonly minRestHours: number;
  readonly maxConsecutiveDays: number;
  readonly maxWeekendsPerQuarter?: number;
}

export interface PersonPreferences {
  readonly avoidsWeekdays?: readonly Weekday[];
  readonly preferredPartnerIds?: readonly PersonId[];
  readonly blackoutDates?: readonly IsoDate[];
  readonly note?: string;
}

/**
 * NOTE: There is no separate "work pattern" entity — ADR-0005. `defaultShiftId`
 * and `availableWeekdays` are read only by auto-populate. `defaultShiftId` is
 * now the only shift field on a person (Phase 8 removed the parallel
 * `ShiftDefinition`/`defaultRoleId`): the same shift code serves both
 * coverage and roster context.
 */
export interface Person {
  readonly id: PersonId;
  readonly displayName: string;
  readonly initials: string;
  readonly employeeId?: string;
  /** NOTE: Whose rules apply and whose screen this person is planned on. */
  readonly unitId: UnitId;
  readonly locationId: LocationId;
  readonly orgCategory: OrgCategory;
  readonly isActive: boolean;
  /** NOTE: Whether this person is planned at all. Managers: false. */
  readonly isIncluded: boolean;
  readonly eligibility: readonly ShiftEligibility[];
  readonly availableWeekdays: readonly Weekday[];
  readonly defaultShiftId?: ShiftId;
  readonly weekendEligible: boolean;
  readonly constraints: PersonConstraints;
  readonly preferences?: PersonPreferences;
  readonly calendarToken: string;
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export type AssignmentSource = 'MANUAL' | 'GENERATED' | 'IMPORTED';

/** NOTE: A one-off override of a shift's time. */
export interface TimeOverride {
  readonly start: TimeOfDay;
  readonly end: TimeOfDay;
  readonly crossesMidnight: boolean;
}

/** NOTE: `OFF` is a scheduled day off (`Off`/`W-Off`). `NOT_SCHEDULED` is `0`. */
export type RosterMarker = 'OFF' | 'NOT_SCHEDULED';

export type AssignmentContent =
  | { readonly kind: 'SHIFT'; readonly shiftId: ShiftId; readonly timeOverride?: TimeOverride }
  | { readonly kind: 'MARKER'; readonly marker: RosterMarker };

/**
 * NOTE: Exactly one assignment per (person, date) — a hard constraint.
 * On-call is an ordinary shift code occupying the day, not a parallel duty.
 *
 * `date` is the shift's local date in its own timezone: this removes
 * ambiguity for shifts crossing midnight.
 */
export interface Assignment {
  readonly id: AssignmentId;
  readonly personId: PersonId;
  readonly date: IsoDate;
  /** NOTE: Denormalized from the person's unit at the time of the write. */
  readonly unitId: UnitId;
  readonly content: AssignmentContent;
  /** NOTE: Whether it's a weekend by the person's location calendar. */
  readonly isWeekend: boolean;
  readonly note?: string;
  readonly source: AssignmentSource;
  /** NOTE: Optimistic-locking token. */
  readonly version: number;
  readonly createdBy: PersonId;
  readonly createdAt: IsoInstant;
  readonly updatedBy?: PersonId;
  readonly updatedAt?: IsoInstant;
}

export function assignmentShiftId(assignment: Assignment): ShiftId | undefined {
  return assignment.content.kind === 'SHIFT' ? assignment.content.shiftId : undefined;
}

export function isWorkingAssignment(assignment: Assignment): boolean {
  return assignment.content.kind === 'SHIFT';
}

// ---------------------------------------------------------------------------
// Absence
// ---------------------------------------------------------------------------

/**
 * NOTE: Training is not included here: in-hours training is the `Cover`
 * shift — the person is at work and counts toward coverage (ADR-0017).
 */
export type AbsenceType = 'VACATION' | 'SICK' | 'OTHER';

export type AbsenceSource = 'IMPORT' | 'MANUAL';

/** NOTE: Leave is a range, and the range is the source of truth (ADR-0017). */
export interface Absence {
  readonly id: AbsenceId;
  readonly personId: PersonId;
  readonly type: AbsenceType;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly source: AbsenceSource;
  readonly importBatchId?: string;
  /** NOTE: For detecting records that dropped out of the latest export. */
  readonly lastSeenInImportAt?: IsoInstant;
  readonly syncedToHrAt?: IsoInstant;
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Comp day
// ---------------------------------------------------------------------------

/** NOTE: There is no terminal "expired" status: comp days never expire (ADR-0007). */
export type CompDayStatus =
  | 'PROPOSED'
  | 'SCHEDULED'
  | 'TAKEN'
  | 'DECLINED'
  | 'PENDING_APPROVAL';

export interface CompDayEntry {
  readonly id: CompDayEntryId;
  readonly personId: PersonId;
  readonly earnedForAssignmentId: AssignmentId;
  readonly earnedForDate: IsoDate;
  readonly trigger: CompDayTrigger;
  /** NOTE: Earliest free eligible date within the policy window. */
  readonly proposedDate?: IsoDate;
  readonly actualDate?: IsoDate;
  readonly status: CompDayStatus;
  readonly syncedToHrAt?: IsoInstant;
}

/** NOTE: The date the comp day actually falls on. */
export function effectiveCompDayDate(entry: CompDayEntry): IsoDate | undefined {
  return entry.actualDate ?? entry.proposedDate;
}

/** NOTE: Whether this comp day blocks an assignment. `PROPOSED` is only a system suggestion. */
export function compDayBlocksAssignment(entry: CompDayEntry): boolean {
  return entry.status === 'SCHEDULED' || entry.status === 'TAKEN';
}

/** NOTE: Whether the comp day is still outstanding: neither taken nor declined. */
export function compDayIsOutstanding(entry: CompDayEntry): boolean {
  return (
    entry.status === 'PROPOSED' ||
    entry.status === 'SCHEDULED' ||
    entry.status === 'PENDING_APPROVAL'
  );
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * NOTE: `THIN` means the minimum is met with no margin. A distinct state, not
 * a shade of green: it's the most actionable signal for the planner.
 * `min = 0` always yields `OK` — a legal "no coverage obligation" (Service
 * Transition), never `GAP`/`THIN`.
 */
export type CoverageLevel = 'GAP' | 'THIN' | 'OK' | 'OVER';

export interface CoverageCell {
  readonly date: IsoDate;
  readonly unitId: UnitId;
  readonly shiftId: ShiftId;
  readonly actual: number;
  readonly min: number;
  readonly max?: number;
  readonly level: CoverageLevel;
  readonly appliedKey: DayConfigKey;
  readonly ruleLabel?: string;
}

export interface CoverageSnapshot {
  readonly date: IsoDate;
  readonly unitId: UnitId;
  readonly cells: readonly CoverageCell[];
  readonly headcount: number;
  readonly totalRequired: number;
  readonly totalFilled: number;
}

// ---------------------------------------------------------------------------
// Concurrent-absence limits
// ---------------------------------------------------------------------------

export type AbsenceCapacityScope =
  | { readonly kind: 'UNIT' }
  | { readonly kind: 'SHIFT_POOL'; readonly shiftId: ShiftId };

export type AbsenceDurationBucket = 'SHORT' | 'LONG';

/** NOTE: A shift-pool limit outranks the overall one — ADR-0010. */
export interface AbsenceCapacityRule {
  readonly id: string;
  readonly unitId: UnitId;
  readonly scope: AbsenceCapacityScope;
  readonly durationBucket: AbsenceDurationBucket;
  readonly longThresholdWorkdays: number;
  readonly maxConcurrent: number;
  readonly countsTypes: readonly AbsenceType[];
  /** NOTE: Whether confirmed comp days count the same as leave. */
  readonly countsCompDays: boolean;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type IssueLevel = 'BLOCKING' | 'WARNING' | 'INFO';

/**
 * NOTE: A gap is work not done. A conflict is impossible data recorded.
 * They're fixed differently and are never mixed in the UI.
 */
export type IssueCategory = 'GAP' | 'CONFLICT' | 'FAIRNESS' | 'POLICY';

export type IssueCode =
  | 'COVERAGE_GAP'
  | 'COVERAGE_THIN'
  | 'COVERAGE_OVER_MAX'
  | 'ASSIGNED_DURING_ABSENCE'
  | 'ASSIGNED_DURING_COMP_DAY'
  | 'DOUBLE_ASSIGNMENT'
  | 'SHIFT_NOT_ELIGIBLE'
  | 'SHIFT_OUTSIDE_REGION'
  | 'SHIFT_NOT_IN_DAY_CONFIG'
  | 'ABSENCE_CAPACITY_EXCEEDED'
  | 'MIN_REST_VIOLATED'
  | 'CONSECUTIVE_DAYS_EXCEEDED'
  | 'WEEKEND_LOAD_EXCEEDED'
  | 'UNAVAILABLE_WEEKDAY'
  | 'PREFERENCE_VIOLATED'
  | 'TARGET_SHARE_DEVIATION'
  | 'COMP_DAY_AGING'
  | 'COMP_DAY_PENDING_APPROVAL';

export interface Issue {
  /** NOTE: Stable across recomputation: acknowledgements are looked up by this. */
  readonly key: string;
  readonly level: IssueLevel;
  readonly category: IssueCategory;
  readonly code: IssueCode;
  readonly message: string;
  readonly unitId: UnitId;
  readonly date?: IsoDate;
  readonly personId?: PersonId;
  readonly shiftId?: ShiftId;
}

/** NOTE: A deliberate acknowledgement of a WARNING. Stored alongside the plan. */
export interface Acknowledgement {
  readonly issueKey: string;
  readonly comment: string;
  readonly byPersonId: PersonId;
  readonly at: IsoInstant;
}

// ---------------------------------------------------------------------------
// Draft and publish
// ---------------------------------------------------------------------------

export type DraftStatus = 'OPEN' | 'PUBLISHED' | 'DISCARDED';

export interface DraftSession {
  readonly id: DraftSessionId;
  readonly editorPersonId: PersonId;
  readonly unitId: UnitId;
  readonly range: DateRange;
  readonly status: DraftStatus;
  readonly createdAt: IsoInstant;
  readonly updatedAt: IsoInstant;
}

export type DraftOp = 'CREATE' | 'UPDATE' | 'DELETE';
export type DraftTargetType = 'ASSIGNMENT' | 'ABSENCE' | 'COMP_DAY';

/**
 * NOTE: Every change carries both the previous and the new value — this is
 * what makes undo/redo and the publish-conflict comparison screen possible.
 */
export type DraftChange =
  | {
      readonly id: string;
      readonly seq: number;
      readonly at: IsoInstant;
      readonly targetType: 'ASSIGNMENT';
      readonly op: DraftOp;
      readonly before: Assignment | null;
      readonly after: Assignment | null;
    }
  | {
      readonly id: string;
      readonly seq: number;
      readonly at: IsoInstant;
      readonly targetType: 'ABSENCE';
      readonly op: DraftOp;
      readonly before: Absence | null;
      readonly after: Absence | null;
    }
  | {
      readonly id: string;
      readonly seq: number;
      readonly at: IsoInstant;
      readonly targetType: 'COMP_DAY';
      readonly op: DraftOp;
      readonly before: CompDayEntry | null;
      readonly after: CompDayEntry | null;
    };

export interface PublishResult {
  readonly created: number;
  readonly updated: number;
  readonly deleted: number;
  readonly compDaysGenerated: number;
  readonly remainingGaps: number;
}

/**
 * NOTE: A mismatch between the published state and the draft due to a stale
 * version.
 *
 * Only `ASSIGNMENT` is versioned today (ADR-0015 detectConflicts), but the
 * type is deliberately wider — absence/comp-day conflicts will appear from
 * the backend without another edit to this interface.
 */
export interface PublishConflict {
  readonly changeId: string;
  readonly targetType: DraftTargetType;
  readonly published: Assignment | Absence | CompDayEntry | null;
  readonly draft: Assignment | Absence | CompDayEntry | null;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type HistoryAction = 'CREATED' | 'UPDATED' | 'DELETED';

/** NOTE: Append-only. The only control where there's no access boundary. */
export interface AssignmentHistoryEntry {
  readonly id: string;
  readonly assignmentId: AssignmentId;
  readonly action: HistoryAction;
  readonly snapshot: Assignment | null;
  readonly actorId: PersonId;
  readonly at: IsoInstant;
}

// ---------------------------------------------------------------------------
// Cell projection
// ---------------------------------------------------------------------------

export type CellStatus =
  | 'OFF'
  | 'NOT_SCHEDULED'
  | 'PH'
  | 'COMP_OFF'
  | 'VACATION'
  | 'SICK'
  | 'OTHER';

/**
 * NOTE: What the grid shows for a (person, date) pair. Precedence is
 * resolved in exactly one place — `engine/cellValue.ts` — and nowhere else.
 */
export type CellValue =
  | {
      readonly kind: 'SHIFT';
      readonly shiftId: ShiftId;
      readonly assignmentId: AssignmentId;
      /** NOTE: A proposed, not-yet-confirmed comp day on this date. */
      readonly proposedCompDay?: CompDayEntryId;
      /** NOTE: An assignment on top of an absence, comp day, or holiday. */
      readonly conflict?: CellConflict;
    }
  | {
      readonly kind: 'STATUS';
      readonly status: CellStatus;
      readonly absenceId?: AbsenceId;
      readonly compDayId?: CompDayEntryId;
      readonly assignmentId?: AssignmentId;
    }
  | {
      readonly kind: 'EMPTY';
      readonly proposedCompDay?: CompDayEntryId;
    };

export type CellConflict = 'ABSENCE' | 'COMP_DAY' | 'HOLIDAY';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** NOTE: Reference data: changed in settings, not while planning. */
export interface ReferenceData {
  readonly locations: readonly Location[];
  readonly holidays: readonly Holiday[];
  readonly units: readonly PlanningUnit[];
  readonly shifts: readonly Shift[];
  readonly dayConfigurations: readonly DayConfiguration[];
  readonly people: readonly Person[];
  readonly absenceCapacityRules: readonly AbsenceCapacityRule[];
}

/** NOTE: The published plan: what everyone sees. */
export interface PlanData {
  readonly assignments: readonly Assignment[];
  readonly absences: readonly Absence[];
  readonly compDays: readonly CompDayEntry[];
  readonly acknowledgements: readonly Acknowledgement[];
}

export interface ScheduleDataset extends ReferenceData, PlanData {
  readonly history: readonly AssignmentHistoryEntry[];
}
