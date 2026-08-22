import { describe, expect, it } from 'vitest';
import { formatUnitScope, isAllUnits, scopeIncludes, unitsInScope } from './unitScope.ts';

const ALL = ['unit-amer', 'unit-emea', 'unit-apac', 'unit-st'];

describe('область единиц планирования', () => {
  it('«все» разворачивается в полный список', () => {
    expect(unitsInScope('ALL', ALL)).toEqual(ALL);
    expect(isAllUnits('ALL')).toBe(true);
  });

  it('набор сохраняет порядок справочника, а не порядок клика', () => {
    // Иначе `unit-st,unit-amer` и `unit-amer,unit-st` — два разных ключа кэша
    // при одном и том же смысле.
    expect(unitsInScope('unit-st,unit-amer', ALL)).toEqual(['unit-amer', 'unit-st']);
    expect(formatUnitScope(['unit-st', 'unit-amer'], ALL)).toBe('unit-amer,unit-st');
  });

  it('полный набор сворачивается в «все»', () => {
    expect(formatUnitScope(ALL, ALL)).toBe('ALL');
  });

  it('пустой выбор — это «все», а не пустой экран', () => {
    expect(formatUnitScope([], ALL)).toBe('ALL');
  });

  it('неизвестная единица не оставляет экран пустым', () => {
    expect(unitsInScope('unit-gone', ALL)).toEqual(ALL);
  });

  it('вхождение проверяется по набору, а не по равенству строк', () => {
    expect(scopeIncludes('unit-amer,unit-st', 'unit-st')).toBe(true);
    expect(scopeIncludes('unit-amer,unit-st', 'unit-emea')).toBe(false);
    expect(scopeIncludes('ALL', 'unit-emea')).toBe(true);
  });
});
