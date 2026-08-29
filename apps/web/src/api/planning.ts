/**
 * `POST /api/suggest` and `POST /api/auto-populate` — preview-only endpoints
 * that used to be pure client engines (`engine/candidates.ts`,
 * `engine/autoPopulate.ts`, both deleted with Phase 5's move of domain logic
 * to the server). Both endpoints run against the live plan and return a
 * preview without touching stored state; the caller turns an accepted
 * preview into draft changes via `useSchedule.commitAutoPopulate`/`setCells`,
 * same as before — only where the ranking/generation itself runs changed.
 */

import { apiPost } from './client.ts';
import { assignmentFromWire, compDayFromWire } from './mapping.ts';
import { assignmentChange, compDayChange } from '../domain/draft.ts';
import type {
  Assignment,
  CompDayEntry,
  DateRange,
  DraftChange,
  IsoDate,
  IsoInstant,
  PersonId,
  ShiftId,
  UnitId,
} from '../domain/types.ts';

// ---------------------------------------------------------------------------
// Suggest — ranked candidates for one gap
// ---------------------------------------------------------------------------

export interface Candidate {
  readonly personId: string;
  readonly name: string;
  readonly shiftCountLast90: number;
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
  readonly available: readonly Candidate[];
  readonly excluded: readonly ExcludedCandidate[];
  readonly teamWeekendAverage: number;
}

interface WireCandidateResult {
  readonly available: readonly {
    readonly personId: string;
    readonly name: string;
    readonly shiftCountLast90: number;
    readonly daysSinceLastHeld?: number | null;
    readonly weekendLoad: number;
    readonly warnings: readonly string[];
  }[];
  readonly excluded: readonly { readonly personId: string; readonly name: string; readonly reason: string }[];
  readonly teamWeekendAverage: number;
}

export async function fetchCandidates(params: {
  readonly shiftId: ShiftId;
  readonly date: IsoDate;
  readonly unitId: UnitId;
  readonly excludePersonIds?: ReadonlySet<PersonId>;
}): Promise<CandidateResult> {
  const wire = await apiPost<WireCandidateResult>('/api/suggest', {
    shiftId: params.shiftId,
    date: params.date,
    unitId: params.unitId,
    excludePersonIds: params.excludePersonIds ? [...params.excludePersonIds] : null,
  });
  return {
    available: wire.available.map((c) => ({
      personId: c.personId,
      name: c.name,
      shiftCountLast90: c.shiftCountLast90,
      daysSinceLastHeld: c.daysSinceLastHeld ?? undefined,
      weekendLoad: c.weekendLoad,
      warnings: c.warnings,
    })),
    excluded: wire.excluded,
    teamWeekendAverage: wire.teamWeekendAverage,
  };
}

// ---------------------------------------------------------------------------
// Auto-populate — one-pass fill for a period
// ---------------------------------------------------------------------------

export const AUTO_POPULATE_MAX_DAYS = 92;

export interface AutoPopulateGap {
  readonly date: IsoDate;
  readonly shiftId: ShiftId;
  readonly code: string;
  readonly reason: string;
}

/** Same shape `engine/autoPopulate.ts` used to return, so `commitAutoPopulate`
 * (`useSchedule.ts`) didn't need to change. */
export interface AutoPopulateResult {
  readonly changes: readonly DraftChange[];
  readonly gaps: readonly AutoPopulateGap[];
  readonly assignedCount: number;
}

interface WireAutoPopulateResult {
  readonly assignments: readonly Parameters<typeof assignmentFromWire>[0][];
  readonly compDays: readonly Parameters<typeof compDayFromWire>[0][];
  readonly gaps: readonly { readonly date: IsoDate; readonly shiftId: ShiftId; readonly code: string; readonly reason: string }[];
}

export async function runAutoPopulate(params: {
  readonly unitId: UnitId;
  readonly range: DateRange;
  readonly lockedAssignmentIds: ReadonlySet<string>;
  /** NOTE: The planner's open draft: generation must see cells already placed
   * by hand, otherwise accepting the preview would overwrite them. */
  readonly draftId?: string | undefined;
}): Promise<AutoPopulateResult> {
  const wire = await apiPost<WireAutoPopulateResult>('/api/auto-populate', {
    unitId: params.unitId,
    rangeFrom: params.range.from,
    rangeTo: params.range.to,
    // NOTE: no `actorId` — generated assignments are attributed to the authenticated
    // caller, server-side (ADR-0039).
    lockedAssignmentIds: [...params.lockedAssignmentIds],
    draftId: params.draftId ?? null,
  });

  const now: IsoInstant = new Date().toISOString();
  // A local, throwaway seq: `commitAutoPopulate` resequences with the store's
  // own counter before staging into the draft, same as the old client engine.
  let seq = 0;
  const changes: DraftChange[] = [
    ...wire.assignments.map((a) => assignmentChange(null, assignmentFromWire(a) as Assignment, (seq += 1), now)),
    ...wire.compDays.map((c) => compDayChange(null, compDayFromWire(c) as CompDayEntry, (seq += 1), now)),
  ];

  return {
    changes,
    // `Code` here is a shift code (e.g. "Batch-L"), not an enum — no case conversion.
    gaps: wire.gaps,
    assignedCount: wire.assignments.length,
  };
}

/**
 * NOTE: "Why this person" for one suggested cell (ADR-0048).
 *
 * The deciding factor is computed server-side from the ranker's own ordering, so it is
 * present whether or not a model is configured; `explanation` is the phrased version and
 * is null when there is no model or the call failed. The UI shows the factor either way
 * — losing the prose must not lose the answer.
 */
export interface CandidateExplanation {
  readonly explanation: string | null;
  readonly digest: string;
  readonly suggestedPersonId: string | null;
  readonly suggestedPersonName: string | null;
  readonly decidingFactor: string;
  readonly availableCount: number;
  readonly excludedCount: number;
  readonly model: string | null;
}

export async function fetchCandidateExplanation(params: {
  readonly shiftId: ShiftId;
  readonly date: IsoDate;
  readonly unitId: UnitId;
  readonly excludePersonIds?: ReadonlySet<PersonId>;
}): Promise<CandidateExplanation> {
  return apiPost<CandidateExplanation>('/api/insights/candidate-explanation', {
    shiftId: params.shiftId,
    date: params.date,
    unitId: params.unitId,
    excludePersonIds: params.excludePersonIds ? [...params.excludePersonIds] : null,
  });
}
