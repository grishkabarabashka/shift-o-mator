/**
 * Reading the dataset **synchronously**, outside React.
 *
 * `useDataset()` is the hook every screen uses; these are the same answers for callers
 * that are not components: the draft-sync timer in `useSchedule`, and tests asserting on
 * what the client currently holds.
 *
 * WHY its own module rather than living in either of those two: `useDataset` imports the
 * store (for the draft) and the store needs these readers, which would be a cycle. These
 * take everything they need as arguments and import neither.
 */

import { scheduleQueryKey, type ScheduleResponse } from '../api/queries.ts';
import { queryClient } from '../api/queryClient.ts';
import { applyChanges } from '../domain/draft.ts';
import type {
  DateRange,
  DraftChange,
  PlanData,
  ReferenceData,
  ScheduleDataset,
  UnitId,
} from '../domain/types.ts';

export function datasetOf(reference: ReferenceData, plan: PlanData): ScheduleDataset {
  return { ...reference, ...plan, history: [] };
}

/**
 * NOTE: A `ScheduleResponse` carries `plan` without `acknowledgements`, so turning it
 * into a `PlanData` allocates. Memoized on the response's identity, because callers
 * downstream compare `published` by reference to decide whether to recompute — a fresh
 * object per call would defeat that and rebuild the index on every read.
 */
let publishedMemo: { response: ScheduleResponse; published: PlanData } | undefined;

function publishedOf(response: ScheduleResponse): PlanData {
  if (publishedMemo?.response === response) return publishedMemo.published;
  // `acknowledgements` is deliberately empty: `GET /api/schedule` carries
  // `acknowledgedIssueKeys` instead, and `usePlanningView` reads that.
  const published: PlanData = { ...response.plan, acknowledgements: [] };
  publishedMemo = { response, published };
  return published;
}

/**
 * NOTE: The published plan as the query cache holds it right now.
 *
 * A draft's overlay is a separate cache entry from the plain period. When the overlay has
 * not been fetched yet the plain one is still the right published answer — the draft is
 * applied on top of it either way.
 */
export function publishedNow(
  unitId: UnitId | undefined,
  range: DateRange | undefined,
  sessionId: string | undefined,
): PlanData | undefined {
  const data =
    queryClient.getQueryData<ScheduleResponse>(scheduleQueryKey(unitId, range, sessionId)) ??
    queryClient.getQueryData<ScheduleResponse>(scheduleQueryKey(unitId, range, undefined));
  return data ? publishedOf(data) : undefined;
}

/** The plan with the open draft applied — what the grid draws. */
export function planNow(
  unitId: UnitId | undefined,
  range: DateRange | undefined,
  sessionId: string | undefined,
  changes: readonly DraftChange[],
): PlanData | undefined {
  const published = publishedNow(unitId, range, sessionId);
  return published ? applyChanges(published, changes) : undefined;
}
