/**
 * Производные данные экрана планирования.
 *
 * Всё, что нужно сетке, полосе покрытия и панели нарушений, считается здесь
 * одним проходом и мемоизируется. Компоненты остаются тупыми.
 */

import { useMemo } from 'react';
import type {
  Absence,
  Assignment,
  CompDayEntry,
  CoverageCell,
  IsoDate,
  Issue,
  Location,
  Person,
  PersonId,
  ShiftRole,
} from '../../domain/types.ts';
import { effectiveCompDayDate } from '../../domain/types.ts';
import { computeCoverage, indexCoverage, summarizeCoverage } from '../../engine/coverage.ts';
import { eachDate, isNonWorkingDayIn, holidayNameIn } from '../../engine/dates.ts';
import { acknowledgedKeys, summarizeIssues, validate } from '../../engine/validate.ts';
import { useSchedule } from '../../store/useSchedule.ts';

/** Строка сетки: либо заголовок группы, либо человек. */
export type GridRow =
  | { readonly kind: 'group'; readonly key: string; readonly label: string }
  | { readonly kind: 'person'; readonly key: string; readonly person: Person; readonly location: Location };

export interface DayColumn {
  readonly date: IsoDate;
  readonly weekdayLabel: string;
  readonly dayLabel: string;
  /** Нерабочий по календарю референсной локации единицы. */
  readonly isNonWorking: boolean;
  readonly holidayName: string | undefined;
}

export interface PlanningView {
  readonly ready: boolean;
  readonly rows: readonly GridRow[];
  readonly columns: readonly DayColumn[];
  readonly roles: readonly ShiftRole[];
  readonly assignmentByCell: ReadonlyMap<string, Assignment>;
  readonly absenceByCell: ReadonlyMap<string, Absence>;
  readonly compDayByCell: ReadonlyMap<string, CompDayEntry>;
  readonly nonWorkingByCell: ReadonlySet<string>;
  readonly coverageCells: readonly CoverageCell[];
  readonly coverageByCell: ReadonlyMap<string, CoverageCell>;
  readonly coverageSummary: ReturnType<typeof summarizeCoverage>;
  readonly issues: readonly Issue[];
  readonly issuesByCell: ReadonlyMap<string, readonly Issue[]>;
  readonly acknowledged: ReadonlySet<string>;
  readonly issueSummary: ReturnType<typeof summarizeIssues>;
  readonly rolesFor: (personId: PersonId) => readonly ShiftRole[];
}

const WEEKDAY_LABELS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export function cellKey(personId: PersonId, date: IsoDate): string {
  return `${personId}|${date}`;
}

const EMPTY_VIEW: PlanningView = {
  ready: false,
  rows: [],
  columns: [],
  roles: [],
  assignmentByCell: new Map(),
  absenceByCell: new Map(),
  compDayByCell: new Map(),
  nonWorkingByCell: new Set(),
  coverageCells: [],
  coverageByCell: new Map(),
  coverageSummary: { belowMin: 0, belowTarget: 0, overMax: 0, total: 0 },
  issues: [],
  issuesByCell: new Map(),
  acknowledged: new Set(),
  issueSummary: { blocking: 0, warning: 0, info: 0, unacknowledgedWarnings: 0 },
  rolesFor: () => [],
};

