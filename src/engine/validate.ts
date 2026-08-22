/**
 * Валидация плана — ADR-0009.
 *
 * Три уровня, которые нельзя смешивать:
 *   BLOCKING — публикация невозможна;
 *   WARNING  — требует осознанного подтверждения с комментарием;
 *   INFO     — подсветка без блокировки.
 *
 * Две категории, которые в интерфейсе не сливаются:
 *   GAP      — не сделана работа: чинится назначением человека;
 *   CONFLICT — назначение противоречит другой записи: чинится снятием либо
 *              осознанным подтверждением.
 *
 * **Конфликт больше не блокирует** (ADR-0024). Человек, вышедший в свой
 * отпуск, и роль, отданная не по eligibility в аврал, — это решения, которые
 * принимают в реальности; система обязана их записать, подсветить и запомнить
 * причину, а не отказаться сохранять. Блокирующими остались только те записи,
 * которые не могут быть верны ни при каком решении: два назначения на один
 * день и роль, которой нет либо которая принадлежит чужому региону.
 *
 * Функция чистая: текущая дата приходит параметром `asOf`.
 */

import type { DatasetIndex } from '../domain/lookup.ts';
import { cellKey } from '../domain/lookup.ts';
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
  IssueCategory,
  IssueCode,
  IssueLevel,
  Location,
  Person,
  RegionId,
  UtcInterval,
} from '../domain/types.ts';
import {
  assignmentRoleId,
  compDayBlocksAssignment,
  compDayIsOutstanding,
  effectiveCompDayDate,
  isWorkingAssignment,
} from '../domain/types.ts';
import { compDayAge } from './compDays.ts';
import { resolveDayConfiguration } from './dayConfig.ts';
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
  readonly regionId: RegionId;
  readonly range: DateRange;
  readonly assignments: readonly Assignment[];
  readonly absences: readonly Absence[];
  readonly compDays: readonly CompDayEntry[];
  readonly coverageCells: readonly CoverageCell[];
  readonly absenceCapacityRules: readonly AbsenceCapacityRule[];
  readonly index: DatasetIndex;
  /** Дата отсчёта для возраста отгулов. */
  readonly asOf: IsoDate;
}

interface IssueDraft {
  readonly level: IssueLevel;
  readonly category: IssueCategory;
  readonly code: IssueCode;
  readonly message: string;
  readonly date?: IsoDate;
  readonly personId?: string;
  readonly roleId?: string;
}

function makeIssue(regionId: RegionId, draft: IssueDraft): Issue {
  const key = [draft.code, draft.date ?? '', draft.personId ?? '', draft.roleId ?? ''].join('|');
  return {
    key,
    level: draft.level,
    category: draft.category,
    code: draft.code,
    message: draft.message,
    regionId,
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
    ...checkCompDays(params),
  ];

  return drafts
    .map((draft) => makeIssue(params.regionId, draft))
    .sort((a, b) => {
      const byLevel = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
      if (byLevel !== 0) return byLevel;
      return (a.date ?? '').localeCompare(b.date ?? '') || a.key.localeCompare(b.key);
    });
}

export function acknowledgedKeys(acks: readonly Acknowledgement[]): Set<string> {
  return new Set(acks.map((ack) => ack.issueKey));
}

/** Можно ли публиковать: нет BLOCKING и все WARNING подтверждены. */
export function canPublish(
  issues: readonly Issue[],
  acknowledged: ReadonlySet<string>,
): boolean {
  return !issues.some(
    (issue) =>
      issue.level === 'BLOCKING' ||
      (issue.level === 'WARNING' && !acknowledged.has(issue.key)),
  );
}

export interface IssueSummary {
  readonly blocking: number;
  readonly gaps: number;
  readonly conflicts: number;
  readonly warning: number;
  readonly info: number;
  readonly unacknowledgedWarnings: number;
}

export function summarizeIssues(
  issues: readonly Issue[],
  acknowledged: ReadonlySet<string>,
): IssueSummary {
  let blocking = 0;
  let gaps = 0;
  let conflicts = 0;
  let warning = 0;
  let info = 0;
  let unacknowledgedWarnings = 0;

  for (const issue of issues) {
    // Категория считается независимо от уровня: конфликт остаётся конфликтом,
    // даже когда он подтверждаемый, а не блокирующий (ADR-0024).
    if (issue.category === 'CONFLICT') conflicts += 1;

    if (issue.level === 'BLOCKING') {
      blocking += 1;
      if (issue.category === 'GAP') gaps += 1;
    } else if (issue.level === 'INFO') {
      info += 1;
    } else {
      warning += 1;
      if (!acknowledged.has(issue.key)) unacknowledgedWarnings += 1;
    }
  }
  return { blocking, gaps, conflicts, warning, info, unacknowledgedWarnings };
}

