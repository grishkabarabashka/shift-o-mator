/**
 * Writes to the plan over HTTP: drafts, and the direct writes for time off,
 * presence, people and acknowledgements.
 *
 * NOTE: **Reads live in `queries.ts`**, not here. This module used to also
 * carry `loadReference`, `loadPublished` and `history`, which were dead:
 * `queries.ts` has its own `fetchReference`/`fetchSchedule` behind TanStack
 * Query, and every caller went through those. Two implementations of the same
 * GET, one of them never running, is exactly the kind of drift a second copy
 * invites. `/api/history` over a range had no caller at all — the cell history
 * panel reads `/api/history/cell` directly.
 *
 * NOTE: This used to be `data/httpRepository.ts` behind a `ScheduleRepository`
 * interface (ADR-0012, "the single data boundary"). The interface is gone.
 *
 * WHY: it had one implementation, one consumer (`store/useSchedule.ts`), and
 * nine sibling modules in this directory that already bypassed it — `admin`,
 * `requests`, `planning`, `myCalendar`, `insights`, `setup`,
 * `notificationAdmin`, `roleAssignments`, `stagedCells` all call `client.ts`
 * directly. A boundary that nine of ten callers walk around is not a boundary.
 * The second implementation the interface was written for
 * (`MemoryScheduleRepository`, IndexedDB) was deleted in the Phase 5 HTTP
 * cutover, and the tests it also served now intercept `fetch()` itself
 * (`testUtils/mockApi.ts`), which exercises this code rather than replacing it.
 *
 * What ADR-0012 got right and this keeps: every function is async, and
 * published assignments are **never written directly** (ADR-0015) — they go
 * through a draft and a publish.
 *
 * Wire shapes differ from `domain/types.ts` in casing and structure; `mapping.ts`
 * does that conversion in one place.
 */

import { apiDelete, apiGet, apiPost, apiPut, qs } from './client.ts';
import { isAllUnits } from '../domain/unitScope.ts';
import {
  absenceFromWire,
  compDayFromWire,
  draftChangeFromWire,
  draftSessionFromWire,
  historyEntryFromWire,
  presenceFromWire,
  publishConflictFromWire,
  publishResultFromWire,
  syncItemToWireBody,
  weekdayToWire,
} from './mapping.ts';
import type {
  Absence,
  Acknowledgement,
  Assignment,
  CompDayEntry,
  DateRange,
  DayPortion,
  DraftChange,
  DraftSession,
  DraftSessionId,
  IsoDate,
  Person,
  PersonId,
  PresenceRecord,
  PublishConflict,
  PublishResult,
  UnitId,
} from '../domain/types.ts';

// ---------------------------------------------------------------------------
// Shapes the callers pass in and get back
// ---------------------------------------------------------------------------

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

/**
 * NOTE: What an absence write carries. `id` present means "replace that record";
 * `version` is the optimistic-concurrency token of the record being replaced (ADR-0042)
 * and is omitted on create.
 */
export interface AbsenceUpsert {
  readonly id?: string;
  readonly personId: PersonId;
  readonly eventTypeId: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly portion?: DayPortion | undefined;
  readonly note?: string | undefined;
  readonly version?: number | undefined;
}

/**
 * NOTE: What a presence write carries. `id` present means "replace that record";
 * `version` is the optimistic-concurrency token of the record being replaced (ADR-0043)
 * and is omitted on create.
 */
export interface PresenceUpsert {
  readonly id?: string;
  readonly personId: PersonId;
  readonly typeId: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly siteLocationId?: string | undefined;
  readonly siteLabel?: string | undefined;
  readonly note?: string | undefined;
  readonly version?: number | undefined;
  readonly portion?: DayPortion | undefined;
}


/**
 * NOTE: A person's profile: eligibility with target shares, available days,
 * preferences.
 *
 * Deliberately goes **around the draft**. A draft is about the plan for a
 * period (ADR-0015); "Priya takes a third of Batch-L" isn't a schedule edit,
 * it's a setting that auto-populate reads. Routing it through publish would
 * tie a profile change to the release of one specific month.
 */
export async function savePerson(person: Person): Promise<Person> {
  await apiPut(`/api/people/${person.id}`, {
    eligibility: person.eligibility.map((e) => ({
      shiftId: e.shiftId,
      targetShare: e.targetShare,
      minPerWeek: e.minPerWeek ?? null,
      maxPerWeek: e.maxPerWeek ?? null,
    })),
    availableWeekdays: person.availableWeekdays.map(weekdayToWire),
    defaultShiftId: person.defaultShiftId ?? null,
    weekendEligible: person.weekendEligible,
    constraints: {
      minRestHours: person.constraints.minRestHours,
      maxConsecutiveDays: person.constraints.maxConsecutiveDays,
      maxWeekendsPerQuarter: person.constraints.maxWeekendsPerQuarter ?? null,
    },
    preferences: person.preferences
      ? {
          avoidsWeekdays: (person.preferences.avoidsWeekdays ?? []).map(weekdayToWire),
          preferredPartnerIds: person.preferences.preferredPartnerIds ?? [],
          blackoutDates: person.preferences.blackoutDates ?? [],
          note: person.preferences.note ?? null,
        }
      : null,
  });
  // The server is the source of truth for the merged result, but the request
  // already carries the intended full Person shape except immutable identity
  // fields — echoing it back avoids a second round trip for what the caller
  // just sent.
  return person;
}

