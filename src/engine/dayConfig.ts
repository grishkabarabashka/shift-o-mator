/**
 * Разрешение конфигурации дня.
 *
 * Две независимые вещи решаются здесь и больше нигде:
 *
 * 1. **Какая группа дней применяется** — ADR-0016. Порядок от частного к
 *    общему: DATE → HOLIDAY → WEEKEND → будняя группа с этим днём недели.
 *    Праздничность считается по календарю *первичной локации региона*,
 *    а не локации человека: это требование к ростеру, а не к человеку.
 *
 * 2. **Какая версия конфигурации действует** — ADR-0021. Берётся версия с
 *    наибольшей `effectiveFrom`, не превышающей дату. Правило, поднятое
 *    сегодня, не перекрашивает прошлый март.
 */

import type { DatasetIndex } from '../domain/lookup.ts';
import type {
  DayConfigKey,
  DayConfiguration,
  IsoDate,
  RegionId,
  RoleId,
  RoleRequirement,
  Weekday,
} from '../domain/types.ts';
import { isWeekendIn, weekdayOf } from './dates.ts';

/** Приоритет группы: чем больше, тем частнее. */
const KEY_PRIORITY: Record<DayConfigKey, number> = {
  date: 4,
  holiday: 3,
  weekend: 2,
  friday: 1,
  weekday: 0,
};

function isApplicable(
  config: DayConfiguration,
  date: IsoDate,
  weekday: Weekday,
  isHoliday: boolean,
  isWeekend: boolean,
): boolean {
  switch (config.key) {
    case 'date':
      return config.date === date;
    case 'holiday':
      return isHoliday;
    case 'weekend':
      return isWeekend && config.weekdays.includes(weekday);
    case 'friday':
    case 'weekday':
      return !isHoliday && !isWeekend && config.weekdays.includes(weekday);
  }
}

/**
 * Действующая конфигурация региона на дату, с учётом версионирования.
 * `undefined` означает, что требований на этот день нет вовсе.
 */
export function resolveDayConfiguration(
  regionId: RegionId,
  date: IsoDate,
  index: DatasetIndex,
): DayConfiguration | undefined {
  const region = index.regions.get(regionId);
  if (!region) return undefined;
  const primaryLocation = index.locations.get(region.primaryLocationId);
  if (!primaryLocation) return undefined;

  const weekday = weekdayOf(date);
  const isHoliday = index.holidaysByLocation.get(primaryLocation.id)?.has(date) ?? false;
  const isWeekend = isWeekendIn(date, primaryLocation);

  const candidates = (index.dayConfigsByRegion.get(regionId) ?? []).filter(
    (config) =>
      config.effectiveFrom <= date && isApplicable(config, date, weekday, isHoliday, isWeekend),
  );
  if (candidates.length === 0) return undefined;

  // Сначала самая частная группа, внутри неё — самая поздняя действующая версия.
  let best = candidates[0] as DayConfiguration;
  for (const candidate of candidates.slice(1)) {
    const byPriority = KEY_PRIORITY[candidate.key] - KEY_PRIORITY[best.key];
    if (byPriority > 0) {
      best = candidate;
      continue;
    }
    if (byPriority === 0 && candidate.effectiveFrom > best.effectiveFrom) best = candidate;
  }
  return best;
}

/** Требование к конкретной роли на дату, если оно есть. */
export function resolveRequirement(
  regionId: RegionId,
  roleId: RoleId,
  date: IsoDate,
  index: DatasetIndex,
): RoleRequirement | undefined {
  return resolveDayConfiguration(regionId, date, index)?.roleRequirements.find(
    (requirement) => requirement.roleId === roleId,
  );
}

/**
 * Роли, которые вообще можно поставить в этот день: те, у которых есть
 * требование или флаг `isDefault`. Пикер ячейки показывает пересечение этого
 * набора с eligibility человека.
 */
export function rolesAvailableOn(
  regionId: RegionId,
  date: IsoDate,
  index: DatasetIndex,
): RoleId[] {
  const config = resolveDayConfiguration(regionId, date, index);
  if (!config) return [];
  return config.roleRequirements
    .filter((requirement) => requirement.min > 0 || requirement.isDefault || requirement.max !== 0)
    .map((requirement) => requirement.roleId);
}

/** Проверка целостности конфигурации: день недели в двух будних группах. */
export function findWeekdayCollisions(configs: readonly DayConfiguration[]): string[] {
  const problems: string[] = [];
  const byRegionAndVersion = new Map<string, Map<Weekday, DayConfigKey[]>>();

  for (const config of configs) {
    if (config.key !== 'weekday' && config.key !== 'friday') continue;
    const bucketKey = `${config.regionId}|${config.effectiveFrom}`;
    let byWeekday = byRegionAndVersion.get(bucketKey);
    if (!byWeekday) {
      byWeekday = new Map<Weekday, DayConfigKey[]>();
      byRegionAndVersion.set(bucketKey, byWeekday);
    }
    for (const weekday of config.weekdays) {
      const keys = byWeekday.get(weekday) ?? [];
      keys.push(config.key);
      byWeekday.set(weekday, keys);
    }
  }

  for (const [bucketKey, byWeekday] of byRegionAndVersion) {
    for (const [weekday, keys] of byWeekday) {
      if (keys.length > 1) {
        problems.push(`${bucketKey}: weekday ${weekday} belongs to ${keys.join(' and ')}`);
      }
    }
  }
  return problems;
}
