/**
 * Какие единицы планирования сейчас на экране.
 *
 * Единица — фильтр, а не граница (ADR-0032), и фильтр этот перестал быть
 * «одна или все»: планировщику, который ведёт AMER и ST, нужны обе и не нужны
 * остальные. Набор задаётся одной строкой — `ALL`, один id, либо несколько
 * через запятую, — потому что она же уезжает в `unitId` запроса, служит ключом
 * кэша TanStack Query и живёт в `useUi.unitId`. Массив в этих трёх местах
 * означал бы три места, где надо договариваться о порядке и сравнении; строка
 * сравнивается сама.
 *
 * Разбор и сборка живут здесь и только здесь — грамматика у строки одна.
 */

import { ALL_UNITS, type UnitId } from './types.ts';

/** Строка области видимости: `ALL`, `unit-amer` или `unit-amer,unit-st`. */
export type UnitScope = string;

export function isAllUnits(scope: UnitScope): boolean {
  return scope === ALL_UNITS || scope === '';
}

/**
 * Единицы, попадающие в область. `ALL` разворачивается в `allUnitIds` —
 * вызывающему почти всегда нужен именно список, а не признак «все».
 */
export function unitsInScope(scope: UnitScope, allUnitIds: readonly UnitId[]): UnitId[] {
  if (isAllUnits(scope)) return [...allUnitIds];
  const named = new Set(scope.split(',').filter(Boolean));
  const known = allUnitIds.filter((id) => named.has(id));
  // Область, не совпавшая ни с чем (переименовали единицу, старая ссылка), —
  // это «все», а не пустой экран: пустой экран выглядит как поломка.
  return known.length > 0 ? known : [...allUnitIds];
}

/** Входит ли единица в область. */
export function scopeIncludes(scope: UnitScope, unitId: UnitId): boolean {
  return isAllUnits(scope) || scope.split(',').includes(unitId);
}

/**
 * Собирает область из выбранных единиц. Полный набор сворачивается в `ALL`:
 * иначе «все» и «все перечисленные» были бы разными ключами кэша при
 * одинаковом смысле.
 */
export function formatUnitScope(selected: readonly UnitId[], allUnitIds: readonly UnitId[]): UnitScope {
  const unique = allUnitIds.filter((id) => selected.includes(id));
  if (unique.length === 0 || unique.length === allUnitIds.length) return ALL_UNITS;
  return unique.join(',');
}
