/**
 * NOTE: Cell projection: what the grid shows for a (person, date) pair — ADR-0017.
 *
 * Priority is defined here and nowhere else. In order, first match wins:
 *
 *   1. an assignment with a working role — a person can be scheduled on a
 *      holiday or a weekend, and this must override any non-working signal;
 *   2. an absence covering the date;
 *   3. a confirmed comp day off (`SCHEDULED` or `TAKEN`);
 *   4. a holiday per the person's location calendar → `PH`;
 *   5. otherwise empty.
 *
 * There used to be a sixth: a roster marker. The markers are gone (ADR-0052) and an
 * assignment is a shift, so rule 1 is the only thing an assignment can produce.
 *
 * When rule 1 fires and one of rules 2-4 would also have fired, the cell
 * carries a conflict: this is impossible data, not just an overlap.
 */

import { cellKey, type DatasetIndex } from '../domain/lookup.ts';
import type {
  Absence,
  CellEventInfo,
  EventType,
  CellValue,
  CompDayEntry,
  DateRange,
  IsoDate,
  PersonId,
} from '../domain/types.ts';
import { compDayBlocksAssignment, effectiveCompDayDate } from '../domain/types.ts';
import { eachDate, isWeekendIn, rangeContains } from './dates.ts';

/**
 * NOTE: The kind of absence is a row now (ADR-0049), so the projection carries the
 * detail alongside a single `ABSENT` status rather than switching on an enum.
 *
 * An unknown type still renders and still blocks: a deactivated type must not make a
 * historical absence vanish from the grid.
 */
function eventInfoOf(absence: Absence, eventTypes: ReadonlyMap<string, EventType>): CellEventInfo {
  const type = eventTypes.get(absence.eventTypeId);
  return {
    eventTypeId: absence.eventTypeId,
    shortLabel: type?.shortLabel ?? 'Absent',
    color: type?.color ?? '#a8b0bb',
    blocksAssignment: type?.blocksAssignment ?? true,
    portion: absence.portion,
  };
}

export interface CellProjectionInput {
  /** NOTE: Needed to resolve an absence's kind, which is a row now (ADR-0049). */
  readonly eventTypes?: ReadonlyMap<string, EventType>;
  readonly range: DateRange;
  readonly absences: readonly Absence[];
  readonly compDays: readonly CompDayEntry[];
  readonly index: DatasetIndex;
}

export interface CellProjection {
  /** NOTE: `personId|date` -> cell value. Empty cells never make it into the map. */
  readonly byCell: ReadonlyMap<string, CellValue>;
  /** NOTE: Dates that are non-working per the person's location calendar. */
  readonly nonWorkingByCell: ReadonlySet<string>;
}

/**
 * NOTE: Builds the projection for the whole range at once. Computing each cell
 * individually would mean 80 x 31 independent scans over absences.
 */
export function projectCells(input: CellProjectionInput): CellProjection {
  const { range, absences, compDays, index } = input;
  const eventTypes = input.eventTypes ?? new Map<string, EventType>();
  const byCell = new Map<string, CellValue>();
  const nonWorkingByCell = new Set<string>();

  const dates = eachDate(range);

  // --- 1. Working shifts -----------------------------------------------------
  for (const [key, assignment] of index.assignmentsByCell) {
    if (!rangeContains(range, assignment.date)) continue;
    byCell.set(key, {
      kind: 'SHIFT',
      shiftId: assignment.content.shiftId,
      assignmentId: assignment.id,
    });
  }

  // --- 4. Holidays per the person's location ---------------------------------
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
      }
    }
  }

  // --- 3. Confirmed comp days off ---------------------------------------
  const proposedByCell = new Map<string, string>();
  for (const entry of compDays) {
    const date = effectiveCompDayDate(entry);
    if (date === undefined || !rangeContains(range, date)) continue;
    const key = cellKey(entry.personId, date);

    if (!compDayBlocksAssignment(entry)) {
      // NOTE: A proposal is rendered as a hint and does not occupy the day.
      if (entry.status === 'PROPOSED') proposedByCell.set(key, entry.id);
      continue;
    }

    const existing = byCell.get(key);
    if (existing?.kind === 'SHIFT') {
      byCell.set(key, { ...existing, conflict: existing.conflict ?? 'COMP_DAY', compDayId: entry.id });
    } else {
      byCell.set(key, { kind: 'STATUS', status: 'COMP_OFF', compDayId: entry.id });
    }
  }

  // --- 2. Absences — override holiday and comp day off -----------------------
  for (const absence of absences) {
    for (const date of eachDate({ from: absence.from, to: absence.to })) {
      if (!rangeContains(range, date)) continue;
      const key = cellKey(absence.personId, date);
      const existing = byCell.get(key);
      if (existing?.kind === 'SHIFT') {
        // Both facts are kept: the shift still renders as the duty, the absence renders
        // in the band, and the conflict flag still marks the cell (ADR-0050).
        byCell.set(key, {
          ...existing,
          conflict: 'ABSENCE',
          event: eventInfoOf(absence, eventTypes),
          absenceId: absence.id,
        });
      } else {
        byCell.set(key, {
          kind: 'STATUS',
          status: 'ABSENT',
          event: eventInfoOf(absence, eventTypes),
          absenceId: absence.id,
        });
      }
    }
  }

  // --- Proposed comp days off, layered over empty cells -----------------------
  for (const [key, compDayId] of proposedByCell) {
    const existing = byCell.get(key);
    if (!existing) byCell.set(key, { kind: 'EMPTY', proposedCompDay: compDayId });
    else if (existing.kind === 'SHIFT') byCell.set(key, { ...existing, proposedCompDay: compDayId });
  }

  return { byCell, nonWorkingByCell };
}

/** NOTE: Value of a single cell. An empty cell is returned as `EMPTY`. */
export function cellValueAt(
  projection: CellProjection,
  personId: PersonId,
  date: IsoDate,
): CellValue {
  return projection.byCell.get(cellKey(personId, date)) ?? { kind: 'EMPTY' };
}

/** NOTE: Whether the person's day is occupied by something that prevents scheduling a shift. */
export function isBlocked(value: CellValue): boolean {
  if (value.kind !== 'STATUS') return false;
  if (value.status === 'COMP_OFF') return true;
  // Whether an absence blocks is the type's own decision (ADR-0049): a floating holiday
  // someone worked through does not close the day out.
  return value.status === 'ABSENT' && (value.event?.blocksAssignment ?? true);
}
