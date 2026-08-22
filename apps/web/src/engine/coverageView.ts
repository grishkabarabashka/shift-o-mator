/**
 * NOTE: Aggregation of already-computed coverage cells for the UI.
 *
 * Coverage itself is now computed server-side (`GET /api/schedule`, Phase
 * 5); these functions don't decide whether something is a gap, only index
 * and sum the finished `CoverageCell[]` for the grid and the coverage strip.
 * They used to live in `engine/coverage.ts` alongside the calculation engine
 * itself — that file was deleted along with the port to the backend.
 */

import type { CoverageCell, ShiftId } from '../domain/types.ts';

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

/** NOTE: Cell index for fast lookup from the grid: `date|shiftId`. */
export function indexCoverage(cells: readonly CoverageCell[]): Map<string, CoverageCell> {
  const map = new Map<string, CoverageCell>();
  for (const cell of cells) map.set(`${cell.date}|${cell.shiftId}`, cell);
  return map;
}

/** NOTE: Shifts appearing in the calculation, in order of first occurrence. */
export function shiftsInCoverage(cells: readonly CoverageCell[]): ShiftId[] {
  const seen = new Set<ShiftId>();
  const result: ShiftId[] = [];
  for (const cell of cells) {
    if (seen.has(cell.shiftId)) continue;
    seen.add(cell.shiftId);
    result.push(cell.shiftId);
  }
  return result;
}
