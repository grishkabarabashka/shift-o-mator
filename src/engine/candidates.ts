/**
 * Кандидаты на роль в дне — общее ядро Suggest и Auto-populate (Docs/06).
 *
 * Два фильтра обязательны, дальше — только порядок:
 *
 *   1. eligibility  — роль есть в списке человека;
 *   2. availability — не отпуск, не подтверждённый отгул, не blackout, будний
 *                      день внутри `availableWeekdays`, день ещё свободен.
 *
 * Прошедшие оба сортируются:
 *
 *   3. справедливость за 90 дней — у кого меньше этой роли, тот выше;
 *   4. давность — кто держал роль недавно, отодвигается;
 *   5. личные лимиты — превышение `maxWeekendsPerQuarter` или `maxPerWeek`
 *      понижает, а не исключает: это подсказка планировщику, а не запрет.
 *
 * Функция чистая и детерминированная: одинаковый вход даёт одинаковый порядок
 * при перезапуске, иначе повторный прогон генерации перетасовывал бы месяц
 * заново от одной правки.
 */

import type { DatasetIndex } from '../domain/lookup.ts';
import type {
  Absence,
  Assignment,
  CompDayEntry,
  IsoDate,
  Person,
  RegionId,
  RoleId,
  Weekday,
} from '../domain/types.ts';
import { compDayBlocksAssignment, effectiveCompDayDate } from '../domain/types.ts';
import { addDays, isWeekendIn, weekdayOf } from './dates.ts';

const FAIRNESS_WINDOW_DAYS = 90;
const WEEKEND_LOAD_WINDOW_DAYS = 84; // 12 недель — окно из примера в Docs/06.

export interface Candidate {
  readonly personId: string;
  readonly name: string;
  readonly roleCountLast90: number;
  /** `undefined` — роль этот человек ещё не держал. */
  readonly daysSinceLastHeld: number | undefined;
  readonly weekendLoad: number;
  readonly warnings: readonly string[];
}

export interface ExcludedCandidate {
  readonly personId: string;
  readonly name: string;
  readonly reason: string;
}

export interface CandidateResult {
  /** Отсортированы: лучший выбор первым. */
  readonly available: readonly Candidate[];
  readonly excluded: readonly ExcludedCandidate[];
  /** Среднее по команде за окно — контекст для «3 против среднего 4.2». */
  readonly teamWeekendAverage: number;
}

export interface RankCandidatesParams {
  readonly roleId: RoleId;
  readonly date: IsoDate;
  readonly regionId: RegionId;
  readonly index: DatasetIndex;
  readonly assignments: readonly Assignment[];
  readonly absences: readonly Absence[];
  readonly compDays: readonly CompDayEntry[];
  /** Люди, уже занятые чем-то в этот день, — исключаются без объяснения:
   * это не недоступность, это уже принятое решение по другому вопросу. */
  readonly excludePersonIds?: ReadonlySet<string>;
}

