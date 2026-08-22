/**
 * Селектнутые ячейки в сетке как границы для Generate — owner review: без
 * этого «Generate» всегда прогонял весь видимый месяц целиком, и заполнить
 * только несколько человек на несколько дней было нечем. Тот же приём, что
 * `resolveAbsenceTargets` для `+ Absence` — прямоугольник выделения даёт
 * крайние даты и список людей, только здесь одна общая дата от–до, а не
 * запись на каждого.
 */

import type { DateRange, IsoDate, PersonId, UnitId } from '../../domain/types.ts';
import type { Selection } from '../../store/useUi.ts';
import { selectionBounds } from '../../store/useUi.ts';
import type { GridRow, PlanningView } from './usePlanningView.ts';

export interface AutoPopulateScope {
  readonly range: DateRange;
  readonly personIds: ReadonlySet<PersonId>;
  /** Undefined when the selected people span more than one unit — Generate
   * runs per unit, so that can't be resolved automatically. */
  readonly unitId: UnitId | undefined;
}

export function resolveAutoPopulateScope(
  view: PlanningView,
  selection: Selection,
): AutoPopulateScope | undefined {
  const personRows = view.rows.filter(
    (row): row is Extract<GridRow, { kind: 'person' }> => row.kind === 'person',
  );
  const rowIndexOf = (personId: PersonId) =>
    personRows.findIndex((row) => row.person.id === personId);
  const columnIndexOf = (date: IsoDate) => view.columns.findIndex((column) => column.date === date);

  const bounds = selectionBounds(selection, rowIndexOf, columnIndexOf);
  if (!bounds) return undefined;

  const from = view.columns[bounds.left]?.date;
  const to = view.columns[bounds.right]?.date;
  if (!from || !to) return undefined;

  const personIds = new Set<PersonId>();
  const unitIds = new Set<UnitId>();
  for (let row = bounds.top; row <= bounds.bottom; row += 1) {
    const person = personRows[row]?.person;
    if (!person) continue;
    personIds.add(person.id);
    unitIds.add(person.unitId);
  }
  if (personIds.size === 0) return undefined;

  return {
    range: { from, to },
    personIds,
    unitId: unitIds.size === 1 ? [...unitIds][0] : undefined,
  };
}
