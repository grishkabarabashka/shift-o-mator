/**
 * NOTE: Derived data for the planning screen.
 *
 * Coverage, issues and resolved day configurations are server-computed now
 * (Phase 5 — `dayConfig`/`coverage`/`validate` engines deleted, ported to
 * `ShiftOMator.Application`): this hook reads them off `GET /api/schedule`
 * (`useScheduleQuery`) instead of recomputing them locally. The grid's cell
 * contents (`projection`/`cellAt`/rows) still come from the Zustand store's
 * `plan` (published + locally-applied draft changes) — that stays instant and
 * optimistic on purpose (Phase 5 step 5): a planner painting a range can't
 * wait on a round trip per keystroke.
 *
 * The schedule query is opened with the current draft session's id when one
 * is open, so coverage/issues reflect uncommitted edits the same way they did
 * when computed locally — the server already supports this exactly for that
 * reason ("GET /api/schedule taking draftId ... without publishing anything").
 *
 * Phase 8 deleted `Region`: planning unit is the single axis now (rows *and*
 * coverage both scope by unit, no separate region resolution step).
 * `groupBy: 'REGION'` survives in the wire enum but has no seed data using it
 * (`Person` no longer carries a region) — it falls back to grouping by
 * location here rather than being a dead branch that throws.
 */

import { useMemo } from 'react';
import { useScheduleQuery } from '../../api/queries.ts';
import { cellKey, type DatasetIndex } from '../../domain/lookup.ts';
import type {
  Absence,
  CellValue,
  CompDayEntry,
  CoverageCell,
  DayConfiguration,
  IsoDate,
  Issue,
  Location,
  Person,
  PersonId,
  PlanningUnit,
  Shift,
  ShiftId,
  UnitId,
} from '../../domain/types.ts';
import { isAllUnits, unitsInScope } from '../../domain/unitScope.ts';
import type { CellProjection } from '../../engine/cellValue.ts';
import { projectCells } from '../../engine/cellValue.ts';
import { indexCoverage, summarizeCoverage } from '../../engine/coverageView.ts';
import { eachDate, holidayNameIn, isNonWorkingDayIn } from '../../engine/dates.ts';
import { summarizeIssues } from '../../engine/issues.ts';
import { useSchedule } from '../../store/useSchedule.ts';

/** NOTE: A grid row is either a group header or a person. */
export type GridRow =
  | {
      readonly kind: 'group';
      readonly key: string;
      readonly label: string;
      readonly count: number;
      /**
       * NOTE: 1 = planning unit, 2 = grouping within it (location, category).
       * The level only appears when the screen shows more than one unit:
       * without it, Chicago and Pune from different units would sit in one
       * list with no way to tell which rules apply to which row.
       */
      readonly level: 1 | 2;
    }
  | {
      readonly kind: 'person';
      readonly key: string;
      readonly person: Person;
      readonly location: Location;
      readonly unit: PlanningUnit;
    };

export interface DayColumn {
  readonly date: IsoDate;
  readonly weekdayLabel: string;
  readonly dayLabel: string;
  /** NOTE: Non-working per the unit's primary location calendar. */
  readonly isNonWorking: boolean;
  readonly isToday: boolean;
  readonly holidayName: string | undefined;
  readonly configKey: DayConfiguration['key'] | undefined;
}

