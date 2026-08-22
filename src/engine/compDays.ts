/**
 * Начисление отгулов за работу в нерабочий день.
 *
 * Comp day — начисление с балансом, а не событие в расписании (ADR-0007).
 * Система только предлагает: запись рождается со статусом `PROPOSED`,
 * планировщик подтверждает или переносит. Ошибка в календаре праздников не
 * должна тихо портить баланс.
 *
 * Нерабочий день определяется по календарю **локации человека** (ADR-0002),
 * а не по таймзоне роли.
 */

import type { DatasetIndex } from '../domain/lookup.ts';
import type {
  Assignment,
  CompDayEntry,
  CompDayPolicy,
  CompDayStatus,
  CompDayTrigger,
  DateRange,
  IsoDate,
  PersonId,
} from '../domain/types.ts';
import { addDays, isHolidayIn, isWeekendIn, rangeContains, weekdayOf } from './dates.ts';

/**
 * Какое правило политики срабатывает на этот день.
 * `undefined` — день рабочий, начисления нет.
 */
export function triggerFor(
  date: IsoDate,
  personLocationId: string,
  index: DatasetIndex,
): CompDayTrigger | undefined {
  const location = index.locations.get(personLocationId);
  if (!location) throw new Error(`Локация ${personLocationId} не найдена`);
  if (isHolidayIn(date, location, index)) return 'HOLIDAY';
  if (!isWeekendIn(date, location)) return undefined;
  const weekday = weekdayOf(date);
  if (weekday === 7) return 'SUNDAY';
  // Локация с нестандартным выходным (не суббота и не воскресенье) обслуживается
  // субботним правилом — отдельного случая в политике пока нет.
  return 'SATURDAY';
}

export interface ProposeParams {
  readonly range: DateRange;
  readonly assignments: readonly Assignment[];
  readonly existing: readonly CompDayEntry[];
  readonly index: DatasetIndex;
}

export interface ProposeResult {
  /** Полный набор записей: существующие плюс новые предложения. */
  readonly entries: CompDayEntry[];
  /** Новые предложения, порождённые этим расчётом. */
  readonly added: CompDayEntry[];
  /**
   * Записи, чьё назначение исчезло. `PROPOSED` из таких можно удалять молча,
   * `SCHEDULED` требует решения планировщика.
   */
  readonly orphaned: CompDayEntry[];
}

/**
 * Пересчёт начислений за период.
 *
 * Существующие записи не перезаписываются: если планировщик уже перенёс отгул,
 * его решение сохраняется.
 */
export function proposeCompDays(params: ProposeParams): ProposeResult {
  const { range, assignments, existing, index } = params;

  const byAssignment = new Map<string, CompDayEntry>();
  for (const entry of existing) byAssignment.set(entry.earnedForAssignmentId, entry);

  const liveAssignmentIds = new Set<string>();
  const added: CompDayEntry[] = [];

  for (const assignment of assignments) {
    if (!rangeContains(range, assignment.date)) continue;
    liveAssignmentIds.add(assignment.id);
    if (byAssignment.has(assignment.id)) continue;

    const person = index.people.get(assignment.personId);
    if (!person) continue;
    const unit = index.units.get(person.unitId);
    if (!unit) continue;

    const trigger = triggerFor(assignment.date, person.locationId, index);
    if (!trigger) continue;

    const entry = buildEntry(assignment, person.id, trigger, unit.compDayPolicy);
    if (!entry) continue;
    added.push(entry);
  }

  const orphaned = existing.filter(
    (entry) =>
      rangeContains(range, entry.earnedForDate) &&
      !liveAssignmentIds.has(entry.earnedForAssignmentId),
  );

  return { entries: [...existing, ...added], added, orphaned };
}

function buildEntry(
  assignment: Assignment,
  personId: PersonId,
  trigger: CompDayTrigger,
  policy: CompDayPolicy,
): CompDayEntry | undefined {
  const rule = policy.rules.find((r) => r.workedOn === trigger);
  if (!rule) return undefined;
  return {
    id: `cd-${assignment.id}`,
    personId,
    earnedForAssignmentId: assignment.id,
    earnedForDate: assignment.date,
    trigger,
    proposedDate: addDays(assignment.date, rule.defaultOffsetDays),
    status: 'PROPOSED',
    expiresOn: addDays(assignment.date, policy.expiryWeeks * 7),
  };
}

// ---------------------------------------------------------------------------
// Баланс
// ---------------------------------------------------------------------------

export interface CompDayBalance {
  readonly personId: PersonId;
  readonly proposed: number;
  readonly scheduled: number;
  readonly taken: number;
  readonly expired: number;
  /** Начислено и ещё не отгуляно: `proposed + scheduled`. */
  readonly outstanding: number;
  /** Сгорит в ближайшие `soonWeeks` недель. */
  readonly expiringSoon: number;
}

const EMPTY_COUNTS: Record<CompDayStatus, number> = {
  PROPOSED: 0,
  SCHEDULED: 0,
  TAKEN: 0,
  EXPIRED: 0,
  DECLINED: 0,
};

/** Баланс отгулов человека на указанную дату отсчёта. */
export function compDayBalance(
  personId: PersonId,
  entries: readonly CompDayEntry[],
  asOf: IsoDate,
  soonWeeks = 4,
): CompDayBalance {
  const counts = { ...EMPTY_COUNTS };
  const horizon = addDays(asOf, soonWeeks * 7);
  let expiringSoon = 0;

  for (const entry of entries) {
    if (entry.personId !== personId) continue;
    counts[entry.status] += 1;
    if (
      (entry.status === 'PROPOSED' || entry.status === 'SCHEDULED') &&
      entry.expiresOn <= horizon
    ) {
      expiringSoon += 1;
    }
  }

  return {
    personId,
    proposed: counts.PROPOSED,
    scheduled: counts.SCHEDULED,
    taken: counts.TAKEN,
    expired: counts.EXPIRED,
    outstanding: counts.PROPOSED + counts.SCHEDULED,
    expiringSoon,
  };
}
