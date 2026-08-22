/**
 * Валидация плана. Три уровня серьёзности, которые нельзя смешивать (ADR-0009):
 *
 * - BLOCKING — публикация невозможна;
 * - WARNING  — требует осознанного подтверждения с комментарием;
 * - INFO     — подсветка без блокировки.
 *
 * Функция чистая: текущая дата передаётся параметром `asOf`, иначе тесты
 * зависели бы от дня запуска.
 */

import type { DatasetIndex } from '../domain/lookup.ts';
import type {
  Absence,
  AbsenceCapacityRule,
  Acknowledgement,
  Assignment,
  CompDayEntry,
  CoverageCell,
  DateRange,
  IsoDate,
  Issue,
  IssueCode,
  IssueLevel,
  Location,
  Person,
  UnitId,
  UtcInterval,
} from '../domain/types.ts';
import { compDayBlocksAssignment, effectiveCompDayDate } from '../domain/types.ts';
import {
  addDays,
  countWorkdays,
  eachDate,
  isWeekendIn,
  rangeContains,
  restHoursBetween,
  shiftInterval,
  weekdayOf,
} from './dates.ts';

export interface ValidateParams {
  readonly unitId: UnitId;
  readonly range: DateRange;
  readonly assignments: readonly Assignment[];
  readonly absences: readonly Absence[];
  readonly compDays: readonly CompDayEntry[];
  readonly coverageCells: readonly CoverageCell[];
  readonly absenceCapacityRules: readonly AbsenceCapacityRule[];
  readonly index: DatasetIndex;
  /** Дата отсчёта для «истекающих» отгулов. */
  readonly asOf: IsoDate;
}

interface IssueDraft {
  readonly level: IssueLevel;
  readonly code: IssueCode;
  readonly message: string;
  readonly date?: IsoDate;
  readonly personId?: string;
  readonly roleId?: string;
}

function makeIssue(unitId: UnitId, draft: IssueDraft): Issue {
  const key = [draft.code, draft.date ?? '', draft.personId ?? '', draft.roleId ?? ''].join('|');
  return {
    key,
    level: draft.level,
    code: draft.code,
    message: draft.message,
    unitId,
    ...(draft.date !== undefined ? { date: draft.date } : {}),
    ...(draft.personId !== undefined ? { personId: draft.personId } : {}),
    ...(draft.roleId !== undefined ? { roleId: draft.roleId } : {}),
  };
}

const LEVEL_ORDER: Record<IssueLevel, number> = { BLOCKING: 0, WARNING: 1, INFO: 2 };

export function validate(params: ValidateParams): Issue[] {
  const drafts: IssueDraft[] = [
    ...checkCoverage(params),
    ...checkAssignments(params),
    ...checkRest(params),
    ...checkConsecutiveDays(params),
    ...checkWeekendLoad(params),
    ...checkAbsenceCapacity(params),
    ...checkTargetShares(params),
    ...checkExpiringCompDays(params),
  ];

  return drafts
    .map((draft) => makeIssue(params.unitId, draft))
    .sort((a, b) => {
      const byLevel = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
      if (byLevel !== 0) return byLevel;
      return (a.date ?? '').localeCompare(b.date ?? '') || a.key.localeCompare(b.key);
    });
}

/** Подтверждено ли нарушение. Подтверждения хранятся вместе с планом. */
export function acknowledgedKeys(acks: readonly Acknowledgement[]): Set<string> {
  return new Set(acks.map((ack) => ack.issueKey));
}

/** Можно ли публиковать: нет ни одного BLOCKING. */
export function canPublish(issues: readonly Issue[]): boolean {
  return !issues.some((issue) => issue.level === 'BLOCKING');
}

export interface IssueSummary {
  readonly blocking: number;
  readonly warning: number;
  readonly info: number;
  /** Предупреждения без подтверждения. */
  readonly unacknowledgedWarnings: number;
}

export function summarizeIssues(
  issues: readonly Issue[],
  acknowledged: ReadonlySet<string>,
): IssueSummary {
  let blocking = 0;
  let warning = 0;
  let info = 0;
  let unacknowledgedWarnings = 0;
  for (const issue of issues) {
    if (issue.level === 'BLOCKING') blocking += 1;
    else if (issue.level === 'INFO') info += 1;
    else {
      warning += 1;
      if (!acknowledged.has(issue.key)) unacknowledgedWarnings += 1;
    }
  }
  return { blocking, warning, info, unacknowledgedWarnings };
}