// ---------------------------------------------------------------------------
// Покрытие
// ---------------------------------------------------------------------------

function checkCoverage({ coverageCells, index }: ValidateParams): IssueDraft[] {
  const drafts: IssueDraft[] = [];
  for (const cell of coverageCells) {
    const code = index.roles.get(cell.roleId)?.code ?? cell.roleId;
    const label = cell.ruleLabel ? ` (${cell.ruleLabel})` : '';

    if (cell.level === 'GAP') {
      drafts.push({
        level: 'BLOCKING',
        category: 'GAP',
        code: 'COVERAGE_GAP',
        message: `${code}${label}: ${cell.actual} assigned, minimum is ${cell.min}`,
        date: cell.date,
        roleId: cell.roleId,
      });
    } else if (cell.level === 'THIN') {
      // INFO, не WARNING: работа впритык — норма, а не отклонение. Большинство
      // дней закрыто ровно по минимуму, и требовать письменного обоснования на
      // каждый такой день значит сделать публикацию невозможной. Сигнал ценен
      // как цвет в полосе покрытия, а не как блокер.
      drafts.push({
        level: 'INFO',
        category: 'GAP',
        code: 'COVERAGE_THIN',
        message: `${code}${label}: ${cell.actual} assigned, exactly at the minimum — no slack`,
        date: cell.date,
        roleId: cell.roleId,
      });
    } else if (cell.level === 'OVER' && cell.max !== undefined) {
      drafts.push({
        level: 'WARNING',
        category: 'POLICY',
        code: 'COVERAGE_OVER_MAX',
        message: `${code}${label}: ${cell.actual} assigned, maximum is ${cell.max}`,
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

function regionAssignments(params: ValidateParams): Assignment[] {
  const { assignments, index, regionId } = params;
  return assignments.filter((assignment) => {
    const person = index.people.get(assignment.personId);
    return person !== undefined && person.regionId === regionId;
  });
}

function checkAssignments(params: ValidateParams): IssueDraft[] {
  const { range, absences, compDays, index, regionId } = params;
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
    const date = effectiveCompDayDate(entry);
    if (date !== undefined) blockingCompDays.set(cellKey(entry.personId, date), entry);
  }

  const seenCell = new Set<string>();

  for (const assignment of regionAssignments(params)) {
    if (!rangeContains(range, assignment.date)) continue;
    const person = index.people.get(assignment.personId);
    if (!person) continue;

    const key = cellKey(person.id, assignment.date);
    if (seenCell.has(key)) {
      drafts.push({
        level: 'BLOCKING',
        category: 'CONFLICT',
        code: 'DOUBLE_ASSIGNMENT',
        message: `${person.displayName}: more than one assignment on the same day`,
        date: assignment.date,
        personId: person.id,
      });
    }
    seenCell.add(key);

    if (!isWorkingAssignment(assignment)) continue;

    const roleId = assignmentRoleId(assignment);
    const role = roleId !== undefined ? index.roles.get(roleId) : undefined;

    if (!role) {
      drafts.push({
        level: 'BLOCKING',
        category: 'CONFLICT',
        code: 'ROLE_OUTSIDE_REGION',
        message: `Role ${roleId ?? '?'} does not exist`,
        date: assignment.date,
        personId: person.id,
      });
      continue;
    }

    if (role.regionId !== person.regionId) {
      drafts.push({
        level: 'BLOCKING',
        category: 'CONFLICT',
        code: 'ROLE_OUTSIDE_REGION',
        message: `${person.displayName}: role ${role.code} belongs to another region`,
        date: assignment.date,
        personId: person.id,
        roleId: role.id,
      });
    } else if (!person.eligibility.some((e) => e.roleId === role.id)) {
      // Не блокер: аврал закрывают тем, кто есть, и осознанный отход от
      // eligibility допустим, если он подтверждён (ADR-0024).
      drafts.push({
        level: 'WARNING',
        category: 'CONFLICT',
        code: 'ROLE_NOT_ELIGIBLE',
        message: `${person.displayName}: role ${role.code} is outside their eligibility`,
        date: assignment.date,
        personId: person.id,
        roleId: role.id,
      });
    } else {
      const config = resolveDayConfiguration(regionId, assignment.date, index);
      const inConfig = config?.roleRequirements.some((r) => r.roleId === role.id) ?? false;
      if (!inConfig) {
        drafts.push({
          level: 'WARNING',
          category: 'POLICY',
          code: 'ROLE_NOT_IN_DAY_CONFIG',
          message: `${person.displayName}: role ${role.code} is not part of this day's configuration`,
          date: assignment.date,
          personId: person.id,
          roleId: role.id,
        });
      }
    }

    const absence = (absencesByPerson.get(person.id) ?? []).find(
      (a) => assignment.date >= a.from && assignment.date <= a.to,
    );
    if (absence) {
      // Не блокер: человек выходит в свой отпуск, либо запись об отсутствии
      // устарела. И то и другое разрешает планировщик, а не валидатор.
      drafts.push({
        level: 'WARNING',
        category: 'CONFLICT',
        code: 'ASSIGNED_DURING_ABSENCE',
        message: `${person.displayName}: assigned during ${absenceLabel(absence.type)}`,
        date: assignment.date,
        personId: person.id,
        roleId: role.id,
      });
    }

    if (blockingCompDays.has(key)) {
      // Не блокер: отгул переносится. Запись остаётся видимой, чтобы долг не
      // потерялся — comp day не сгорает (ADR-0007).
      drafts.push({
        level: 'WARNING',
        category: 'CONFLICT',
        code: 'ASSIGNED_DURING_COMP_DAY',
        message: `${person.displayName}: assigned on a confirmed comp day`,
        date: assignment.date,
        personId: person.id,
        roleId: role.id,
      });
    }

    if (!person.availableWeekdays.includes(weekdayOf(assignment.date))) {
      drafts.push({
        level: 'WARNING',
        category: 'POLICY',
        code: 'UNAVAILABLE_WEEKDAY',
        message: `${person.displayName}: weekday outside availability`,
        date: assignment.date,
        personId: person.id,
        roleId: role.id,
      });
    }

    if (person.preferences?.avoidsWeekdays?.includes(weekdayOf(assignment.date))) {
      drafts.push({
        level: 'INFO',
        category: 'POLICY',
        code: 'PREFERENCE_VIOLATED',
        message: `${person.displayName}: a day this person prefers to avoid`,
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
      return 'vacation';
    case 'SICK':
      return 'sick leave';
    case 'OTHER':
      return 'an absence';
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
  for (const assignment of regionAssignments(params)) {
    const roleId = assignmentRoleId(assignment);
    if (roleId === undefined) continue;
    const role = index.roles.get(roleId);
    if (!role) continue;
    let interval: UtcInterval;
    try {
      const override =
        assignment.content.kind === 'ROLE' ? assignment.content.timeOverride : undefined;
      interval = shiftInterval(role, assignment.date, override);
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
        category: 'POLICY',
        code: 'MIN_REST_VIOLATED',
        message: `${person.displayName}: ${rest.toFixed(1)}h rest, minimum is ${person.constraints.minRestHours}h`,
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
  for (const assignment of regionAssignments(params)) {
    if (!isWorkingAssignment(assignment)) continue;
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
            category: 'POLICY',
            code: 'CONSECUTIVE_DAYS_EXCEEDED',
            message: `${person.displayName}: ${runLength} consecutive days, limit is ${limit} (since ${runStart})`,
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

const QUARTER_WINDOW_DAYS = 91;

function checkWeekendLoad(params: ValidateParams): IssueDraft[] {
  const { index, range } = params;
  const drafts: IssueDraft[] = [];

  const datesByPerson = new Map<string, IsoDate[]>();
  for (const assignment of regionAssignments(params)) {
    if (!isWorkingAssignment(assignment)) continue;
    const bucket = datesByPerson.get(assignment.personId);
    if (bucket) bucket.push(assignment.date);
    else datesByPerson.set(assignment.personId, [assignment.date]);
  }

  for (const [personId, dates] of datesByPerson) {
    const person = index.people.get(personId);
    const limit = person?.constraints.maxWeekendsPerQuarter;
    if (!person || limit === undefined) continue;
    const location = index.locations.get(person.locationId);
    if (!location) continue;

    const weekendDates = dates.filter((date) => isWeekendIn(date, location)).sort();
    for (const date of weekendDates) {
      if (!rangeContains(range, date)) continue;
      const windowStart = addDays(date, -(QUARTER_WINDOW_DAYS - 1));
      const inWindow = weekendDates.filter((d) => d >= windowStart && d <= date).length;
      if (inWindow > limit) {
        drafts.push({
          level: 'WARNING',
          category: 'FAIRNESS',
          code: 'WEEKEND_LOAD_EXCEEDED',
          message: `${person.displayName}: ${inWindow} weekend days this quarter, target is ${limit}`,
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
  readonly type: Absence['type'] | 'COMP_DAY';
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly workdays: number;
}

function absenceSpans(params: ValidateParams): AbsenceSpan[] {
  const { absences, compDays, index, regionId } = params;
  const spans: AbsenceSpan[] = [];

  const locationOf = (personId: string): Location | undefined => {
    const person = index.people.get(personId);
    if (!person || person.regionId !== regionId) return undefined;
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
    if (date === undefined) continue;
    spans.push({ personId: entry.personId, type: 'COMP_DAY', from: date, to: date, workdays: 1 });
  }

  return spans;
}

function checkAbsenceCapacity(params: ValidateParams): IssueDraft[] {
  const { absenceCapacityRules, index, range, regionId } = params;
  const drafts: IssueDraft[] = [];

  const rules = absenceCapacityRules.filter((rule) => rule.regionId === regionId);
  if (rules.length === 0) return drafts;

  const spans = absenceSpans(params);

  for (const date of eachDate(range)) {
    const active = spans.filter((span) => date >= span.from && date <= span.to);
    if (active.length === 0) continue;

    for (const rule of rules) {
      const matching = active.filter((span) => {
        if (span.type === 'COMP_DAY') {
          if (!rule.countsCompDays) return false;
        } else if (!rule.countsTypes.includes(span.type)) {
          return false;
        }
        const isLong = span.workdays >= rule.longThresholdWorkdays;
        if (rule.durationBucket === 'LONG' && !isLong) return false;
        if (rule.durationBucket === 'SHORT' && isLong) return false;
        if (rule.scope.kind === 'REGION') return true;
        const person: Person | undefined = index.people.get(span.personId);
        const roleId = rule.scope.roleId;
        return person?.eligibility.some((e) => e.roleId === roleId) ?? false;
      });

      if (matching.length <= rule.maxConcurrent) continue;

      const scopeLabel =
        rule.scope.kind === 'REGION'
          ? 'region-wide'
          : `in the ${index.roles.get(rule.scope.roleId)?.code ?? rule.scope.roleId} pool`;
      const bucketLabel = rule.durationBucket === 'LONG' ? 'long' : 'short';

      drafts.push({
        level: 'WARNING',
        category: 'POLICY',
        code: 'ABSENCE_CAPACITY_EXCEEDED',
        message: `${matching.length} ${bucketLabel} absences ${scopeLabel}, limit is ${rule.maxConcurrent}`,
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

  for (const assignment of regionAssignments(params)) {
    if (!rangeContains(range, assignment.date)) continue;
    const roleId = assignmentRoleId(assignment);
    if (roleId === undefined) continue;
    let roleCounts = byPerson.get(assignment.personId);
    if (!roleCounts) {
      roleCounts = new Map<string, number>();
      byPerson.set(assignment.personId, roleCounts);
    }
    roleCounts.set(roleId, (roleCounts.get(roleId) ?? 0) + 1);
    totals.set(assignment.personId, (totals.get(assignment.personId) ?? 0) + 1);
  }

  for (const [personId, roleCounts] of byPerson) {
    const person = index.people.get(personId);
    const total = totals.get(personId) ?? 0;
    if (!person || total < MIN_ASSIGNMENTS_FOR_SHARE) continue;

    for (const eligibility of person.eligibility) {
      const actual = (roleCounts.get(eligibility.roleId) ?? 0) / total;
      if (Math.abs(actual - eligibility.targetShare) <= SHARE_TOLERANCE) continue;
      const role = index.roles.get(eligibility.roleId);
      drafts.push({
        level: 'INFO',
        category: 'FAIRNESS',
        code: 'TARGET_SHARE_DEVIATION',
        message: `${person.displayName}: ${role?.code ?? eligibility.roleId} — actual ${(actual * 100).toFixed(0)}% vs target ${(eligibility.targetShare * 100).toFixed(0)}%`,
        personId,
        roleId: eligibility.roleId,
      });
    }
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// Отгулы
// ---------------------------------------------------------------------------

function checkCompDays(params: ValidateParams): IssueDraft[] {
  const { compDays, index, regionId, asOf } = params;
  const drafts: IssueDraft[] = [];

  for (const entry of compDays) {
    const person = index.people.get(entry.personId);
    if (!person || person.regionId !== regionId) continue;
    const region = index.regions.get(person.regionId);
    if (!region) continue;

    if (entry.status === 'PENDING_APPROVAL') {
      drafts.push({
        level: 'WARNING',
        category: 'POLICY',
        code: 'COMP_DAY_PENDING_APPROVAL',
        message: `${person.displayName}: comp day for ${entry.earnedForDate} has no valid slot and needs approval`,
        date: entry.earnedForDate,
        personId: entry.personId,
      });
      continue;
    }

    if (!compDayIsOutstanding(entry)) continue;
    const age = compDayAge(entry, asOf);
    if (age <= region.compOffPolicy.agingThresholdDays) continue;

    drafts.push({
      level: 'INFO',
      category: 'POLICY',
      code: 'COMP_DAY_AGING',
      message: `${person.displayName}: comp day earned ${entry.earnedForDate} has been outstanding ${age} days`,
      ...(effectiveCompDayDate(entry) !== undefined
        ? { date: effectiveCompDayDate(entry) as IsoDate }
        : {}),
      personId: entry.personId,
    });
  }

  return drafts;
}