/**
 * NOTE: Acknowledging a violation also goes around the draft (like
 * `savePerson`), but for a different reason: it's an assessment of an
 * already-published plan, not an edit to it. Replaces the prior record with
 * the same `issueKey`, if there was one.
 */
export async function saveAcknowledgement(ack: Acknowledgement): Promise<void> {
  // The acknowledging person comes from the token, not the payload (ADR-0039).
  await apiPost('/api/acknowledgements', {
    issueKey: ack.issueKey,
    comment: ack.comment,
  });
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

/** NOTE: Returns the editor's already-open draft, or creates a new one. */
export async function openDraft(
  unitId: UnitId,
  range: DateRange,
  editorId: PersonId,
): Promise<DraftBundle> {
  // NOTE: `editorId` is deliberately not sent. The server takes the editor from the
  // authenticated principal (ADR-0039) — a client-supplied one would let any caller
  // publish under someone else's name in the audit trail. The parameter survives
  // because callers still use it locally to filter their own overlapping drafts.
  void editorId;
  const wire = await apiPost<Parameters<typeof draftSessionFromWire>[0]>('/api/drafts', {
    unitId,
    rangeFrom: range.from,
    rangeTo: range.to,
  });
  const session = draftSessionFromWire(wire);

  // WHY the changes are fetched: the server resumes an open draft rather than minting a
  // new one, so this may be a session with work already staged in it — from before a
  // reload, or from before an identity switch and back. Returning an empty list left
  // the grid showing published data, the dirty count at zero and Publish disabled, with
  // the staged edits sitting on the server unreachable.
  const changes = (await fetchChanges(session.id)) ?? [];
  return { session, changes };
}

async function fetchChanges(sessionId: DraftSessionId): Promise<DraftChange[] | undefined> {
  try {
    const wire = await apiGet<readonly Parameters<typeof draftChangeFromWire>[0][]>(
      `/api/drafts/${sessionId}/changes`,
    );
    return wire.map(draftChangeFromWire);
  } catch {
    return undefined;
  }
}

/**
 * NOTE: Brings the draft to the state where the listed cells end up: exactly
 * one change remains per key, the rest is removed. Idempotent — retrying
 * after a network failure (and undo, which also just changes a cell's
 * state) needs no separate "delete this change" call.
 *
 * WHY one request for the whole batch, instead of a POST per change: the old
 * `for (…) await post(…)` loop would fall apart right in the middle — the
 * first error broke the loop, the rest of the edits never went out, and the
 * planner only found out after publishing ("part of the cells were saved").
 * Now either the server accepts the whole set, or it accepts nothing and the
 * caller can retry.
 */
export async function syncChanges(
  sessionId: DraftSessionId,
  items: readonly DraftSyncItem[],
): Promise<DraftBundle> {
  if (items.length === 0) return { session: sessionStub(sessionId), changes: [] };
  const wire = await apiPost<readonly Parameters<typeof draftChangeFromWire>[0][]>(
    `/api/drafts/${sessionId}/changes/sync`,
    { changes: items.map(syncItemToWireBody) },
  );
  return { session: sessionStub(sessionId), changes: wire.map(draftChangeFromWire) };
}

/** NOTE: Atomically applies the draft to published data. */
export async function publishDraft(sessionId: DraftSessionId): Promise<PublishOutcome> {
  const changes = (await fetchChanges(sessionId)) ?? [];
  try {
    const wire = await apiPost<{
      readonly remainingGaps: number;
      readonly history: readonly Parameters<typeof historyEntryFromWire>[0][];
      readonly generatedCompDays: readonly Parameters<typeof compDayFromWire>[0][];
    }>(`/api/drafts/${sessionId}/publish`);
    return { ok: true, result: publishResultFromWire(wire, changes) };
  } catch (error) {
    const conflicts = extractConflicts(error);
    if (conflicts) return { ok: false, conflicts: conflicts.map(publishConflictFromWire) };
    throw error;
  }
}

/** NOTE: The session is kept for audit, not deleted. */
export async function discardDraft(sessionId: DraftSessionId): Promise<void> {
  await apiPost(`/api/drafts/${sessionId}/discard`);
}

/**
 * NOTE: Other people's open drafts overlapping the period. Needed for the
 * informational banner — not for blocking.
 */
export async function listOverlappingDrafts(
  unitId: UnitId,
  range: DateRange,
  excludeEditorId: PersonId,
): Promise<readonly DraftSession[]> {
  const wire = await apiGet<readonly Parameters<typeof draftSessionFromWire>[0][]>(
    `/api/drafts${qs({ unitId, from: range.from, to: range.to })}`,
  );
  return wire.map(draftSessionFromWire).filter((s) => s.editorPersonId !== excludeEditorId);
}

/**
 * NOTE: The caller's own open drafts over this scope, newest first — for **resuming**
 * one after a change of unit or period, without opening one that did not exist.
 *
 * WHY it is a separate call from `openDraft`: opening creates. Changing the view must
 * not mint an empty session on every unit you look at, and it must not throw away the
 * one you already have (which is what it did — the staged cells vanished from the
 * screen while still sitting on the server, and Publish disappeared with them).
 */
export async function listMyOpenDrafts(
  unitId: UnitId,
  range: DateRange,
): Promise<readonly DraftSession[]> {
  // `mine` is filtered by the server from the token: the client's copy of "who am I"
  // may not have arrived yet when a view change asks this.
  // A scope of "all units" is the *absence* of a unit filter, not a unit called ALL:
  // sending it would match nothing, which is precisely the case this exists for —
  // switching from one unit to the combined view must still find the draft you opened.
  const scoped = isAllUnits(unitId) ? undefined : unitId;
  const wire = await apiGet<readonly Parameters<typeof draftSessionFromWire>[0][]>(
    `/api/drafts${qs({ unitId: scoped, from: range.from, to: range.to, mine: 'true' })}`,
  );
  return wire.map(draftSessionFromWire);
}

/** NOTE: The changes staged in a draft. Empty if it has none, or cannot be read. */
export async function draftChanges(sessionId: DraftSessionId): Promise<readonly DraftChange[]> {
  return (await fetchChanges(sessionId)) ?? [];
}

// ---------------------------------------------------------------------------
// Presence
//
// NOTE: Presence goes straight to the server rather than through a draft (ADR-0043).
// It is not a roster decision: it never affects coverage, never blocks a publish, and
// is owned by the person it describes. Staging it in a planner's draft would mean an
// employee's "remote on Tuesday" stayed invisible until someone else published.
// ---------------------------------------------------------------------------

export async function savePresence(record: PresenceUpsert): Promise<PresenceRecord> {
  const body = {
    personId: record.personId,
    typeId: record.typeId,
    from: record.from,
    to: record.to,
    siteLocationId: record.siteLocationId ?? null,
    siteLabel: record.siteLabel ?? null,
    note: record.note ?? null,
    version: record.version ?? null,
    portion: record.portion ?? 'FULL',
  };
  const wire = record.id
    ? await apiPut<Parameters<typeof presenceFromWire>[0]>(`/api/presence/${record.id}`, body)
    : await apiPost<Parameters<typeof presenceFromWire>[0]>('/api/presence', body);
  return presenceFromWire(wire);
}

export async function deletePresence(id: string): Promise<void> {
  await apiDelete(`/api/presence/${id}`);
}

// ---------------------------------------------------------------------------
// Absences
//
// NOTE: Absences go straight to the server too (ADR-0052). Drafts publish the rota;
// time off is asked for and granted on its own schedule, by different people. The
// control that replaces the draft is approval, and it belongs to the *kind* of absence:
// a type with `requiresApproval` cannot be written here by anyone, planner included.
// ---------------------------------------------------------------------------

export async function saveAbsence(record: AbsenceUpsert): Promise<Absence> {
  const body = {
    personId: record.personId,
    eventTypeId: record.eventTypeId,
    from: record.from,
    to: record.to,
    portion: record.portion ?? 'FULL',
    note: record.note ?? null,
    version: record.version ?? null,
  };
  const wire = record.id
    ? await apiPut<Parameters<typeof absenceFromWire>[0]>(`/api/absences/${record.id}`, body)
    : await apiPost<Parameters<typeof absenceFromWire>[0]>('/api/absences', body);
  return absenceFromWire(wire);
}

export async function deleteAbsence(id: string): Promise<void> {
  await apiDelete(`/api/absences/${id}`);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Every caller of `syncChanges` (`useSchedule.ts`) only reads `.changes` off the
 * returned bundle, never `.session` (the session itself was already captured
 * from `openDraft`) — this stub avoids a wasted round trip just to refill
 * fields nobody reads.
 */
function sessionStub(sessionId: DraftSessionId): DraftSession {
  return {
    id: sessionId,
    editorPersonId: '',
    unitId: '',
    range: { from: '', to: '' },
    status: 'OPEN',
    createdAt: '',
    updatedAt: '',
  };
}

interface ApiErrorLike {
  readonly status: number;
  readonly body: unknown;
}

function extractConflicts(
  error: unknown,
): readonly { changeId: string; targetType: string; entityId: string; reason: string }[] | undefined {
  const err = error as Partial<ApiErrorLike> | undefined;
  if (!err || err.status !== 409) return undefined;
  const body = err.body as { conflicts?: unknown } | undefined;
  if (!body || !Array.isArray(body.conflicts)) return undefined;
  return body.conflicts as never;
}