// ---------------------------------------------------------------------------
// Покрытие
// ---------------------------------------------------------------------------

function checkCoverage({ coverageCells, index }: ValidateParams): IssueDraft[] {
  const drafts: IssueDraft[] = [];
  for (const cell of coverageCells) {
    const role = index.roles.get(cell.roleId);
    const code = role?.code ?? cell.roleId;
    const label = cell.ruleLabel ? ` (${cell.ruleLabel})` : '';

    if (cell.level === 'BELOW_MIN') {
      drafts.push({
        level: 'BLOCKING',
        code: 'COVERAGE_BELOW_MIN',
        message: `${code}${label}: назначено ${cell.actual} при минимуме ${cell.min}`,
        date: cell.date,
        roleId: cell.roleId,
      });
    } else if (cell.level === 'BELOW_TARGET' && cell.target !== undefined) {
      drafts.push({
        level: 'WARNING',
        code: 'COVERAGE_BELOW_TARGET',
        message: `${code}${label}: назначено ${cell.actual} при цели ${cell.target}`,
        date: cell.date,
        roleId: cell.roleId,
      });
    } else if (cell.level === 'OVER_MAX' && cell.max !== undefined) {
      drafts.push({
        level: 'WARNING',
        code: 'COVERAGE_OVER_MAX',
        message: `${code}${label}: назначено ${cell.actual} при максимуме ${cell.max}`,
        date: cell.date,
        roleId: cell.roleId,
      });
    }
  }
  return drafts;
}

// ---------------------------------------------------------------------------
// Назначения
// ---------------------------------------------------------------------------

function unitAssignments(params: ValidateParams): Assignment[] {
  const { assignments, index, unitId } = params;
  return assignments.filter((assignment) => {
    const person = index.people.get(assignment.personId);
    return person !== undefined && person.unitId === unitId;
  });
}

function checkAssignments(params: ValidateParams): IssueDraft[] {
  const { range, absences, compDays, index } = params;
  const drafts: IssueDraft[] = [];

  const absencesByPerson = new Map<string, Absence[]>();
  for (const absence of absences) {
    const bucket = absencesByPerson.get(absence.personId);
    if (bucket) bucket.push(absence);
    else absencesByPerson.set(absence.personId, [absence]);
  }

  const blockingCompDays = new Map<string, CompDayEntry>();
  for (const entry of compDays) {
    if (!compDayBlocksAssignment(entry)) continue;
    blockingCompDays.set(`${entry.personId}|${effectiveCompDayDate(entry)}`, entry);
  }

  const seenCell = new Map<string, Assignment>();

  for (const assignment of unitAssignments(params)) {
    if (!rangeContains(range, assignment.date)) continue;
    const person = index.people.get(assignment.personId);
    if (!person) continue;
    const role = index.roles.get(assignment.roleId);

    if (!role) {
      drafts.push({
        level: 'BLOCKING',
        code: 'ROLE_OUTSIDE_UNIT',
        message: `Роль ${assignment.roleId} не существует`,
        date: assignment.date,
        personId: person.id,
      });
      continue;
    }

    if (role.unitId !== person.unitId) {
      drafts.push({
        level: 'BLOCKING',
        code: 'ROLE_OUTSIDE_UNIT',
        message: `${person.displayName}: роль ${role.code} принадлежит другой единице`,
        date: assignment.date,
        personId: person.id,
        roleId: role.id,
      });
    } else if (!person.eligibility.some((e) => e.roleId === role.id)) {
      drafts.push({
        level: 'BLOCKING',
        code: 'ROLE_NOT_ELIGIBLE',
        message: `${person.displayName}: роль ${role.code} недоступна`,
        date: assignment.date,
        personId: person.id,
        roleId: role.id,
      });
    }

    const cellKey = `${person.id}|${assignment.date}`;
    if (seenCell.has(cellKey)) {
      drafts.push({
        level: 'BLOCKING',
        code: 'DOUBLE_ASSIGNMENT',
        message: `${person.displayName}: две смены в один день`,
        date: assignment.date,
        personId: person.id,
        roleId: role.id,
      });
    } else {
      seenCell.set(cellKey, assignment);
    }

    const absence = (absencesByPerson.get(person.id) ?? []).find(
      (a) => assignment.date >= a.from && assignment.date <= a.to,
    );
    if (absence) {
      drafts.push({
        level: 'BLOCKING',
        code: 'ASSIGNED_DURING_ABSENCE',
        message: `${person.displayName}: назначение во время отсутствия (${absenceLabel(absence.type)})`,
        date: assignment.date,
        personId: person.id,
        roleId: role.id,
      });
    }

    if (blockingCompDays.has(cellKey)) {
      drafts.push({
        level: 'BLOCKING',
        code: 'ASSIGNED_DURING_COMP_DAY',
        message: `${person.displayName}: назначение на подтверждённый отгул`,
        date: assignment.date,
        personId: person.id,
        roleId: role.id,
      });
    }

    if (!person.availableWeekdays.includes(weekdayOf(assignment.date))) {
      drafts.push({
        level: 'WARNING',
        code: 'UNAVAILABLE_WEEKDAY',
        message: `${person.displayName}: день недели вне доступности`,
        date: assignment.date,
        personId: person.id,
        roleId: role.id,
      });
    }

    if (person.preferences?.avoidsWeekdays?.includes(weekdayOf(assignment.date))) {
      drafts.push({
        level: 'INFO',
        code: 'PREFERENCE_VIOLATED',
        message: `${person.displayName}: день, которого человек предпочитает избегать`,
        date: assignment.date,
        personId: person.id,
        roleId: role.id,
      });
    }
  }

  return drafts;
}

