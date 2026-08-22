/**
 * Производные данные экрана планирования.
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
 * Два масштаба намеренно разделены (ADR-0020): **строки** берутся из единицы
 * планирования, **покрытие** — из региона. Дыра по роли чужой единицы должна
 * быть видна и починена без ухода с экрана.
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
  Region,
  RegionId,
  RoleId,
  ShiftRole,
} from '../../domain/types.ts';
import { ALL_UNITS } from '../../domain/types.ts';
import type { CellProjection } from '../../engine/cellValue.ts';
import { projectCells } from '../../engine/cellValue.ts';
import { indexCoverage, summarizeCoverage } from '../../engine/coverageView.ts';
import { eachDate, holidayNameIn, isNonWorkingDayIn } from '../../engine/dates.ts';
import { summarizeIssues } from '../../engine/issues.ts';
import { useSchedule } from '../../store/useSchedule.ts';

/** Строка сетки: либо заголовок группы, либо человек. */
export type GridRow =
  | { readonly kind: 'group'; readonly key: string; readonly label: string; readonly count: number }
  | {
      readonly kind: 'person';
      readonly key: string;
      readonly person: Person;
      readonly location: Location;
      readonly region: Region;
    };

export interface DayColumn {
  readonly date: IsoDate;
  readonly weekdayLabel: string;
  readonly dayLabel: string;
  /** Нерабочий по календарю первичной локации региона. */
  readonly isNonWorking: boolean;
  readonly isToday: boolean;
  readonly holidayName: string | undefined;
  readonly configKey: DayConfiguration['key'] | undefined;
}

