/**
 * Одна локация на часовой пояс — если несколько локаций делят зону
 * (Hartford/New York, оба America/New_York), выигрывает первичная локация
 * какого-либо юнита: это узнаваемое имя для часов, а не то, что случайно
 * оказалось первым по порядку id. Общее между AppShell (шапка) и Overview
 * (таймлайн), чтобы правило не разъехалось между двумя местами.
 */

import type { Location } from '../domain/types.ts';

export function dedupeLocationsByZone(
  locations: readonly Location[],
  primaryLocationIds: ReadonlySet<string>,
): Location[] {
  const byZone = new Map<string, Location>();
  for (const location of locations) {
    const existing = byZone.get(location.timeZone);
    if (!existing || (!primaryLocationIds.has(existing.id) && primaryLocationIds.has(location.id))) {
      byZone.set(location.timeZone, location);
    }
  }
  return [...byZone.values()].sort((a, b) => a.timeZone.localeCompare(b.timeZone));
}