function absenceLabel(type: Absence['type']): string {
  switch (type) {
    case 'VACATION':
      return 'отпуск';
    case 'COMP_DAY':
      return 'отгул';
    case 'TRAINING':
      return 'обучение';
    case 'SICK':
      return 'больничный';
    case 'OTHER':
      return 'прочее';
  }
}

// ---------------------------------------------------------------------------
// Отдых и дни подряд
// ---------------------------------------------------------------------------

interface DatedInterval {
  readonly date: IsoDate;
  readonly interval: UtcInterval;
}

function intervalsByPerson(params: ValidateParams): Map<string, DatedInterval[]> {
  const { index } = params;
  const result = new Map<string, DatedInterval[]>();
  for (const assignment of unitAssignments(params)) {
    const role = index.roles.get(assignment.roleId);
    if (!role) continue;
    let interval: UtcInterval;
    try {
      interval = shiftInterval(role, assignment.date, assignment.timeOverride);
    } catch {
      continue;
    }
    const bucket = result.get(assignment.personId);
    const item = { date: assignment.date, interval };
    if (bucket) bucket.push(item);
    else result.set(assignment.personId, [item]);
  }
  for (const bucket of result.values()) {
    bucket.sort((a, b) => a.interval.start.localeCompare(b.interval.start));
  }
  return result;
}

function checkRest(params: ValidateParams): IssueDraft[] {
  const { index, range } = params;
  const drafts: IssueDraft[] = [];

  for (const [personId, intervals] of intervalsByPerson(params)) {
    const person = index.people.get(personId);
    if (!person) continue;
    for (let i = 1; i < intervals.length; i += 1) {
      const previous = intervals[i - 1];
      const current = intervals[i];
      if (!previous || !current) continue;
      if (!rangeContains(range, current.date)) continue;
      const rest = restHoursBetween(previous.interval, current.interval);
      if (rest >= person.constraints.minRestHours) continue;
      drafts.push({
        level: 'WARNING',
        code: 'MIN_REST_VIOLATED',
        message: `${person.displayName}: отдых ${rest.toFixed(1)} ч при минимуме ${person.constraints.minRestHours} ч`,
        date: current.date,
        personId,
      });
    }
  }

  return drafts;
}