export interface PlanningView {
  readonly ready: boolean;
  readonly rows: readonly GridRow[];
  readonly columns: readonly DayColumn[];
  /** Регионы, попадающие в текущий вид. Обычно один. */
  readonly regionIds: readonly RegionId[];
  readonly projection: CellProjection;
  readonly coverageCells: readonly CoverageCell[];
  readonly coverageByCell: ReadonlyMap<string, CoverageCell>;
  readonly coverageSummary: ReturnType<typeof summarizeCoverage>;
  readonly coverageRoles: readonly ShiftRole[];
  readonly issues: readonly Issue[];
  readonly issuesByCell: ReadonlyMap<string, readonly Issue[]>;
  readonly acknowledged: ReadonlySet<string>;
  readonly issueSummary: ReturnType<typeof summarizeIssues>;
  /** Идёт ли ещё фоновая пересборка coverage/issues после правки (Phase 5 step 5). */
  readonly coverageStale: boolean;
  readonly cellAt: (personId: PersonId, date: IsoDate) => CellValue;
  /** Роли, доступные человеку в этот день: конфигурация дня ∩ eligibility. */
  readonly rolesFor: (personId: PersonId, date: IsoDate) => readonly ShiftRole[];
  /**
   * Остальные роли региона человека — путь для осознанного отступления от
   * правила (ADR-0024). Держатся отдельным списком, потому что основной
   * список пикера ценен именно тем, что короткий.
   */
  readonly otherRolesFor: (personId: PersonId, date: IsoDate) => readonly ShiftRole[];
  readonly roleById: (roleId: RoleId) => ShiftRole | undefined;
  readonly absenceById: (id: string) => Absence | undefined;
  readonly compDayById: (id: string) => CompDayEntry | undefined;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const EMPTY_PROJECTION: CellProjection = { byCell: new Map(), nonWorkingByCell: new Set() };

const EMPTY_VIEW: PlanningView = {
  ready: false,
  rows: [],
  columns: [],
  regionIds: [],
  projection: EMPTY_PROJECTION,
  coverageCells: [],
  coverageByCell: new Map(),
  coverageSummary: { gaps: 0, thin: 0, over: 0, total: 0 },
  coverageRoles: [],
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
  rolesFor: () => [],
  otherRolesFor: () => [],
  roleById: () => undefined,
  absenceById: () => undefined,
  compDayById: () => undefined,
};

export { cellKey };

/** Люди, попадающие в строки: единица планирования, либо все (ADR-0020). */
function selectPeople(unitId: string, index: DatasetIndex): Person[] {
  // `ALL` — не единица, а её отсутствие: фильтра нет (ADR-0020).
  if (unitId === ALL_UNITS) {
    return [...index.people.values()].filter((p) => p.isIncluded);
  }
  return (index.peopleByUnit.get(unitId) ?? []).filter((p) => p.isIncluded);
}

function groupKeyOf(person: Person, groupBy: string, index: DatasetIndex): string {
  switch (groupBy) {
    case 'REGION':
      return index.regions.get(person.regionId)?.name ?? person.regionId;
    case 'ORG_CATEGORY':
      return person.orgCategory.replace('_', ' ');
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
    const unit = index.units.get(unitId);
    if (!unit && unitId !== ALL_UNITS) return EMPTY_VIEW;

    // Без фильтра по единице группировка идёт по региону: со всеми тремя
    // регионами сразу список локаций плоским становится нечитаем, а регион —
    // это то, по чему считается покрытие.
    const groupBy = unit?.groupBy ?? 'REGION';

    const dates = eachDate(range);
    const people = selectPeople(unitId, index);
    const regionIds = [...new Set(people.map((p) => p.regionId))].sort();

    // --- Строки ------------------------------------------------------------
    const byGroup = new Map<string, Person[]>();
    for (const person of people) {
      const key = groupKeyOf(person, groupBy, index);
      const bucket = byGroup.get(key);
      if (bucket) bucket.push(person);
      else byGroup.set(key, [person]);
    }

    const rows: GridRow[] = [];
    for (const groupLabel of [...byGroup.keys()].sort()) {
      const members = [...(byGroup.get(groupLabel) ?? [])].sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      );
      rows.push({
        kind: 'group',
        key: `g-${groupLabel}`,
        label: groupLabel,
        count: members.length,
      });
      for (const person of members) {
        const location = index.locations.get(person.locationId);
        const region = index.regions.get(person.regionId);
        if (!location || !region) continue;
        rows.push({ kind: 'person', key: person.id, person, location, region });
      }
    }

    // --- Резолв конфигурации дня (сервер) -----------------------------------
    // `GET /api/schedule` несёт только id/key/label резолвнутой конфигурации на
    // дату — полный список ролей (`roleRequirements`) остаётся в справочнике
    // (`reference.dayConfigurations`), сервер лишь говорит, какая версия
    // применяется на эту дату (ADR-0021).
    const dayConfigById = new Map(reference.dayConfigurations.map((c) => [c.id, c]));
    const resolvedByRegionDate = new Map<string, (typeof schedule.dayConfigurations)[number]>();
    for (const resolved of schedule.dayConfigurations) {
      resolvedByRegionDate.set(`${resolved.regionId}|${resolved.date}`, resolved);
    }
    const resolveConfig = (regionId: RegionId, date: IsoDate): DayConfiguration | undefined => {
      const resolved = resolvedByRegionDate.get(`${regionId}|${date}`);
      return resolved ? dayConfigById.get(resolved.dayConfigurationId) : undefined;
    };

    // --- Колонки -----------------------------------------------------------
    // Тип дня берётся из первого региона в виде: при одном регионе это точно,
    // при нескольких заголовок всё равно показывает только выходные.
    const headerRegionId = regionIds[0];
    const headerRegion = headerRegionId ? index.regions.get(headerRegionId) : undefined;
    const headerLocation = headerRegion
      ? index.locations.get(headerRegion.primaryLocationId)
      : undefined;

    const columns: DayColumn[] = dates.map((date) => {
      const isoWeekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const config = headerRegionId ? resolveConfig(headerRegionId, date) : undefined;
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

    // --- Проекция ячеек (оптимистичная, из Zustand) -------------------------
    const projection = projectCells({
      range,
      absences: plan.absences,
      compDays: plan.compDays,
      index,
    });

    // --- Покрытие и нарушения: сервер ----------------------------------------
    const coverageCells = schedule.coverage;
    const issues = schedule.issues;

    const coverageRoles: ShiftRole[] = [];
    const seenRole = new Set<RoleId>();
    for (const cell of coverageCells) {
      if (seenRole.has(cell.roleId)) continue;
      seenRole.add(cell.roleId);
      const role = index.roles.get(cell.roleId);
      if (role) coverageRoles.push(role);
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

    // --- Доступные роли ----------------------------------------------------
    const rolesFor = (personId: PersonId, date: IsoDate): readonly ShiftRole[] => {
      const person = index.people.get(personId);
      if (!person) return [];
      const config = resolveConfig(person.regionId, date);
      if (!config) return [];
      const eligible = new Set(person.eligibility.map((e) => e.roleId));
      return config.roleRequirements
        .filter((requirement) => eligible.has(requirement.roleId))
        .map((requirement) => index.roles.get(requirement.roleId))
        .filter((role): role is ShiftRole => role !== undefined);
    };

    /** Всё остальное, что вообще существует в регионе человека. */
    const otherRolesFor = (personId: PersonId, date: IsoDate): readonly ShiftRole[] => {
      const person = index.people.get(personId);
      if (!person) return [];
      const shown = new Set(rolesFor(personId, date).map((role) => role.id));
      return (index.rolesByRegion.get(person.regionId) ?? []).filter(
        (role) => !shown.has(role.id) && role.countsAsCoverage,
      );
    };

    return {
      ready: true,
      rows,
      columns,
      regionIds,
      projection,
      coverageCells,
      coverageByCell: indexCoverage(coverageCells),
      coverageSummary: summarizeCoverage(coverageCells),
      coverageRoles,
      issues,
      issuesByCell,
      acknowledged,
      issueSummary: summarizeIssues(issues, acknowledged),
      coverageStale: scheduleQuery.isFetching,
      cellAt: (personId, date) =>
        projection.byCell.get(cellKey(personId, date)) ?? { kind: 'EMPTY' },
      rolesFor,
      otherRolesFor,
      roleById: (roleId) => index.roles.get(roleId),
      absenceById: (id) => plan.absences.find((absence) => absence.id === id),
      compDayById: (id) => plan.compDays.find((entry) => entry.id === id),
    };
  }, [unitId, range, reference, plan, index, asOf, schedule, scheduleQuery.isFetching]);
}
