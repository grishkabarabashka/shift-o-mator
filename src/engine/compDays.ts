/**
 * Начисление отгулов за работу в нерабочий день — ADR-0007.
 *
 * Дата подбирается **поиском в окне**, а не фиксированным смещением: смещение
 * даёт неверную дату, как только целевой день занят, исключён или сам
 * нерабочий. Если свободного дня нет — `PENDING_APPROVAL`, никогда не молча.
 *
 * **Отгулы не сгорают.** Вместо срока — порог возраста: то, что висит дольше
 * `agingThresholdDays`, подсвечивается, но не пропадает.
 *
 * Нерабочий день определяется по календарю **локации человека** (ADR-0002),
 * а не по таймзоне роли.
 */

import type { DatasetIndex } from '../domain/lookup.ts';
import { cellKey } from '../domain/lookup.ts';
import type {
  Absence,
  Assignment,
  CompDayEntry,
  CompDayTrigger,
  CompOffPolicy,
  DateRange,
  IsoDate,
  LocationId,
  PersonId,
} from '../domain/types.ts';
import { compDayIsOutstanding, effectiveCompDayDate, isWorkingAssignment } from '../domain/types.ts';
import { addDays, daysBetween, eachDate, isHolidayIn, isWeekendIn, rangeContains, weekdayOf } from './dates.ts';

/**
 * Какое правило политики срабатывает на этот день.
 * `undefined` — день рабочий, начисления нет.
 */
export function triggerFor(
  date: IsoDate,
  personLocationId: LocationId,
  index: DatasetIndex,
): CompDayTrigger | undefined {
  const location = index.locations.get(personLocationId);
  if (!location) throw new Error(`Location ${personLocationId} not found`);
  if (isHolidayIn(date, location, index)) return 'HOLIDAY';
  if (!isWeekendIn(date, location)) return undefined;
  return weekdayOf(date) === 7 ? 'SUNDAY' : 'SATURDAY';
}

// ---------------------------------------------------------------------------
// Подбор даты
// ---------------------------------------------------------------------------

export interface SlotSearchInput {
  readonly personId: PersonId;
  readonly earnedForDate: IsoDate;
  readonly policy: CompOffPolicy;
  readonly index: DatasetIndex;
  /** Отсутствия человека — день под отпуском не предлагается. */
  readonly absences: readonly Absence[];
  /** Уже размещённые отгулы — два начисления не встают на один день. */
  readonly occupiedDates: ReadonlySet<IsoDate>;
}

/**
 * Самая ранняя свободная подходящая дата в окне. Поиск идёт от даты
 * начисления наружу: сначала ближайшие дни после, затем до — отгул рядом с
 * отработанным днём полезнее отгула через две недели.
 */
