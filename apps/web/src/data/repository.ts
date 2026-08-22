/**
 * NOTE: The single data boundary — ADR-0012.
 *
 * No component and no engine function reaches the store except through this
 * interface. Phase 5: the only implementation is `HttpScheduleRepository`
 * (`data/httpRepository.ts`) on top of the .NET API; `MemoryScheduleRepository`
 * and the IndexedDB persistence layer were removed along with the fixtures
 * (ADR: HTTP cutover).
 *
 * WHY: Every method has been async from day one, even back when data was
 * local. Otherwise, once a network showed up, every place where the code had
 * assumed synchronous behavior would have surfaced as a bug.
 *
 * NOTE: Published assignments are **never written directly** (ADR-0015):
 * everything goes through a draft and a publish.
 *
 * NOTE: `exportJson`/`importJson`/`reset`/`snapshot` from the MVP version of
 * the interface are removed here: those were debug/test conveniences on top
 * of the in-memory implementation; the backend has no corresponding endpoints
 * and none are planned (a full dataset dump isn't an operation a planner
 * performs).
 */

import type { DraftChange } from '../domain/types.ts';
import type {
  Absence,
  Acknowledgement,
  Assignment,
  AssignmentHistoryEntry,
  CompDayEntry,
  DateRange,
  DraftSession,
  DraftSessionId,
  Person,
  PersonId,
  PlanData,
  PublishConflict,
  PublishResult,
  ReferenceData,
  UnitId,
} from '../domain/types.ts';

/** NOTE: Publish outcome: success or a list of conflicts. */
export type PublishOutcome =
  | { readonly ok: true; readonly result: PublishResult }
  | { readonly ok: false; readonly conflicts: readonly PublishConflict[] };

/** NOTE: A draft with its changes. */
export interface DraftBundle {
  readonly session: DraftSession;
  readonly changes: readonly DraftChange[];
}

/**
 * NOTE: One syncable unit of a draft: "here's what this cell should end up
 * as", not "here's the operation I performed".
 *
 * WHY: The client no longer computes `op`. It used to derive CREATE/UPDATE/
 * DELETE from its local state, and repainting a cell created within the same
 * draft would go out as an UPDATE for a row that doesn't exist yet in
 * published data — the server answered 400, and the rest of the batch was
 * lost along with it. Now the server derives `op` by comparing against
 * published data.
 *
 * `key` is what the change is about: for an assignment it's the
 * `personId|date` cell (a cell never holds two assignments); for an absence
 * or comp day it's the record's id.
 */
export interface DraftSyncItem {
  readonly targetType: DraftChange['targetType'];
  readonly key: string;
  /** NOTE: Desired state; `null` means the cell should end up empty. */
  readonly after: Assignment | Absence | CompDayEntry | null;
}

export interface ScheduleRepository {
  /** NOTE: Reference data: planning units, locations, shifts, day configurations, people. */
  loadReference(): Promise<ReferenceData>;

  /** NOTE: The published plan for a period, for a planning unit. */
  loadPublished(unitId: UnitId, range: DateRange): Promise<PlanData>;

  /**
   * NOTE: A person's profile: eligibility with target shares, available days,
   * preferences.
   *
   * Deliberately goes **around the draft**. A draft is about the plan for a
   * period (ADR-0015); "Priya takes a third of Batch-L" isn't a schedule edit,
   * it's a setting that auto-populate reads. Routing it through publish would
   * tie a profile change to the release of one specific month.
   */
  savePerson(person: Person): Promise<Person>;

  /**
   * NOTE: Acknowledging a violation also goes around the draft (like
   * `savePerson`), but for a different reason: it's an assessment of an
   * already-published plan, not an edit to it. Replaces the prior record with
   * the same `issueKey`, if there was one.
   */
  saveAcknowledgement(ack: Acknowledgement): Promise<void>;

  // -- Drafts -----------------------------------------------------------------

  /** NOTE: Returns the editor's already-open draft, or creates a new one. */
  openDraft(unitId: UnitId, range: DateRange, editorId: PersonId): Promise<DraftBundle>;
  /**
   * NOTE: Brings the draft to the state where the listed cells end up: exactly
   * one change remains per key, the rest is removed. Idempotent — retrying
   * after a network failure (and undo, which also just changes a cell's
   * state) needs no separate "delete this change" call.
   */
  syncChanges(sessionId: DraftSessionId, items: readonly DraftSyncItem[]): Promise<DraftBundle>;
  /** NOTE: Atomically applies the draft to published data. */
  publishDraft(sessionId: DraftSessionId): Promise<PublishOutcome>;
  /** NOTE: The session is kept for audit, not deleted. */
  discardDraft(sessionId: DraftSessionId): Promise<void>;
  /**
   * NOTE: Other people's open drafts overlapping the period. Needed for the
   * informational banner — not for blocking.
   */
  listOverlappingDrafts(
    unitId: UnitId,
    range: DateRange,
    excludeEditorId: PersonId,
  ): Promise<readonly DraftSession[]>;

  // -- Audit and history --------------------------------------------------------

  history(range: DateRange): Promise<readonly AssignmentHistoryEntry[]>;
}
