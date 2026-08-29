/**
 * Which cells another planner is holding an unpublished edit on.
 *
 * WHY the product wants this: concurrent drafts are allowed on purpose (ADR-0015) and
 * resolve at publish, so nothing here blocks anybody. What was missing was the *warning*
 * — two planners could fill the same week each unaware of the other, and whoever published
 * first decided it. The banner said "somebody else has this period open", which is true
 * and useless; naming the cells is what lets the second planner work somewhere else.
 *
 * Polled rather than pushed. There is no socket in this product and adding one for an
 * advisory hint would be the most expensive thing on the page; a slow refresh is the right
 * fidelity for a fact that only ever means "maybe look at something else".
 */

import { useQuery } from '@tanstack/react-query';
import { apiGet, qs } from './client.ts';
import { cellKey } from '../domain/lookup.ts';
import type { DateRange, UnitId } from '../domain/types.ts';

interface WireStagedCell {
  readonly personId: string;
  readonly date: string;
  readonly editorPersonId: string;
  readonly editorName: string;
}

/** How often to re-ask. Long enough not to be traffic, short enough that "somebody
 * started editing here" surfaces while you are still on the screen. */
const REFRESH_MS = 30_000;

/**
 * Keyed by `cellKey(personId, date)`, the same as every other cell projection, holding
 * the editor's name — a string, because `GridCell` is memoized on primitives.
 */
export function useStagedCells(unitId: UnitId | undefined, range: DateRange | undefined) {
  const query = useQuery({
    queryKey: ['staged-cells', unitId ?? null, range?.from ?? null, range?.to ?? null],
    queryFn: async () => {
      const wire = await apiGet<{ cells: readonly WireStagedCell[] }>(
        `/api/drafts/staged${qs({ unitId, from: range?.from, to: range?.to })}`,
      );
      return new Map(wire.cells.map((c) => [cellKey(c.personId, c.date), c.editorName]));
    },
    enabled: range !== undefined,
    refetchInterval: REFRESH_MS,
    // Advisory: a stale answer is fine, an empty flash while refetching is not.
    placeholderData: (previous) => previous,
  });

  return query.data ?? EMPTY;
}

const EMPTY: ReadonlyMap<string, string> = new Map();