export function usePlanningView(asOf: IsoDate): PlanningView {
  const unitId = useSchedule((s) => s.unitId);
  const range = useSchedule((s) => s.range);
  const reference = useSchedule((s) => s.reference);
  const plan = useSchedule((s) => s.plan);
  const index = useSchedule((s) => s.index);

  return useMemo<PlanningView>(() => {
    if (!unitId || !range || !reference || !plan || !index) return EMPTY_VIEW;

    const unit = index.units.get(unitId);
    if (!unit) return EMPTY_VIEW;

    const dates = eachDate(range);
    const roles = index.rolesByUnit.get(unitId) ?? [];
    const rolesById = index.roles;

    // --- Колонки -----------------------------------------------------------
    const coverageLocation = index.locations.get(unit.coverageCalendarLocationId);
    const columns: DayColumn[] = dates.map((date) => {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const isoWeekday = weekday === 0 ? 7 : weekday;
      return {
        date,
        weekdayLabel: WEEKDAY_LABELS[isoWeekday - 1] ?? '',
        dayLabel: date.slice(8),
        isNonWorking: coverageLocation
          ? isNonWorkingDayIn(date, coverageLocation, index)
          : false,
        holidayName: coverageLocation ? holidayNameIn(date, coverageLocation, index) : undefined,
      };
    });

    // --- Строки ------------------------------------------------------------
    const unitPeople = (index.peopleByUnit.get(unitId) ?? []).filter((p) => !p.isPlannerOnly);
    const byLocation = new Map<string, Person[]>();
    for (const person of unitPeople) {
      const bucket = byLocation.get(person.locationId);
      if (bucket) bucket.push(person);
      else byLocation.set(person.locationId, [person]);
    }

    const rows: GridRow[] = [];
    const locationOrder = [...byLocation.keys()].sort((a, b) =>
      (index.locations.get(a)?.name ?? a).localeCompare(index.locations.get(b)?.name ?? b),
    );
    for (const locationId of locationOrder) {
      const location = index.locations.get(locationId);
      if (!location) continue;
      rows.push({ kind: 'group', key: `g-${locationId}`, label: location.name });
      const members = [...(byLocation.get(locationId) ?? [])].sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      );
      for (const person of members) {
        rows.push({ kind: 'person', key: person.id, person, location });
      }
    }

    // --- Ячейки ------------------------------------------------------------
    const assignmentByCell = new Map<string, Assignment>();
    for (const assignment of plan.assignments) {
      assignmentByCell.set(cellKey(assignment.personId, assignment.date), assignment);
    }

    const absenceByCell = new Map<string, Absence>();
    for (const absence of plan.absences) {
      for (const date of eachDate({ from: absence.from, to: absence.to })) {
        if (date < range.from || date > range.to) continue;
        absenceByCell.set(cellKey(absence.personId, date), absence);
      }
    }

    const compDayByCell = new Map<string, CompDayEntry>();
    for (const entry of plan.compDays) {
      const date = effectiveCompDayDate(entry);
      if (date < range.from || date > range.to) continue;
      compDayByCell.set(cellKey(entry.personId, date), entry);
    }

    // Нерабочий день считается по календарю локации человека — от этого
    // зависит начисление отгула, и в сетке это должно быть видно.
    const nonWorkingByCell = new Set<string>();
    for (const row of rows) {
      if (row.kind !== 'person') continue;
      for (const date of dates) {
        if (isNonWorkingDayIn(date, row.location, index)) {
          nonWorkingByCell.add(cellKey(row.person.id, date));
        }
      }
    }

    // --- Покрытие и нарушения ---------------------------------------------
    const coverageCells = computeCoverage({
      unitId,
      range,
      assignments: plan.assignments,
      coverageRules: reference.coverageRules,
      index,
    });

    const issues = validate({
      unitId,
      range,
      assignments: plan.assignments,
      absences: plan.absences,
      compDays: plan.compDays,
      coverageCells,
      absenceCapacityRules: reference.absenceCapacityRules,
      index,
      asOf,
    });

    const issuesByCell = new Map<string, Issue[]>();
    for (const issue of issues) {
      if (!issue.personId || !issue.date) continue;
      const key = cellKey(issue.personId, issue.date);
      const bucket = issuesByCell.get(key);
      if (bucket) bucket.push(issue);
      else issuesByCell.set(key, [issue]);
    }

    const acknowledged = acknowledgedKeys(plan.acknowledgements);

    const rolesFor = (personId: PersonId): readonly ShiftRole[] => {
      const person = index.people.get(personId);
      if (!person) return [];
      return person.eligibility
        .map((e) => rolesById.get(e.roleId))
        .filter((role): role is ShiftRole => role !== undefined);
    };

    return {
      ready: true,
      rows,
      columns,
      roles,
      assignmentByCell,
      absenceByCell,
      compDayByCell,
      nonWorkingByCell,
      coverageCells,
      coverageByCell: indexCoverage(coverageCells),
      coverageSummary: summarizeCoverage(coverageCells),
      issues,
      issuesByCell,
      acknowledged,
      issueSummary: summarizeIssues(issues, acknowledged),
      rolesFor,
    };
  }, [unitId, range, reference, plan, index, asOf]);
}
