/**
 * Расчёт покрытия: сколько человек фактически стоит на роли в каждый день
 * периода против требований. Результат — сетка `CoverageCell[]`, из которой
 * рисуется полоса под гридом.
 *
 * Правило с датой перекрывает праздничное, оно — выходное, оно — будничное
 * (ADR-0008). События вроде DR-теста описываются правилами с датой.
 */

import type { DatasetIndex } from '../domain/lookup.ts';
import type {
  Assignment,
  CoverageCell,
  CoverageLevel,
  CoverageRule,
  CoverageScope,
  DateRange,
  IsoDate,
  RoleId,
  UnitId,
} from '../domain/types.ts';
import { coverageDayKind, eachDate, rangeContains } from './dates.ts';

const SCOPE_PRIORITY: Record<CoverageScope, number> = {
  DATE: 3,
  HOLIDAY: 2,
  WEEKEND: 1,
  WEEKDAY: 0,
};

/**
 * Действующее правило для роли на конкретную дату.
 * Правила `HOLIDAY` и `WEEKEND` применимы только к соответствующему типу дня.
 */
export function resolveCoverageRule(
  rules: readonly CoverageRule[],
  roleId: RoleId,
  date: IsoDate,
  dayKind: Exclude<CoverageScope, 'DATE'>,
): CoverageRule | undefined {
  let best: CoverageRule | undefined;
  for (const rule of rules) {
    if (rule.roleId !== roleId) continue;
    const applicable =
      rule.appliesTo === 'DATE' ? rule.date === date : rule.appliesTo === dayKind;
    if (!applicable) continue;
    if (!best || SCOPE_PRIORITY[rule.appliesTo] > SCOPE_PRIORITY[best.appliesTo]) {
      best = rule;
    }
  }
  return best;
}

export function coverageLevel(
  actual: number,
  min: number,
  target?: number,
  max?: number,
): CoverageLevel {
  if (actual < min) return 'BELOW_MIN';
  if (max !== undefined && actual > max) return 'OVER_MAX';
  if (target !== undefined && actual < target) return 'BELOW_TARGET';
  return 'OK';
}

export interface CoverageParams {
  readonly unitId: UnitId;
  readonly range: DateRange;
  readonly assignments: readonly Assignment[];
  readonly coverageRules: readonly CoverageRule[];
  readonly index: DatasetIndex;
}

/**
 * Покрытие по всем ролям единицы за период.
 *
 * Клетки возвращаются только для пар (роль, день), у которых есть действующее
 * правило: если требования нет, показывать нечего.
 */
export function computeCoverage(params: CoverageParams): CoverageCell[] {
  const { unitId, range, assignments, coverageRules, index } = params;

  const unit = index.units.get(unitId);
  if (!unit) throw new Error(`Единица ${unitId} не найдена`);

  const unitRules = coverageRules.filter((rule) => rule.unitId === unitId);
  const unitRoles = (index.rolesByUnit.get(unitId) ?? []).filter((r) => r.countsAsCoverage);

  // Факт: (дата, роль) → число назначенных.
  const actualBy = new Map<string, number>();
  for (const assignment of assignments) {
    if (!rangeContains(range, assignment.date)) continue;
    const role = index.roles.get(assignment.roleId);
    if (!role || role.unitId !== unitId || !role.countsAsCoverage) continue;
    const key = `${assignment.date}|${assignment.roleId}`;
    actualBy.set(key, (actualBy.get(key) ?? 0) + 1);
  }

  const cells: CoverageCell[] = [];
  for (const date of eachDate(range)) {
    const dayKind = coverageDayKind(date, unit, index);
    for (const role of unitRoles) {
      const rule = resolveCoverageRule(unitRules, role.id, date, dayKind);
      if (!rule) continue;
      const actual = actualBy.get(`${date}|${role.id}`) ?? 0;
      cells.push({
        date,
        roleId: role.id,
        actual,
        min: rule.min,
        ...(rule.target !== undefined ? { target: rule.target } : {}),
        ...(rule.max !== undefined ? { max: rule.max } : {}),
        level: coverageLevel(actual, rule.min, rule.target, rule.max),
        ...(rule.label !== undefined ? { ruleLabel: rule.label } : {}),
        appliedScope: rule.appliesTo,
      });
    }
  }

  return cells;
}

/** Сводка по периоду для шапки: сколько дыр и сколько недоборов до цели. */
export interface CoverageSummary {
  readonly belowMin: number;
  readonly belowTarget: number;
  readonly overMax: number;
  readonly total: number;
}

export function summarizeCoverage(cells: readonly CoverageCell[]): CoverageSummary {
  let belowMin = 0;
  let belowTarget = 0;
  let overMax = 0;
  for (const cell of cells) {
    if (cell.level === 'BELOW_MIN') belowMin += 1;
    else if (cell.level === 'BELOW_TARGET') belowTarget += 1;
    else if (cell.level === 'OVER_MAX') overMax += 1;
  }
  return { belowMin, belowTarget, overMax, total: cells.length };
}

/** Индекс клеток для быстрого доступа из грида: `date|roleId`. */
export function indexCoverage(cells: readonly CoverageCell[]): Map<string, CoverageCell> {
  const map = new Map<string, CoverageCell>();
  for (const cell of cells) map.set(`${cell.date}|${cell.roleId}`, cell);
  return map;
}