export function rankCandidates(params: RankCandidatesParams): CandidateResult {
  const { roleId, date, regionId, index, assignments, absences, compDays, excludePersonIds } =
    params;

  const pool = [...index.people.values()].filter(
    (person) =>
      person.regionId === regionId &&
      person.isIncluded &&
      person.eligibility.some((e) => e.roleId === roleId),
  );

  const weekday = weekdayOf(date);
  const fairnessSince = addDays(date, -FAIRNESS_WINDOW_DAYS);
  const weekendSince = addDays(date, -WEEKEND_LOAD_WINDOW_DAYS);
  const location = (personId: string) =>
    index.locations.get(index.people.get(personId)?.locationId ?? '');

  const available: Candidate[] = [];
  const excluded: ExcludedCandidate[] = [];
  const weekendLoads: number[] = [];

  for (const person of pool) {
    // Занят другой ролью в этот же день — не «не eligible». Раньше такие
    // отсеивались без следа, и «1 eligible, all on leave» превращалось в
    // враньё «нет никого eligible вообще», как только единственный подходящий
    // человек уже стоял на другой смене. Docs/06 требует честную причину —
    // это и есть причина, просто другая.
    if (excludePersonIds?.has(person.id)) {
      excluded.push({
        personId: person.id,
        name: person.displayName,
        reason: 'already assigned to something else that day',
      });
      continue;
    }

    const reason = availabilityBlockReason({ person, date, weekday, absences, compDays });
    if (reason) {
      excluded.push({ personId: person.id, name: person.displayName, reason });
      continue;
    }

    const own = (assignments as readonly Assignment[]).filter((a) => a.personId === person.id);
    const roleCountLast90 = own.filter(
      (a) =>
        a.content.kind === 'ROLE' &&
        a.content.roleId === roleId &&
        a.date >= fairnessSince &&
        a.date < date,
    ).length;

    const lastHeld = own
      .filter((a) => a.content.kind === 'ROLE' && a.content.roleId === roleId && a.date < date)
      .map((a) => a.date)
      .sort()
      .at(-1);
    const daysSinceLastHeld = lastHeld ? daysBetweenDates(lastHeld, date) : undefined;

    const loc = location(person.id);
    const weekendLoad = loc
      ? own.filter(
          (a) => a.date >= weekendSince && a.date < date && isWeekendIn(a.date, loc),
        ).length
      : 0;
    weekendLoads.push(weekendLoad);

    const warnings: string[] = [];
    const eligibility = person.eligibility.find((e) => e.roleId === roleId);
    const isWeekendDate = loc ? isWeekendIn(date, loc) : false;

    if (isWeekendDate && person.constraints.maxWeekendsPerQuarter !== undefined) {
      const quarterCount = own.filter(
        (a) => loc && isWeekendIn(a.date, loc) && sameQuarter(a.date, date),
      ).length;
      if (quarterCount >= person.constraints.maxWeekendsPerQuarter) {
        warnings.push(
          `would exceed ${person.constraints.maxWeekendsPerQuarter} weekends this quarter`,
        );
      }
    }

    if (eligibility?.maxPerWeek !== undefined) {
      const weekCount = own.filter((a) => sameIsoWeek(a.date, date)).length;
      if (weekCount >= eligibility.maxPerWeek) {
        warnings.push(`would exceed ${eligibility.maxPerWeek} shifts this week`);
      }
    }

    if (person.preferences?.avoidsWeekdays?.includes(weekday)) {
      warnings.push('prefers to avoid this weekday');
    }

    available.push({
      personId: person.id,
      name: person.displayName,
      roleCountLast90,
      daysSinceLastHeld,
      weekendLoad,
      warnings,
    });
  }

  available.sort((a, b) => {
    // Меньше — важнее: сначала кто реже держал роль в окне.
    if (a.roleCountLast90 !== b.roleCountLast90) return a.roleCountLast90 - b.roleCountLast90;
    // Дальше — кто держал её давнее (или никогда): недавний держатель отодвигается.
    const aRecency = a.daysSinceLastHeld ?? Number.POSITIVE_INFINITY;
    const bRecency = b.daysSinceLastHeld ?? Number.POSITIVE_INFINITY;
    if (aRecency !== bRecency) return bRecency - aRecency;
    // Предупреждения понижают, но не исключают.
    if (a.warnings.length !== b.warnings.length) return a.warnings.length - b.warnings.length;
    // Устойчивый порядок на полном равенстве — иначе сортировка недетерминирована.
    return a.personId.localeCompare(b.personId);
  });

  const teamWeekendAverage =
    weekendLoads.length > 0
      ? Math.round((weekendLoads.reduce((sum, n) => sum + n, 0) / weekendLoads.length) * 10) / 10
      : 0;

  return { available, excluded, teamWeekendAverage };
}

/**
 * Хард-фильтр доступности, отдельно от eligibility.
 *
 * Экспортирована: автогенерация переиспользует ровно эту проверку для
 * дефолтных ролей, а не пишет вторую версию правил «отпуск/отгул/blackout/
 * будний день», которая рано или поздно разойдётся с этой.
 */
export function availabilityBlockReason(params: {
  readonly person: Person;
  readonly date: IsoDate;
  readonly weekday: Weekday;
  readonly absences: readonly Absence[];
  readonly compDays: readonly CompDayEntry[];
}): string | undefined {
  const { person, date, weekday, absences, compDays } = params;

  const absence = absences.find(
    (a) => a.personId === person.id && date >= a.from && date <= a.to,
  );
  if (absence) return absenceReasonLabel(absence.type);

  const onCompDay = compDays.some(
    (entry) =>
      entry.personId === person.id &&
      compDayBlocksAssignment(entry) &&
      effectiveCompDayDate(entry) === date,
  );
  if (onCompDay) return 'on a confirmed comp day';

  if (person.preferences?.blackoutDates?.includes(date)) return 'blackout date';

  if (!person.availableWeekdays.includes(weekday)) return 'not available this weekday';

  return undefined;
}

function absenceReasonLabel(type: Absence['type']): string {
  switch (type) {
    case 'VACATION':
      return 'on leave';
    case 'SICK':
      return 'out sick';
    default:
      return 'absent';
  }
}

function daysBetweenDates(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function sameIsoWeek(a: IsoDate, b: IsoDate): boolean {
  return isoWeekKey(a) === isoWeekKey(b);
}

function isoWeekKey(date: IsoDate): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-${week}`;
}

function sameQuarter(a: IsoDate, b: IsoDate): boolean {
  const qa = Math.floor((Number(a.slice(5, 7)) - 1) / 3);
  const qb = Math.floor((Number(b.slice(5, 7)) - 1) / 3);
  return a.slice(0, 4) === b.slice(0, 4) && qa === qb;
}
