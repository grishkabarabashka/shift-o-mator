/**
 * Агрегация уже посчитанных ячеек покрытия для интерфейса.
 *
 * Само покрытие теперь считает сервер (`GET /api/schedule`, Phase 5); эти
 * функции не решают, дыра это или нет, а только индексируют и суммируют
 * готовые `CoverageCell[]` для грида и полосы покрытия. Раньше жили в
 * `engine/coverage.ts` вместе с самим движком расчёта — тот файл удалён
 * вместе с портом на бэкенд.
 */

import type { CoverageCell, RoleId } from '../domain/types.ts';

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