export interface PlanningView {
  readonly ready: boolean;
  readonly rows: readonly GridRow[];
  readonly columns: readonly DayColumn[];
  /** NOTE: Planning units included in the current view. Usually one. */
  readonly unitIds: readonly UnitId[];
  readonly projection: CellProjection;
  readonly coverageCells: readonly CoverageCell[];
  readonly coverageByCell: ReadonlyMap<string, CoverageCell>;
  readonly coverageSummary: ReturnType<typeof summarizeCoverage>;
  readonly coverageShifts: readonly Shift[];
  readonly issues: readonly Issue[];
  readonly issuesByCell: ReadonlyMap<string, readonly Issue[]>;
  readonly acknowledged: ReadonlySet<string>;
  readonly issueSummary: ReturnType<typeof summarizeIssues>;
  /** NOTE: Whether a background coverage/issues recompute after an edit is still in flight (Phase 5 step 5). */
  readonly coverageStale: boolean;
  readonly cellAt: (personId: PersonId, date: IsoDate) => CellValue;
  /** NOTE: Shifts available to the person on this day: day configuration ∩ eligibility. */
  readonly shiftsFor: (personId: PersonId, date: IsoDate) => readonly Shift[];
  /**
   * NOTE: The rest of the person's unit shifts — the path for a deliberate
   * departure from the rule (ADR-0024). Kept as a separate list because the
   * main picker list is valuable precisely for being short.
   */
  readonly otherShiftsFor: (personId: PersonId, date: IsoDate) => readonly Shift[];
  readonly shiftById: (shiftId: ShiftId) => Shift | undefined;
  readonly absenceById: (id: string) => Absence | undefined;
  readonly compDayById: (id: string) => CompDayEntry | undefined;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const EMPTY_PROJECTION: CellProjection = { byCell: new Map(), nonWorkingByCell: new Set() };

const EMPTY_VIEW: PlanningView = {
  ready: false,
  rows: [],
  columns: [],
  unitIds: [],
  projection: EMPTY_PROJECTION,
  coverageCells: [],
  coverageByCell: new Map(),
  coverageSummary: { gaps: 0, thin: 0, over: 0, total: 0 },
  coverageShifts: [],
  issues: [],
  issuesByCell: new Map(),
  acknowledged: new Set(),
  issueSummary: {
    blocking: 0,
    gaps: 0,
    conflicts: 0,
    warning: 0,
    info: 0,
    unacknowledgedWarnings: 0,
  },
  coverageStale: false,
  cellAt: () => ({ kind: 'EMPTY' }),
  shiftsFor: () => [],
  otherShiftsFor: () => [],
  shiftById: () => undefined,
  absenceById: () => undefined,
  compDayById: () => undefined,
};

export { cellKey };

/** NOTE: People included in the rows: the selected units, or all of them (ADR-0020). */
function selectPeople(scope: string, index: DatasetIndex): Person[] {
  // NOTE: `ALL` is not a unit but its absence: there is no filter (ADR-0020).
  if (isAllUnits(scope)) {
    return [...index.people.values()].filter((p) => p.isIncluded);
  }
  return unitsInScope(scope, [...index.units.keys()]).flatMap((unitId) =>
    (index.peopleByUnit.get(unitId) ?? []).filter((p) => p.isIncluded),
  );
}

function groupKeyOf(person: Person, groupBy: string, index: DatasetIndex): string {
  switch (groupBy) {
    case 'ORG_CATEGORY':
      return person.orgCategory.replace('_', ' ');
    // NOTE: 'REGION' survives as a wire enum value but has no data behind it
    // anymore — Person no longer carries a region. Fall back to location
    // instead of throwing on an unknown groupBy.
    case 'REGION':
    default:
      return index.locations.get(person.locationId)?.name ?? person.locationId;
  }
}

export function usePlanningView(asOf: IsoDate): PlanningView {
  const unitId = useSchedule((s) => s.unitId);
  const range = useSchedule((s) => s.range);
  const reference = useSchedule((s) => s.reference);
  const plan = useSchedule((s) => s.plan);
  const index = useSchedule((s) => s.index);
  const draftId = useSchedule((s) => s.session?.id);

  const scheduleQuery = useScheduleQuery(unitId, range, draftId);
  const schedule = scheduleQuery.data;

  return useMemo<PlanningView>(() => {
    if (!unitId || !range || !reference || !plan || !index || !schedule) return EMPTY_VIEW;
    // NOTE: A scope of one unit uses its own grouping; a scope of several (or
    // "all") has no grouping of its own for the combined view, so the unit
    // itself becomes the outer level (see row assembly below).
    const scopedUnitIds = unitsInScope(unitId, [...index.units.keys()]);
    const unit = scopedUnitIds.length === 1 ? index.units.get(scopedUnitIds[0] as UnitId) : undefined;
    if (scopedUnitIds.length === 0) return EMPTY_VIEW;

    const groupBy = unit?.groupBy ?? 'LOCATION';

    const dates = eachDate(range);
    const people = selectPeople(unitId, index);
    const unitIds = [...new Set(people.map((p) => p.unitId))].sort();

    // --- Rows ----------------------------------------------------------------
    //
    // NOTE: Planning unit is the outer level, and only when there is more than
    // one. With all units combined, the location list used to get mixed up:
    // Chicago (AMER) sat next to Chicago (ST), with no way to tell from the row
    // which rules applied — and rules attach to the unit (ADR-0032).
    const rows: GridRow[] = [];
    const byUnit = new Map<UnitId, Person[]>();
    for (const person of people) {
      const bucket = byUnit.get(person.unitId);
      if (bucket) bucket.push(person);
      else byUnit.set(person.unitId, [person]);
    }
    const multiUnit = byUnit.size > 1;

    const pushGroup = (people: readonly Person[], groupByForUnit: string, level: 1 | 2): void => {
      const byGroup = new Map<string, Person[]>();
      for (const person of people) {
        const key = groupKeyOf(person, groupByForUnit, index);
        const bucket = byGroup.get(key);
        if (bucket) bucket.push(person);
        else byGroup.set(key, [person]);
      }

      for (const groupLabel of [...byGroup.keys()].sort()) {
        const members = [...(byGroup.get(groupLabel) ?? [])].sort((a, b) =>
          a.displayName.localeCompare(b.displayName),
        );
        rows.push({
          kind: 'group',
          key: `g-${level}-${groupLabel}`,
          label: groupLabel,
          count: members.length,
          level,
        });
        for (const person of members) {
          const location = index.locations.get(person.locationId);
          const personUnit = index.units.get(person.unitId);
          if (!location || !personUnit) continue;
          rows.push({ kind: 'person', key: person.id, person, location, unit: personUnit });
        }
      }
    };

    if (multiUnit) {
      const unitOrder = [...byUnit.keys()].sort((a, b) =>
        (index.units.get(a)?.name ?? a).localeCompare(index.units.get(b)?.name ?? b),
      );
      for (const memberUnitId of unitOrder) {
        const members = byUnit.get(memberUnitId) ?? [];
        rows.push({
          kind: 'group',
          key: `u-${memberUnitId}`,
          label: index.units.get(memberUnitId)?.name ?? memberUnitId,
          count: members.length,
          level: 1,
        });
        // NOTE: Within a unit, its own grouping applies, not a shared one:
        // ST can differ from AMER, and that's its own rule.
        pushGroup(members, index.units.get(memberUnitId)?.groupBy ?? 'LOCATION', 2);
      }
    } else {
      pushGroup(people, groupBy, 1);
    }

    // --- Day configuration resolution (server) --------------------------------
    // NOTE: `GET /api/schedule` only carries the id/key/label of the resolved
    // configuration for a date — the full shift list (`shiftRequirements`)
    // stays in the reference data (`reference.dayConfigurations`); the server
    // just says which version applies on that date (ADR-0021).
    const dayConfigById = new Map(reference.dayConfigurations.map((c) => [c.id, c]));
    const resolvedByUnitDate = new Map<string, (typeof schedule.dayConfigurations)[number]>();
    for (const resolved of schedule.dayConfigurations) {
      resolvedByUnitDate.set(`${resolved.unitId}|${resolved.date}`, resolved);
    }
    const resolveConfig = (unitId: UnitId, date: IsoDate): DayConfiguration | undefined => {
      const resolved = resolvedByUnitDate.get(`${unitId}|${date}`);
      return resolved ? dayConfigById.get(resolved.dayConfigurationId) : undefined;
    };

    // --- Columns ---------------------------------------------------------------
    // NOTE: The day type is taken from the first unit in the view: with one
    // unit this is exact; with several, the header only shows weekends anyway.
    const headerUnitId = unitIds[0];
    const headerUnit = headerUnitId ? index.units.get(headerUnitId) : undefined;
    const headerLocation = headerUnit ? index.locations.get(headerUnit.primaryLocationId) : undefined;

    const columns: DayColumn[] = dates.map((date) => {
      const isoWeekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const config = headerUnitId ? resolveConfig(headerUnitId, date) : undefined;
      return {
        date,
        weekdayLabel: WEEKDAY_LABELS[isoWeekday === 0 ? 6 : isoWeekday - 1] ?? '',
        dayLabel: date.slice(8),
        isNonWorking: headerLocation ? isNonWorkingDayIn(date, headerLocation, index) : false,
        isToday: date === asOf,
        holidayName: headerLocation ? holidayNameIn(date, headerLocation, index) : undefined,
        configKey: config?.key,
      };
    });

    // --- Cell projection (optimistic, from Zustand) -----------------------------
    const projection = projectCells({
      range,
      absences: plan.absences,
      compDays: plan.compDays,
      index,
    });

    // --- Coverage and issues: server --------------------------------------------
    const coverageCells = schedule.coverage;
    const issues = schedule.issues;

    const coverageShifts: Shift[] = [];
    const seenShift = new Set<ShiftId>();
    for (const cell of coverageCells) {
      if (seenShift.has(cell.shiftId)) continue;
      seenShift.add(cell.shiftId);
      const shift = index.shifts.get(cell.shiftId);
      if (shift) coverageShifts.push(shift);
    }

    const issuesByCell = new Map<string, Issue[]>();
    for (const issue of issues) {
      if (!issue.personId || !issue.date) continue;
      const key = cellKey(issue.personId, issue.date);
      const bucket = issuesByCell.get(key);
      if (bucket) bucket.push(issue);
      else issuesByCell.set(key, [issue]);
    }

    const acknowledged = new Set(schedule.acknowledgedIssueKeys);

    // --- Available shifts --------------------------------------------------------
    const shiftsFor = (personId: PersonId, date: IsoDate): readonly Shift[] => {
      const person = index.people.get(personId);
      if (!person) return [];
      const config = resolveConfig(person.unitId, date);
      if (!config) return [];
      const eligible = new Set(person.eligibility.map((e) => e.shiftId));
      return config.shiftRequirements
        .filter((requirement) => eligible.has(requirement.shiftId))
        .map((requirement) => index.shifts.get(requirement.shiftId))
        .filter((shift): shift is Shift => shift !== undefined);
    };

    /** NOTE: Everything else that exists at all in the person's unit. */
    const otherShiftsFor = (personId: PersonId, date: IsoDate): readonly Shift[] => {
      const person = index.people.get(personId);
      if (!person) return [];
      const shown = new Set(shiftsFor(personId, date).map((shift) => shift.id));
      return (index.shiftsByUnit.get(person.unitId) ?? []).filter(
        (shift) => !shown.has(shift.id) && shift.countsAsCoverage,
      );
    };

    return {
      ready: true,
      rows,
      columns,
      unitIds,
      projection,
      coverageCells,
      coverageByCell: indexCoverage(coverageCells),
      coverageSummary: summarizeCoverage(coverageCells),
      coverageShifts,
      issues,
      issuesByCell,
      acknowledged,
      issueSummary: summarizeIssues(issues, acknowledged),
      coverageStale: scheduleQuery.isFetching,
      cellAt: (personId, date) =>
        projection.byCell.get(cellKey(personId, date)) ?? { kind: 'EMPTY' },
      shiftsFor,
      otherShiftsFor,
      shiftById: (shiftId) => index.shifts.get(shiftId),
      absenceById: (id) => plan.absences.find((absence) => absence.id === id),
      compDayById: (id) => plan.compDays.find((entry) => entry.id === id),
    };
  }, [unitId, range, reference, plan, index, asOf, schedule, scheduleQuery.isFetching]);
}