export function findCompDaySlot(input: SlotSearchInput): IsoDate | undefined {
  const { personId, earnedForDate, policy, index, absences, occupiedDates } = input;
  const person = index.people.get(personId);
  if (!person) return undefined;
  const location = index.locations.get(person.locationId);
  if (!location) return undefined;

  const isFree = (date: IsoDate): boolean => {
    if (policy.excludedWeekdays.includes(weekdayOf(date))) return false;
    if (isWeekendIn(date, location) || isHolidayIn(date, location, index)) return false;
    if (occupiedDates.has(date)) return false;
    if (index.assignmentsByCell.has(cellKey(personId, date))) return false;
    if (absences.some((a) => a.personId === personId && date >= a.from && date <= a.to)) {
      return false;
    }
    return true;
  };

  // Чередуем: +1, −1, +2, −2, … в пределах окна.
  const maxOffset = Math.max(policy.windowAfterDays, policy.windowBeforeDays);
  for (let offset = 1; offset <= maxOffset; offset += 1) {
    if (offset <= policy.windowAfterDays) {
      const after = addDays(earnedForDate, offset);
      if (isFree(after)) return after;
    }
    if (offset <= policy.windowBeforeDays) {
      const before = addDays(earnedForDate, -offset);
      if (isFree(before)) return before;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Начисление
// ---------------------------------------------------------------------------

export interface ProposeParams {
  readonly range: DateRange;
  readonly assignments: readonly Assignment[];
  readonly absences: readonly Absence[];
  readonly existing: readonly CompDayEntry[];
  readonly index: DatasetIndex;
  /**
   * Ограничить начисление этими назначениями.
   *
   * Без ограничения одна правка ячейки подобрала бы все необработанные
   * выходные периода и приписала их планировщику: 29 изменений на один клик.
   * Правка отвечает за то, что тронула, и только за это. Осиротевшие записи
   * при этом ищутся по всему набору — иначе они потеряются.
   */
  readonly scopeAssignmentIds?: ReadonlySet<string>;
}

export interface ProposeResult {
  /** Полный набор: существующие плюс новые предложения. */
  readonly entries: CompDayEntry[];
  readonly added: CompDayEntry[];
  /**
   * Записи, чьё назначение исчезло. `PROPOSED` можно снимать молча,
   * остальное требует решения планировщика — время off никто не отбирает.
   */
  readonly orphaned: CompDayEntry[];
}

/**
 * Пересчёт начислений за период. Решения планировщика не перезаписываются:
 * если отгул уже перенесён, перенос сохраняется.
 */
export function proposeCompDays(params: ProposeParams): ProposeResult {
  const { range, assignments, absences, existing, index, scopeAssignmentIds } = params;

  const byAssignment = new Map<string, CompDayEntry>();
  for (const entry of existing) byAssignment.set(entry.earnedForAssignmentId, entry);

  const occupiedDates = new Map<PersonId, Set<IsoDate>>();
  for (const entry of existing) {
    const date = effectiveCompDayDate(entry);
    if (date === undefined || !compDayIsOutstanding(entry)) continue;
    const bucket = occupiedDates.get(entry.personId) ?? new Set<IsoDate>();
    bucket.add(date);
    occupiedDates.set(entry.personId, bucket);
  }

  const liveAssignmentIds = new Set<string>();
  const added: CompDayEntry[] = [];

  // Порядок обхода фиксирован: результат не должен зависеть от порядка входа.
  const ordered = [...assignments].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );

  for (const assignment of ordered) {
    if (!rangeContains(range, assignment.date)) continue;
    if (!isWorkingAssignment(assignment)) continue;
    liveAssignmentIds.add(assignment.id);
    if (byAssignment.has(assignment.id)) continue;
    if (scopeAssignmentIds && !scopeAssignmentIds.has(assignment.id)) continue;

    const person = index.people.get(assignment.personId);
    if (!person) continue;
    const region = index.regions.get(person.regionId);
    if (!region) continue;

    const trigger = triggerFor(assignment.date, person.locationId, index);
    if (!trigger) continue;

    const policy = region.compOffPolicy;
    const occupied = occupiedDates.get(person.id) ?? new Set<IsoDate>();
    const slot = findCompDaySlot({
      personId: person.id,
      earnedForDate: assignment.date,
      policy,
      index,
      absences,
      occupiedDates: occupied,
    });

    const entry: CompDayEntry = {
      id: `cd-${assignment.id}`,
      personId: person.id,
      earnedForAssignmentId: assignment.id,
      earnedForDate: assignment.date,
      trigger,
      ...(slot !== undefined ? { proposedDate: slot } : {}),
      status: slot !== undefined ? 'PROPOSED' : 'PENDING_APPROVAL',
    };

    if (slot !== undefined) {
      occupied.add(slot);
      occupiedDates.set(person.id, occupied);
    }
    added.push(entry);
  }

  const orphaned = existing.filter(
    (entry) =>
      rangeContains(range, entry.earnedForDate) &&
      !liveAssignmentIds.has(entry.earnedForAssignmentId),
  );

  return { entries: [...existing, ...added], added, orphaned };
}

// ---------------------------------------------------------------------------
// Баланс и возраст
// ---------------------------------------------------------------------------

export interface CompDayBalance {
  readonly personId: PersonId;
  readonly earned: number;
  readonly proposed: number;
  readonly scheduled: number;
  readonly taken: number;
  readonly pendingApproval: number;
  readonly declined: number;
  /** Начислено и ещё не отгуляно. */
  readonly due: number;
  /** Числится дольше порога — подсветка, а не потеря. */
  readonly aged: number;
}

/** Возраст начисления в днях на дату отсчёта. */
export function compDayAge(entry: CompDayEntry, asOf: IsoDate): number {
  return daysBetween(entry.earnedForDate, asOf);
}

export function isAged(entry: CompDayEntry, asOf: IsoDate, thresholdDays: number): boolean {
  return compDayIsOutstanding(entry) && compDayAge(entry, asOf) > thresholdDays;
}

export function compDayBalance(
  personId: PersonId,
  entries: readonly CompDayEntry[],
  asOf: IsoDate,
  agingThresholdDays: number,
): CompDayBalance {
  let earned = 0;
  let proposed = 0;
  let scheduled = 0;
  let taken = 0;
  let pendingApproval = 0;
  let declined = 0;
  let aged = 0;

  for (const entry of entries) {
    if (entry.personId !== personId) continue;
    earned += 1;
    switch (entry.status) {
      case 'PROPOSED':
        proposed += 1;
        break;
      case 'SCHEDULED':
        scheduled += 1;
        break;
      case 'TAKEN':
        taken += 1;
        break;
      case 'PENDING_APPROVAL':
        pendingApproval += 1;
        break;
      case 'DECLINED':
        declined += 1;
        break;
    }
    if (isAged(entry, asOf, agingThresholdDays)) aged += 1;
  }

  return {
    personId,
    earned,
    proposed,
    scheduled,
    taken,
    pendingApproval,
    declined,
    due: proposed + scheduled + pendingApproval,
    aged,
  };
}

/** Даты периода, на которые у человека приходится подтверждённый отгул. */
export function blockedDates(
  personId: PersonId,
  entries: readonly CompDayEntry[],
  range: DateRange,
): Set<IsoDate> {
  const dates = new Set<IsoDate>();
  const inRange = new Set(eachDate(range));
  for (const entry of entries) {
    if (entry.personId !== personId) continue;
    if (entry.status !== 'SCHEDULED' && entry.status !== 'TAKEN') continue;
    const date = effectiveCompDayDate(entry);
    if (date !== undefined && inRange.has(date)) dates.add(date);
  }
  return dates;
}
