/**
 * Расчёт покрытия: сколько человек фактически стоит на роли против требований
 * действующей на эту дату конфигурации дня.
 *
 * Покрытие считается **по региону**, а не по единице планирования (ADR-0020):
 * требование принадлежит региону, и дыру по `ST Amer` видно на полосе AMER,
 * даже если эти люди планируются в другой единице.
 */

import type { DatasetIndex } from '../domain/lookup.ts';
import type {
  Assignment,
  CoverageCell,
  CoverageLevel,
  CoverageSnapshot,
  DateRange,
  IsoDate,
  RegionId,
  RoleId,
} from '../domain/types.ts';
import { assignmentRoleId } from '../domain/types.ts';
import { resolveDayConfiguration } from './dayConfig.ts';
import { eachDate, rangeContains } from './dates.ts';

/**
 * `THIN` — минимум закрыт впритык. Отдельное состояние, а не оттенок зелёного:
 * «мы закрыты, но один больничный от провала» — самый действенный сигнал.
 */
export function coverageLevel(
  actual: number,
  min: number,
  max?: number,
): CoverageLevel {
  if (actual < min) return 'GAP';
  if (max !== undefined && actual > max) return 'OVER';
  if (min > 0 && actual === min) return 'THIN';
  return 'OK';
}

export interface CoverageParams {
  readonly regionId: RegionId;
  readonly range: DateRange;
  readonly assignments: readonly Assignment[];
  readonly index: DatasetIndex;
}

/**
 * Клетки возвращаются только для пар (роль, день) с действующим требованием:
 * если требования нет, показывать нечего.
 */
export function computeCoverage(params: CoverageParams): CoverageCell[] {
  const { regionId, range, assignments, index } = params;

  // Факт: (дата, роль) → число назначенных.
  const actualBy = new Map<string, number>();
  for (const assignment of assignments) {
    if (!rangeContains(range, assignment.date)) continue;
    if (assignment.regionId !== regionId) continue;
    const roleId = assignmentRoleId(assignment);
    if (roleId === undefined) continue;
    const role = index.roles.get(roleId);
    if (!role || !role.countsAsCoverage) continue;
    const key = `${assignment.date}|${roleId}`;
    actualBy.set(key, (actualBy.get(key) ?? 0) + 1);
  }

  const cells: CoverageCell[] = [];
  for (const date of eachDate(range)) {
    const config = resolveDayConfiguration(regionId, date, index);
    if (!config) continue;

    for (const requirement of config.roleRequirements) {
      const role = index.roles.get(requirement.roleId);
      if (!role || !role.countsAsCoverage) continue;
      const actual = actualBy.get(`${date}|${requirement.roleId}`) ?? 0;
      cells.push({
        date,
        regionId,
        roleId: requirement.roleId,
        actual,
        min: requirement.min,
        ...(requirement.max !== undefined ? { max: requirement.max } : {}),
        level: coverageLevel(actual, requirement.min, requirement.max),
        appliedKey: config.key,
        ...(config.label !== undefined ? { ruleLabel: config.label } : {}),
      });
    }
  }

  return cells;
}

/** Снимки по дням: агрегат для закреплённой строки покрытия под сеткой. */
export function snapshotsByDate(
  cells: readonly CoverageCell[],
  regionId: RegionId,
  headcountByDate: ReadonlyMap<IsoDate, number>,
): CoverageSnapshot[] {
  const byDate = new Map<IsoDate, CoverageCell[]>();
  for (const cell of cells) {
    const bucket = byDate.get(cell.date);
    if (bucket) bucket.push(cell);
    else byDate.set(cell.date, [cell]);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayCells]) => ({
      date,
      regionId,
      cells: dayCells,
      headcount: headcountByDate.get(date) ?? 0,
      totalRequired: dayCells.reduce((sum, cell) => sum + cell.min, 0),
      totalFilled: dayCells.reduce((sum, cell) => sum + cell.actual, 0),
    }));
}

export interface CoverageSummary {
  readonly gaps: number;
  readonly thin: number;
  readonly over: number;
  readonly total: number;
}

export function summarizeCoverage(cells: readonly CoverageCell[]): CoverageSummary {
  let gaps = 0;
  let thin = 0;
  let over = 0;
  for (const cell of cells) {
    if (cell.level === 'GAP') gaps += 1;
    else if (cell.level === 'THIN') thin += 1;
    else if (cell.level === 'OVER') over += 1;
  }
  return { gaps, thin, over, total: cells.length };
}

/** Индекс клеток для быстрого доступа из грида: `date|roleId`. */
export function indexCoverage(cells: readonly CoverageCell[]): Map<string, CoverageCell> {
  const map = new Map<string, CoverageCell>();
  for (const cell of cells) map.set(`${cell.date}|${cell.roleId}`, cell);
  return map;
}

/** Роли, встречающиеся в расчёте, в порядке первого появления. */
export function rolesInCoverage(cells: readonly CoverageCell[]): RoleId[] {
  const seen = new Set<RoleId>();
  const result: RoleId[] = [];
  for (const cell of cells) {
    if (seen.has(cell.roleId)) continue;
    seen.add(cell.roleId);
    result.push(cell.roleId);
  }
  return result;
}
