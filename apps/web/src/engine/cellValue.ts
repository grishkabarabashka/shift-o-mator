/**
 * Проекция ячейки: что сетка показывает для пары (человек, дата) — ADR-0017.
 *
 * Приоритет определён здесь и больше нигде. Порядок, первое совпадение
 * выигрывает:
 *
 *   1. назначение с рабочей ролью — человека можно поставить и на праздник,
 *      и на выходной, и это должно перебивать любой нерабочий сигнал;
 *   2. отсутствие, покрывающее дату;
 *   3. подтверждённый отгул (`SCHEDULED` или `TAKEN`);
 *   4. праздник по календарю локации человека → `PH`;
 *   5. маркер ростера → `OFF` / `NOT_SCHEDULED`;
 *   6. иначе пусто.
 *
 * Когда срабатывает правило 1, а сработало бы и одно из 2–4, ячейка несёт
 * конфликт: это невозможные данные, а не просто перекрытие.
 */

import { cellKey, type DatasetIndex } from '../domain/lookup.ts';
import type {
  Absence,
  AbsenceType,
  CellStatus,
  CellValue,
  CompDayEntry,
  DateRange,
  IsoDate,
  PersonId,
} from '../domain/types.ts';
import { compDayBlocksAssignment, effectiveCompDayDate } from '../domain/types.ts';
import { eachDate, isWeekendIn, rangeContains } from './dates.ts';

function statusOfAbsence(type: AbsenceType): CellStatus {
  switch (type) {
    case 'VACATION':
      return 'VACATION';
    case 'SICK':
      return 'SICK';
    case 'OTHER':
      return 'OTHER';
  }
}

export interface CellProjectionInput {
  readonly range: DateRange;
  readonly absences: readonly Absence[];
  readonly compDays: readonly CompDayEntry[];
  readonly index: DatasetIndex;
}

export interface CellProjection {
  /** `personId|date` → значение ячейки. Пустые ячейки в карту не попадают. */
  readonly byCell: ReadonlyMap<string, CellValue>;
  /** Даты, нерабочие по календарю локации человека. */
  readonly nonWorkingByCell: ReadonlySet<string>;
}

/**
 * Строит проекцию на весь период разом. Точечный расчёт на каждую ячейку дал
 * бы 80 × 31 независимых обходов отсутствий.
 */
export function projectCells(input: CellProjectionInput): CellProjection {
  const { range, absences, compDays, index } = input;
  const byCell = new Map<string, CellValue>();
  const nonWorkingByCell = new Set<string>();

  const dates = eachDate(range);

  // --- 5. Маркеры и 1. рабочие смены ---------------------------------------
  for (const [key, assignment] of index.assignmentsByCell) {
    if (!rangeContains(range, assignment.date)) continue;
    if (assignment.content.kind === 'SHIFT') {
      byCell.set(key, {
        kind: 'SHIFT',
        shiftId: assignment.content.shiftId,
        assignmentId: assignment.id,
      });
    } else {
      byCell.set(key, {
        kind: 'STATUS',
        status: assignment.content.marker,
        assignmentId: assignment.id,
      });
    }
  }

  // --- 4. Праздники по локации человека -----------------------------------
  for (const person of index.people.values()) {
    const location = index.locations.get(person.locationId);
    if (!location) continue;
    const holidayDates = index.holidaysByLocation.get(location.id);

    for (const date of dates) {
      const key = cellKey(person.id, date);
      const isHoliday = holidayDates?.has(date) ?? false;
      if (isHoliday || isWeekendIn(date, location)) nonWorkingByCell.add(key);
      if (!isHoliday) continue;

      const existing = byCell.get(key);
      if (existing?.kind === 'SHIFT') {
        byCell.set(key, { ...existing, conflict: 'HOLIDAY' });
      } else if (!existing || existing.kind === 'EMPTY') {
        byCell.set(key, { kind: 'STATUS', status: 'PH' });
      } else if (existing.kind === 'STATUS' && existing.assignmentId !== undefined) {
        // Праздник информативнее маркера «Off».
        byCell.set(key, { kind: 'STATUS', status: 'PH', assignmentId: existing.assignmentId });
      }
    }
  }

  // --- 3. Подтверждённые отгулы -------------------------------------------
  const proposedByCell = new Map<string, string>();
  for (const entry of compDays) {
    const date = effectiveCompDayDate(entry);
    if (date === undefined || !rangeContains(range, date)) continue;
    const key = cellKey(entry.personId, date);

    if (!compDayBlocksAssignment(entry)) {
      // Предложение рисуется подсказкой и день не занимает.
      if (entry.status === 'PROPOSED') proposedByCell.set(key, entry.id);
      continue;
    }

    const existing = byCell.get(key);
    if (existing?.kind === 'SHIFT') {
      byCell.set(key, { ...existing, conflict: existing.conflict ?? 'COMP_DAY' });
    } else {
      byCell.set(key, { kind: 'STATUS', status: 'COMP_OFF', compDayId: entry.id });
    }
  }

  // --- 2. Отсутствия — перебивают праздник и отгул ------------------------
  for (const absence of absences) {
    for (const date of eachDate({ from: absence.from, to: absence.to })) {
      if (!rangeContains(range, date)) continue;
      const key = cellKey(absence.personId, date);
      const existing = byCell.get(key);
      if (existing?.kind === 'SHIFT') {
        byCell.set(key, { ...existing, conflict: 'ABSENCE' });
      } else {
        byCell.set(key, {
          kind: 'STATUS',
          status: statusOfAbsence(absence.type),
          absenceId: absence.id,
        });
      }
    }
  }

  // --- Предложенные отгулы поверх пустых ячеек ----------------------------
  for (const [key, compDayId] of proposedByCell) {
    const existing = byCell.get(key);
    if (!existing) byCell.set(key, { kind: 'EMPTY', proposedCompDay: compDayId });
    else if (existing.kind === 'SHIFT') byCell.set(key, { ...existing, proposedCompDay: compDayId });
  }

  return { byCell, nonWorkingByCell };
}

/** Значение одной ячейки. Пустая ячейка возвращается как `EMPTY`. */
export function cellValueAt(
  projection: CellProjection,
  personId: PersonId,
  date: IsoDate,
): CellValue {
  return projection.byCell.get(cellKey(personId, date)) ?? { kind: 'EMPTY' };
}

/** Занят ли день человека чем-то, что мешает поставить смену. */
export function isBlocked(value: CellValue): boolean {
  if (value.kind !== 'STATUS') return false;
  return (
    value.status === 'VACATION' ||
    value.status === 'SICK' ||
    value.status === 'OTHER' ||
    value.status === 'COMP_OFF'
  );
}
