/**
 * `GET /api/schedule` — the one query that lets coverage, issues and resolved
 * day configurations stay entirely server-computed while still reflecting a
 * draft's uncommitted edits (optional `draftId`). `usePlanningView` reads this
 * directly instead of resolving day configurations/coverage/validation itself
 * (Phase 5 step 4 — those engines are deleted, ported to the backend).
 *
 * `useSchedule.load()` (Zustand) shares the same query — same cache entry — to
 * seed `published`/`plan`, so opening the page fetches the range once, not
 * twice for two different consumers of the same response.
 */

import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { apiGet, qs } from './client.ts';
import {
  absenceFromWire,
  assignmentFromWire,
  compDayFromWire,
  coverageCellFromWire,
  pendingRequestFromWire,
  presenceFromWire,
  issueFromWire,
  referenceFromWire,
  resolvedDayConfigFromWire,
  type ResolvedDayConfig,
  type WireReferenceData,
} from './mapping.ts';
import type { PendingRequest } from '../engine/requests.ts';
import type {
  Absence,
  Assignment,
  CompDayEntry,
  CoverageCell,
  DateRange,
  DraftSessionId,
  Issue,
  PresenceRecord,
  ReferenceData,
  UnitId,
} from '../domain/types.ts';

export interface ScheduleResponse {
  readonly unitIds: readonly UnitId[];
  readonly plan: {
    readonly assignments: readonly Assignment[];
    readonly absences: readonly Absence[];
    readonly compDays: readonly CompDayEntry[];
    readonly presence: readonly PresenceRecord[];
  };
  readonly coverage: readonly CoverageCell[];
  readonly issues: readonly Issue[];
  readonly acknowledgedIssueKeys: readonly string[];
  readonly dayConfigurations: readonly ResolvedDayConfig[];
  readonly pendingRequests: readonly PendingRequest[];
}

interface WireScheduleResponse {
  readonly unitIds: readonly string[];
  readonly plan: {
    readonly assignments: readonly Parameters<typeof assignmentFromWire>[0][];
    readonly absences: readonly Parameters<typeof absenceFromWire>[0][];
    readonly compDays: readonly Parameters<typeof compDayFromWire>[0][];
    readonly presence?: readonly Parameters<typeof presenceFromWire>[0][];
  };
  readonly coverage: readonly Parameters<typeof coverageCellFromWire>[0][];
  readonly issues: readonly Parameters<typeof issueFromWire>[0][];
  readonly acknowledgedIssueKeys: readonly string[];
  readonly dayConfigurations: readonly Parameters<typeof resolvedDayConfigFromWire>[0][];
  readonly pendingRequests?: readonly Parameters<typeof pendingRequestFromWire>[0][];
}

async function fetchSchedule(
  unitId: UnitId,
  range: DateRange,
  draftId: DraftSessionId | undefined,
): Promise<ScheduleResponse> {
  const wire = await apiGet<WireScheduleResponse>(
    `/api/schedule${qs({ unitId, from: range.from, to: range.to, draftId })}`,
  );
  return {
    unitIds: wire.unitIds,
    plan: {
      assignments: wire.plan.assignments.map(assignmentFromWire),
      absences: wire.plan.absences.map(absenceFromWire),
      compDays: wire.plan.compDays.map(compDayFromWire),
      // Optional on the wire so a client can talk to an API that predates ADR-0043.
      presence: (wire.plan.presence ?? []).map(presenceFromWire),
    },
    coverage: wire.coverage.map(coverageCellFromWire),
    issues: wire.issues.map(issueFromWire),
    acknowledgedIssueKeys: wire.acknowledgedIssueKeys,
    dayConfigurations: wire.dayConfigurations.map(resolvedDayConfigFromWire),
    pendingRequests: (wire.pendingRequests ?? []).map(pendingRequestFromWire),
  };
}

export function scheduleQueryKey(
  unitId: UnitId | undefined,
  range: DateRange | undefined,
  draftId: DraftSessionId | undefined,
) {
  return ['schedule', unitId, range?.from, range?.to, draftId ?? null] as const;
}

export function scheduleQueryOptions(
  unitId: UnitId | undefined,
  range: DateRange | undefined,
  draftId: DraftSessionId | undefined,
) {
  return queryOptions({
    queryKey: scheduleQueryKey(unitId, range, draftId),
    queryFn: () => fetchSchedule(unitId as UnitId, range as DateRange, draftId),
    enabled: unitId !== undefined && range !== undefined,
    // Opening a draft (draftId undefined -> session.id) or moving the visible
    // period is a new query key; keeping the previous snapshot visible while
    // it refetches is what makes `usePlanningView`'s `ready` stay true across
    // that transition instead of the whole page flashing back to "Loading…".
    placeholderData: keepPreviousData,
  });
}

export function useScheduleQuery(
  unitId: UnitId | undefined,
  range: DateRange | undefined,
  draftId: DraftSessionId | undefined,
) {
  return useQuery(scheduleQueryOptions(unitId, range, draftId));
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

async function fetchReference(): Promise<ReferenceData> {
  const wire = await apiGet<WireReferenceData>('/api/reference');
  return referenceFromWire(wire);
}

export const referenceQueryKey = ['reference'] as const;

export function referenceQueryOptions() {
  return queryOptions({
    queryKey: referenceQueryKey,
    queryFn: fetchReference,
    staleTime: 5 * 60_000, // Reference data changes rarely — Settings, Phase 6.
  });
}

export function useReferenceQuery() {
  return useQuery(referenceQueryOptions());
}
