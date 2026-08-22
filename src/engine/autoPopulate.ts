/**
 * Auto-populate — заполнение периода одним прогоном (Docs/06-generation.md).
 *
 * Два прохода, а не один список правил:
 *
 *   A. дефолты  — `defaultRoleId` человека на его обычный будний день;
 *   B. остаток  — то, что дефолты не закрыли, добирается ранжированием
 *                 (`rankCandidates`) до минимума требования.
 *
 * Раздельно потому, что это разные вопросы: «чья это обычная работа» решает
 * профиль человека, «кто закроет специальную/выходную роль» — справедливость
 * и davность. Слить их в один проход значило бы либо дать дефолту ранжирование
 * (и тогда «обычная работа» перестаёт быть предсказуемой), либо дать
 * ранжированию дефолт (и тогда специальные роли начинают доставаться тем, у
 * кого просто counted меньше — не тем, чья это работа).
 *
 * Никогда не трогает уже занятую ячейку — ни ролью, ни маркером, ни
 * заблокированную планировщиком. «Занято» значит принятое решение, а
 * автогенерация заполняет пустоты, а не переписывает чужой выбор.
 *
 * Детерминизм: даты по возрастанию, требования и люди — по стабильному id.
 * Тот же вход даёт тот же результат, иначе перезапуск после одной правки
 * перетасовывает весь месяц.
 */

import { assignmentChange, compDayChange } from '../domain/draft.ts';
import type { DatasetIndex } from '../domain/lookup.ts';
import type {
  Assignment,
  AssignmentId,
  DateRange,
  DraftChange,
  IsoDate,
  IsoInstant,
  PersonId,
  RegionId,
  RoleId,
} from '../domain/types.ts';
import { availabilityBlockReason, rankCandidates } from './candidates.ts';
import { proposeCompDays } from './compDays.ts';
import { eachDate, weekdayOf } from './dates.ts';
import { resolveDayConfiguration } from './dayConfig.ts';

export const AUTO_POPULATE_MAX_DAYS = 92;

export interface AutoPopulateGap {
  readonly date: IsoDate;
  readonly roleId: RoleId;
  readonly code: string;
  readonly reason: string;
}

export interface AutoPopulateResult {
  readonly changes: readonly DraftChange[];
  readonly gaps: readonly AutoPopulateGap[];
  readonly assignedCount: number;
}

export interface AutoPopulateParams {
  readonly regionId: RegionId;
  readonly range: DateRange;
  /** Ячейки, которые планировщик закрепил вручную — генерация их не видит. */
  readonly lockedAssignmentIds: ReadonlySet<AssignmentId>;
  readonly assignments: readonly Assignment[];
  readonly absences: readonly import('../domain/types.ts').Absence[];
  readonly compDays: readonly import('../domain/types.ts').CompDayEntry[];
  readonly index: DatasetIndex;
  readonly actorId: PersonId;
  readonly now: IsoInstant;
}

