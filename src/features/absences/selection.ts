/**
 * Превращает текущее выделение в сетке в список диапазонов для создания
 * отсутствий: одна запись на каждого выделенного человека, границы дат — по
 * крайним колонкам выделения.
 */

import type { IsoDate, PersonId } from '../../domain/types.ts';
import type { AbsenceRangeTarget, Selection } from '../../store/useUi.ts';
import { selectionBounds } from '../../store/useUi.ts';
import type { GridRow, PlanningView } from '../planning/usePlanningView.ts';

export function resolveAbsenceTargets(
  view: PlanningView,
  selection: Selection,
): AbsenceRangeTarget[] {
  const personRows = view.rows.filter(
    (row): row is Extract<GridRow, { kind: 'person' }> => row.kind === 'person',
  );
  const rowIndexOf = (personId: PersonId) =>
    personRows.findIndex((row) => row.person.id === personId);
  const columnIndexOf = (date: IsoDate) => view.columns.findIndex((column) => column.date === date);

  const bounds = selectionBounds(selection, rowIndexOf, columnIndexOf);
  if (!bounds) return [];

  const from = view.columns[bounds.left]?.date;
  const to = view.columns[bounds.right]?.date;
  if (!from || !to) return [];

  const targets: AbsenceRangeTarget[] = [];
  for (let row = bounds.top; row <= bounds.bottom; row += 1) {
    const person = personRows[row]?.person;
    if (person) targets.push({ personId: person.id, from, to });
  }
  return targets;
}
