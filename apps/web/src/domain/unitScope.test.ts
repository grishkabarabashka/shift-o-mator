import { describe, expect, it } from 'vitest';
import { formatUnitScope, isAllUnits, scopeIncludes, unitsInScope } from './unitScope.ts';

const ALL = ['unit-amer', 'unit-emea', 'unit-apac', 'unit-st'];

describe('planning unit scope', () => {
  it('"all" expands to the full list', () => {
    expect(unitsInScope('ALL', ALL)).toEqual(ALL);
    expect(isAllUnits('ALL')).toBe(true);
  });

  it('the set keeps the reference order, not the click order', () => {
    // NOTE: Otherwise `unit-st,unit-amer` and `unit-amer,unit-st` would be two
    // different cache keys for the same meaning.
    expect(unitsInScope('unit-st,unit-amer', ALL)).toEqual(['unit-amer', 'unit-st']);
    expect(formatUnitScope(['unit-st', 'unit-amer'], ALL)).toBe('unit-amer,unit-st');
  });

  it('the full set collapses to "all"', () => {
    expect(formatUnitScope(ALL, ALL)).toBe('ALL');
  });

  it('an empty selection is "all", not an empty screen', () => {
    expect(formatUnitScope([], ALL)).toBe('ALL');
  });

  it('an unknown unit does not leave the screen empty', () => {
    expect(unitsInScope('unit-gone', ALL)).toEqual(ALL);
  });

  it('membership is checked against the set, not string equality', () => {
    expect(scopeIncludes('unit-amer,unit-st', 'unit-st')).toBe(true);
    expect(scopeIncludes('unit-amer,unit-st', 'unit-emea')).toBe(false);
    expect(scopeIncludes('ALL', 'unit-emea')).toBe(true);
  });
});
