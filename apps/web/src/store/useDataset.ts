/**
 * The dataset every screen reads: reference data, the published plan, the plan with
 * the open draft applied, and the index built over it.
 *
 * NOTE: **TanStack Query owns server state; the store owns the draft.** This hook is
 * where the two meet, and it is the only place they do.
 *
 * WHY it exists: `useSchedule` used to hold `reference`, `published`, `plan` and `index`
 * as its own fields — a second copy of what the query cache already had, kept in step by
 * a subscription at the bottom of `useSchedule.ts` that compared query keys by hand and
 * re-seeded the store on every successful fetch. Two stores of one thing, joined by a
 * bridge. The bridge worked, but everything had to remember it existed: a direct write
 * had to patch `published` *and* recompute `plan` *and* leave the cache alone, an
 * approval had to invalidate the right key or the grid silently kept the old answer, and
 * "which of these two is true right now" had no single answer.
 *
 * Now `published` is whatever the schedule query holds, and `plan` is a pure function of
 * it and the draft. Nothing has to be kept in step, because there is only one of it.
 *
 * `plan` is `published` with the draft's changes applied (ADR-0015): published data is
 * what everyone sees, the draft is this editor's ordered changes, and publishing is an
 * explicit action.
 */

import { useMemo } from 'react';
import { referenceQueryKey, useReferenceQuery, useScheduleQuery } from '../api/queries.ts';
import { queryClient } from '../api/queryClient.ts';
import { applyChanges } from '../domain/draft.ts';
import { datasetOf, publishedNow } from './datasetCache.ts';
import { buildIndex, type DatasetIndex } from '../domain/lookup.ts';
import type {
  DraftChange,
  PlanData,
  ReferenceData,
} from '../domain/types.ts';
import { useSchedule } from './useSchedule.ts';

export interface Dataset {
  readonly reference: ReferenceData | undefined;
  /** NOTE: What everyone sees — the server's answer, with no draft applied. */
  readonly published: PlanData | undefined;
  /** NOTE: `published` plus this editor's staged changes: what the grid draws. */
  readonly plan: PlanData | undefined;
  readonly index: DatasetIndex | undefined;
}


/**
 * NOTE: One derivation shared by every caller, memoized on input identity rather than
 * per component.
 *
 * WHY module scope: `applyChanges` + `buildIndex` walk the whole period, and sixteen
 * components read this. A `useMemo` inside each of them would run the same computation
 * sixteen times over identical inputs on every draft edit. The inputs are stable
 * references — query data is replaced only when it refetches, `changes` only when the
 * draft changes — so identity comparison is exact here, not a heuristic.
 */
let memo:
  | {
      reference: ReferenceData;
      published: PlanData;
      changes: readonly DraftChange[];
      plan: PlanData;
      index: DatasetIndex;
    }
  | undefined;

function derive(
  reference: ReferenceData,
  published: PlanData,
  changes: readonly DraftChange[],
): { plan: PlanData; index: DatasetIndex } {
  if (
    memo &&
    memo.reference === reference &&
    memo.published === published &&
    memo.changes === changes
  ) {
    return { plan: memo.plan, index: memo.index };
  }
  const plan = applyChanges(published, changes);
  const index = buildIndex(datasetOf(reference, plan));
  memo = { reference, published, changes, plan, index };
  return { plan, index };
}

/**
 * NOTE: Reference data on its own — units, locations, shifts, day configurations,
 * people, event and presence types.
 *
 * WHY separate from `useDataset`: most callers want a list of event types or the name of
 * a person, and subscribing them to the plan as well would re-render a dialog on every
 * painted cell.
 */
export function useReference(): ReferenceData | undefined {
  return useReferenceQuery().data;
}

/**
 * NOTE: The same answer as `useDataset()`, read once, outside React.
 *
 * For tests asserting on what the client currently holds — they used to reach into
 * `useSchedule.getState().plan`, which is no longer where it lives. Not for components:
 * this reads without subscribing, so a component using it would not re-render.
 */
export function datasetNow(): Dataset {
  const { unitId, range, session, changes } = useSchedule.getState();
  const reference = queryClient.getQueryData<ReferenceData>(referenceQueryKey);
  const published = publishedNow(unitId, range, session?.id);
  if (!reference || !published) {
    return { reference, published, plan: undefined, index: undefined };
  }
  const { plan, index } = derive(reference, published, changes);
  return { reference, published, plan, index };
}

export function useDataset(): Dataset {
  const unitId = useSchedule((s) => s.unitId);
  const range = useSchedule((s) => s.range);
  const sessionId = useSchedule((s) => s.session?.id);
  const changes = useSchedule((s) => s.changes);

  const reference = useReferenceQuery().data;
  // The same key `usePlanningView` reads, so this shares its cache entry rather than
  // firing a second request for the same period.
  const schedule = useScheduleQuery(unitId, range, sessionId).data;

  return useMemo(() => {
    // Read back through the cache rather than reshaping `schedule` here, so this and
    // `datasetNow()` hand out the *same* `published` object — `derive`'s memo compares
    // by identity, and two equal-but-separate objects would rebuild the index twice.
    const published = publishedNow(unitId, range, sessionId);
    if (!reference || !published) {
      return { reference, published, plan: undefined, index: undefined };
    }
    const { plan, index } = derive(reference, published, changes);
    return { reference, published, plan, index };
    // `schedule` is a dependency, not a value used directly: it is what changes when the
    // query refetches, and that is exactly when `publishedNow` has a new answer.
  }, [reference, schedule, changes, unitId, range, sessionId]);
}