export function autoPopulate(params: AutoPopulateParams): AutoPopulateResult {
  const { regionId, range, lockedAssignmentIds, index, actorId, now } = params;
  const dates = eachDate(range);

  const locked = new Set(
    params.assignments.filter((a) => lockedAssignmentIds.has(a.id)).map(cellKey),
  );

  // Рабочая копия назначений: растёт по ходу прогона, чтобы справедливость и
  // давность на пятницу уже видели то, что сгенерировано в понедельник.
  const working = [...params.assignments];
  const occupied = new Set(working.map(cellKey));

  const changes: DraftChange[] = [];
  const gaps: AutoPopulateGap[] = [];
  let seq = 0;
  const nextSeq = () => {
    seq += 1;
    return seq;
  };

  const place = (personId: PersonId, date: IsoDate, roleId: RoleId): void => {
    const person = index.people.get(personId);
    const location = person ? index.locations.get(person.locationId) : undefined;
    const assignment: Assignment = {
      id: `as-gen-${date}-${personId}`,
      personId,
      date,
      regionId,
      content: { kind: 'ROLE', roleId },
      isWeekend: location ? isWeekendAt(date, location) : false,
      source: 'GENERATED',
      version: 0,
      createdBy: actorId,
      createdAt: now,
      updatedBy: actorId,
      updatedAt: now,
    };
    working.push(assignment);
    occupied.add(cellKey(assignment));
    changes.push(assignmentChange(null, assignment, nextSeq(), now));
  };

  const peopleInRegion = [...(index.peopleByRegion.get(regionId) ?? [])]
    .filter((p) => p.isIncluded)
    .sort((a, b) => a.id.localeCompare(b.id));

  // --- A. Дефолты -----------------------------------------------------------

  for (const date of dates) {
    const weekday = weekdayOf(date);
    const config = resolveDayConfiguration(regionId, date, index);
    if (!config) continue;
    const requiredRoles = new Set(config.roleRequirements.map((r) => r.roleId));

    for (const person of peopleInRegion) {
      const key = `${person.id}|${date}`;
      if (occupied.has(key) || locked.has(key)) continue;
      if (!person.defaultRoleId || !requiredRoles.has(person.defaultRoleId)) continue;
      if (!person.eligibility.some((e) => e.roleId === person.defaultRoleId)) continue;

      const blocked = availabilityBlockReason({
        person,
        date,
        weekday,
        absences: params.absences,
        compDays: params.compDays,
      });
      if (blocked) continue;

      place(person.id, date, person.defaultRoleId);
    }
  }

  // --- B. Остаток по ранжированию --------------------------------------------

  for (const date of dates) {
    const config = resolveDayConfiguration(regionId, date, index);
    if (!config) continue;

    const requirements = [...config.roleRequirements].sort((a, b) =>
      a.roleId.localeCompare(b.roleId),
    );

    for (const requirement of requirements) {
      let filled = working.filter(
        (a) =>
          a.date === date && a.content.kind === 'ROLE' && a.content.roleId === requirement.roleId,
      ).length;

      while (filled < requirement.min) {
        const busyToday = new Set(
          working.filter((a) => a.date === date).map((a) => a.personId),
        );
        const result = rankCandidates({
          roleId: requirement.roleId,
          date,
          regionId,
          index,
          assignments: working,
          absences: params.absences,
          compDays: params.compDays,
          excludePersonIds: busyToday,
        });

        const pick = result.available[0];
        if (!pick) {
          gaps.push({
            date,
            roleId: requirement.roleId,
            code: roleCode(index, requirement.roleId),
            reason: gapReason(result),
          });
          break;
        }

        place(pick.personId, date, requirement.roleId);
        filled += 1;
      }
    }
  }

  // --- Отгулы за только что созданные выходные/праздничные смены -------------

  const generatedIds = new Set(changes.map((c) => c.after?.id).filter((id): id is string => !!id));
  const compResult = proposeCompDays({
    range,
    assignments: working,
    absences: params.absences,
    existing: params.compDays,
    index,
    scopeAssignmentIds: generatedIds,
  });
  for (const entry of compResult.added) changes.push(compDayChange(null, entry, nextSeq(), now));

  return {
    changes,
    gaps,
    assignedCount: changes.filter((c) => c.targetType === 'ASSIGNMENT').length,
  };
}

function cellKey(a: Assignment): string {
  return `${a.personId}|${a.date}`;
}

function isWeekendAt(date: IsoDate, location: { weekendDays: readonly number[] }): boolean {
  const weekday = weekdayOf(date);
  return location.weekendDays.includes(weekday);
}

function roleCode(index: DatasetIndex, roleId: RoleId): string {
  return index.roles.get(roleId)?.code ?? roleId;
}

/** «3 eligible, all on leave» — а не молчаливая дыра (Docs/06). */
function gapReason(result: ReturnType<typeof rankCandidates>): string {
  if (result.excluded.length === 0) {
    return 'No one in this region is eligible for this role';
  }
  const counts = new Map<string, number>();
  for (const excluded of result.excluded) {
    counts.set(excluded.reason, (counts.get(excluded.reason) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([reason, count]) => `${count} ${reason}`);
  return `${result.excluded.length} eligible, ${parts.join(', ')}`;
}
