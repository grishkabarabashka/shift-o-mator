/**
 * NOTE: Which planning units are currently on screen.
 *
 * A unit is a filter, not a boundary (ADR-0032), and that filter is no longer
 * "one or all": a planner who runs both AMER and ST needs exactly those two, not
 * the rest. The set is a single string — `ALL`, one id, or several comma-joined —
 * because that same string goes straight into the request's `unitId`, serves as
 * the TanStack Query cache key, and lives in `useUi.unitId`. An array in these
 * three places would mean three places to agree on ordering and comparison;
 * a string compares itself.
 *
 * Parsing and building live here and only here — the string has one grammar.
 */

import { ALL_UNITS, type UnitId } from './types.ts';

/** NOTE: Scope string: `ALL`, `unit-amer`, or `unit-amer,unit-st`. */
export type UnitScope = string;

export function isAllUnits(scope: UnitScope): boolean {
  return scope === ALL_UNITS || scope === '';
}

/**
 * NOTE: Units that fall within the scope. `ALL` expands to `allUnitIds` — the
 * caller almost always needs the actual list, not an "is it all" flag.
 */
export function unitsInScope(scope: UnitScope, allUnitIds: readonly UnitId[]): UnitId[] {
  if (isAllUnits(scope)) return [...allUnitIds];
  const named = new Set(scope.split(',').filter(Boolean));
  const known = allUnitIds.filter((id) => named.has(id));
  // NOTE: A scope that matched nothing (a unit was renamed, this is a stale
  // reference) means "all", not an empty screen: an empty screen reads as broken.
  return known.length > 0 ? known : [...allUnitIds];
}

/** NOTE: Whether a unit falls within the scope. */
export function scopeIncludes(scope: UnitScope, unitId: UnitId): boolean {
  return isAllUnits(scope) || scope.split(',').includes(unitId);
}

/**
 * NOTE: Builds a scope from the selected units. The full set collapses to
 * `ALL`: otherwise "all" and "all of them listed out" would be different cache
 * keys for the same meaning.
 */
export function formatUnitScope(selected: readonly UnitId[], allUnitIds: readonly UnitId[]): UnitScope {
  const unique = allUnitIds.filter((id) => selected.includes(id));
  if (unique.length === 0 || unique.length === allUnitIds.length) return ALL_UNITS;
  return unique.join(',');
}