function checkConsecutiveDays(params: ValidateParams): IssueDraft[] {
  const { index, range } = params;
  const drafts: IssueDraft[] = [];

  const datesByPerson = new Map<string, Set<IsoDate>>();
  for (const assignment of unitAssignments(params)) {
    const bucket = datesByPerson.get(assignment.personId);
    if (bucket) bucket.add(assignment.date);
    else datesByPerson.set(assignment.personId, new Set([assignment.date]));
  }

  for (const [personId, dates] of datesByPerson) {
    const person = index.people.get(personId);
    if (!person) continue;
    const limit = person.constraints.maxConsecutiveDays;
    const sorted = [...dates].sort();

    let runStart: IsoDate | undefined;
    let runLength = 0;
    let previous: IsoDate | undefined;

    const flush = (): void => {
      if (runLength > limit && runStart !== undefined && previous !== undefined) {
        if (rangeContains(range, previous)) {
          drafts.push({
            level: 'WARNING',
            code: 'CONSECUTIVE_DAYS_EXCEEDED',
            message: `${person.displayName}: ${runLength} дней подряд при лимите ${limit} (с ${runStart})`,
            date: previous,
            personId,
          });
        }
      }
    };

    for (const date of sorted) {
      if (previous !== undefined && addDays(previous, 1) === date) {
        runLength += 1;
      } else {
        flush();
        runStart = date;
        runLength = 1;
      }
      previous = date;
    }
    flush();
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// Нагрузка по выходным
// ---------------------------------------------------------------------------

const WEEKEND_WINDOW_DAYS = 28;

function checkWeekendLoad(params: ValidateParams): IssueDraft[] {
  const { index, range } = params;
  const drafts: IssueDraft[] = [];

  const datesByPerson = new Map<string, IsoDate[]>();
  for (const assignment of unitAssignments(params)) {
    const bucket = datesByPerson.get(assignment.personId);
    if (bucket) bucket.push(assignment.date);
    else datesByPerson.set(assignment.personId, [assignment.date]);
  }

  for (const [personId, dates] of datesByPerson) {
    const person = index.people.get(personId);
    const limit = person?.constraints.maxWeekendDaysPer4Weeks;
    if (!person || limit === undefined) continue;
    const location = index.locations.get(person.locationId);
    if (!location) continue;

    const weekendDates = dates.filter((date) => isWeekendIn(date, location)).sort();
    for (const date of weekendDates) {
      if (!rangeContains(range, date)) continue;
      const windowStart = addDays(date, -(WEEKEND_WINDOW_DAYS - 1));
      const inWindow = weekendDates.filter((d) => d >= windowStart && d <= date).length;
      if (inWindow > limit) {
        drafts.push({
          level: 'WARNING',
          code: 'WEEKEND_LOAD_EXCEEDED',
          message: `${person.displayName}: ${inWindow} выходных за 4 недели при лимите ${limit}`,
          date,
          personId,
        });
      }
    }
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// Лимиты одновременных отсутствий
// ---------------------------------------------------------------------------

interface AbsenceSpan {
  readonly personId: string;
  readonly type: Absence['type'];
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly workdays: number;
}

function absenceSpans(params: ValidateParams): AbsenceSpan[] {
  const { absences, compDays, index, unitId } = params;
  const spans: AbsenceSpan[] = [];

  const locationOf = (personId: string): Location | undefined => {
    const person = index.people.get(personId);
    if (!person || person.unitId !== unitId) return undefined;
    return index.locations.get(person.locationId);
  };

  for (const absence of absences) {
    const location = locationOf(absence.personId);
    if (!location) continue;
    spans.push({
      personId: absence.personId,
      type: absence.type,
      from: absence.from,
      to: absence.to,
      workdays: countWorkdays({ from: absence.from, to: absence.to }, location, index),
    });
  }

  // Подтверждённый отгул занимает человека так же, как отпуск.
  for (const entry of compDays) {
    if (!compDayBlocksAssignment(entry)) continue;
    const location = locationOf(entry.personId);
    if (!location) continue;
    const date = effectiveCompDayDate(entry);
    spans.push({ personId: entry.personId, type: 'COMP_DAY', from: date, to: date, workdays: 1 });
  }

  return spans;
}

function checkAbsenceCapacity(params: ValidateParams): IssueDraft[] {
  const { absenceCapacityRules, index, range, unitId } = params;
  const drafts: IssueDraft[] = [];

  const rules = absenceCapacityRules.filter((rule) => rule.unitId === unitId);
  if (rules.length === 0) return drafts;

  const spans = absenceSpans(params);
  const peopleById = index.people;

  for (const date of eachDate(range)) {
    const active = spans.filter((span) => date >= span.from && date <= span.to);
    if (active.length === 0) continue;

    for (const rule of rules) {
      const matching = active.filter((span) => {
        if (!rule.countsTypes.includes(span.type)) return false;
        const isLong = span.workdays >= rule.longThresholdWorkdays;
        if (rule.durationBucket === 'LONG' && !isLong) return false;
        if (rule.durationBucket === 'SHORT' && isLong) return false;
        if (rule.scope.kind === 'UNIT') return true;
        const person: Person | undefined = peopleById.get(span.personId);
        const roleId = rule.scope.roleId;
        return person?.eligibility.some((e) => e.roleId === roleId) ?? false;
      });

      if (matching.length <= rule.maxConcurrent) continue;

      const scopeLabel =
        rule.scope.kind === 'UNIT'
          ? 'по единице'
          : `в пуле ${index.roles.get(rule.scope.roleId)?.code ?? rule.scope.roleId}`;
      const bucketLabel = rule.durationBucket === 'LONG' ? 'длительных' : 'коротких';

      drafts.push({
        level: 'WARNING',
        code: 'ABSENCE_CAPACITY_EXCEEDED',
        message: `${matching.length} ${bucketLabel} отсутствий ${scopeLabel} при лимите ${rule.maxConcurrent}`,
        date,
        ...(rule.scope.kind === 'ROLE_POOL' ? { roleId: rule.scope.roleId } : {}),
      });
    }
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// Целевые доли ролей
// ---------------------------------------------------------------------------

/** Ниже этого числа смен доли не считаются: статистики нет. */
const MIN_ASSIGNMENTS_FOR_SHARE = 5;
const SHARE_TOLERANCE = 0.25;

function checkTargetShares(params: ValidateParams): IssueDraft[] {
  const { index, range } = params;
  const drafts: IssueDraft[] = [];

  const byPerson = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();

  for (const assignment of unitAssignments(params)) {
    if (!rangeContains(range, assignment.date)) continue;
    let roleCounts = byPerson.get(assignment.personId);
    if (!roleCounts) {
      roleCounts = new Map<string, number>();
      byPerson.set(assignment.personId, roleCounts);
    }
    roleCounts.set(assignment.roleId, (roleCounts.get(assignment.roleId) ?? 0) + 1);
    totals.set(assignment.personId, (totals.get(assignment.personId) ?? 0) + 1);
  }

  for (const [personId, roleCounts] of byPerson) {
    const person = index.people.get(personId);
    const total = totals.get(personId) ?? 0;
    if (!person || total < MIN_ASSIGNMENTS_FOR_SHARE) continue;

    for (const eligibility of person.eligibility) {
      const actual = (roleCounts.get(eligibility.roleId) ?? 0) / total;
      const deviation = actual - eligibility.targetShare;
      if (Math.abs(deviation) <= SHARE_TOLERANCE) continue;
      const role = index.roles.get(eligibility.roleId);
      drafts.push({
        level: 'INFO',
        code: 'TARGET_SHARE_DEVIATION',
        message: `${person.displayName}: ${role?.code ?? eligibility.roleId} — факт ${(actual * 100).toFixed(0)}% при цели ${(eligibility.targetShare * 100).toFixed(0)}%`,
        personId,
        roleId: eligibility.roleId,
      });
    }
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// Истекающие отгулы
// ---------------------------------------------------------------------------

const EXPIRY_HORIZON_WEEKS = 4;

function checkExpiringCompDays(params: ValidateParams): IssueDraft[] {
  const { compDays, index, unitId, asOf } = params;
  const horizon = addDays(asOf, EXPIRY_HORIZON_WEEKS * 7);
  const drafts: IssueDraft[] = [];

  for (const entry of compDays) {
    if (entry.status !== 'PROPOSED' && entry.status !== 'SCHEDULED') continue;
    if (entry.expiresOn > horizon) continue;
    const person = index.people.get(entry.personId);
    if (!person || person.unitId !== unitId) continue;
    drafts.push({
      level: 'INFO',
      code: 'COMP_DAY_EXPIRING',
      message: `${person.displayName}: отгул за ${entry.earnedForDate} сгорает ${entry.expiresOn}`,
      date: effectiveCompDayDate(entry),
      personId: entry.personId,
    });
  }

  return drafts;
}
