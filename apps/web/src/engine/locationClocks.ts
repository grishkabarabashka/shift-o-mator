/**
 * NOTE: One location per timezone — if several locations share a zone
 * (Hartford/New York, both America/New_York), the primary location of some
 * unit wins: it's a recognizable name for the clock, not whatever happened
 * to come first by id order. Shared between AppShell (header) and Overview
 * (timeline) so the rule doesn't drift between the two places.
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
