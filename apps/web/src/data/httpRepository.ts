/**
 * `ScheduleRepository` over the .NET API — the Phase 5 HTTP cutover
 * (ADR: HTTP cutover, supersedes `MemoryScheduleRepository`/IndexedDB).
 *
 * Every wire shape differs from `domain/types.ts` in casing or structure
 * (enums are `camelCase` on the wire vs `UPPER_SNAKE` here, `Assignment.content`
 * is flattened into `shiftId`) — `src/api/mapping.ts` does
 * all of that conversion in one place.
 *
 * `plan.acknowledgements` comes back empty from `loadPublished`: `GET
 * /api/schedule` only carries `acknowledgedIssueKeys` (a plain string list),
 * not full `Acknowledgement` records — every real consumer only ever needed
 * the key set (`acknowledgedKeys()`), which `usePlanningView` now reads
 * directly off the schedule response (Phase 5 step 4). `saveAcknowledgement`
 * still round-trips through the server and the store still appends the
 * result locally for the current session, same as before.
 */

import { apiDelete, apiGet, apiPost, apiPut, qs } from '../api/client.ts';
import { isAllUnits } from '../domain/unitScope.ts';
import {
  absenceFromWire,
  assignmentFromWire,
  compDayFromWire,
  draftChangeFromWire,
  draftSessionFromWire,
  historyEntryFromWire,
  presenceFromWire,
  publishConflictFromWire,
  publishResultFromWire,
  referenceFromWire,
  syncItemToWireBody,
  weekdayToWire,
  type WireReferenceData,
} from '../api/mapping.ts';
import type {
  Acknowledgement,
  ChangeHistoryEntry,
  DateRange,
  Absence,
  DraftChange,
  DraftSession,
  DraftSessionId,
  Person,
  PersonId,
  PlanData,
  PresenceRecord,
  ReferenceData,
  UnitId,
} from '../domain/types.ts';
import type {
  DraftBundle,
  DraftSyncItem,
  AbsenceUpsert,
  PresenceUpsert,
  PublishOutcome,
  ScheduleRepository,
} from './repository.ts';

interface WireScheduleResponse {
  readonly unitIds: readonly string[];
  readonly plan: {
    readonly assignments: readonly Parameters<typeof assignmentFromWire>[0][];
    readonly absences: readonly Parameters<typeof absenceFromWire>[0][];
    readonly compDays: readonly Parameters<typeof compDayFromWire>[0][];
    readonly presence?: readonly Parameters<typeof presenceFromWire>[0][];
  };
}

export class HttpScheduleRepository implements ScheduleRepository {
  async loadReference(): Promise<ReferenceData> {
    const wire = await apiGet<WireReferenceData>('/api/reference');
    return referenceFromWire(wire);
  }

  async loadPublished(unitId: UnitId, range: DateRange): Promise<PlanData> {
    const wire = await apiGet<WireScheduleResponse>(
      `/api/schedule${qs({ unitId, from: range.from, to: range.to })}`,
    );
    return {
      assignments: wire.plan.assignments.map(assignmentFromWire),
      absences: wire.plan.absences.map(absenceFromWire),
      compDays: wire.plan.compDays.map(compDayFromWire),
      presence: (wire.plan.presence ?? []).map(presenceFromWire),
      // See file header — the schedule endpoint doesn't carry full ack records.
      acknowledgements: [],
    };
  }

  async savePerson(person: Person): Promise<Person> {
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

  async saveAcknowledgement(ack: Acknowledgement): Promise<void> {
    // The acknowledging person comes from the token, not the payload (ADR-0039).
    await apiPost('/api/acknowledgements', {
      issueKey: ack.issueKey,
      comment: ack.comment,
    });
  }

  // -- Drafts -----------------------------------------------------------------

  async openDraft(unitId: UnitId, range: DateRange, editorId: PersonId): Promise<DraftBundle> {
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
    const changes = (await this.fetchChanges(session.id)) ?? [];
    return { session, changes };
  }

  private async fetchChanges(sessionId: DraftSessionId): Promise<DraftChange[] | undefined> {
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
   * WHY: One request for the whole batch, instead of a POST per change.
   *
   * The old `for (…) await post(…)` loop would fall apart right in the
   * middle: the first error broke the loop, the rest of the edits never went
   * out, and the planner only found out after publishing — "part of the
   * cells were saved". Now it's a single call: either the server accepts the
   * whole set, or it accepts nothing and the caller can retry.
   */
  async syncChanges(
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

  async publishDraft(sessionId: DraftSessionId): Promise<PublishOutcome> {
    const changes = (await this.fetchChanges(sessionId)) ?? [];
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

  async discardDraft(sessionId: DraftSessionId): Promise<void> {
    await apiPost(`/api/drafts/${sessionId}/discard`);
  }

  async listOverlappingDrafts(
    unitId: UnitId,
    range: DateRange,
    excludeEditorId: PersonId,
  ): Promise<readonly DraftSession[]> {
    const wire = await apiGet<readonly Parameters<typeof draftSessionFromWire>[0][]>(
      `/api/drafts${qs({ unitId, from: range.from, to: range.to })}`,
    );
    return wire.map(draftSessionFromWire).filter((s) => s.editorPersonId !== excludeEditorId);
  }

  async listMyOpenDrafts(unitId: UnitId, range: DateRange): Promise<readonly DraftSession[]> {
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

  async draftChanges(sessionId: DraftSessionId): Promise<readonly DraftChange[]> {
    return (await this.fetchChanges(sessionId)) ?? [];
  }

  // -- Presence -----------------------------------------------------------

  async savePresence(record: PresenceUpsert): Promise<PresenceRecord> {
    const body = {
      personId: record.personId,
      typeId: record.typeId,
      from: record.from,
      to: record.to,
      siteLocationId: record.siteLocationId ?? null,
      siteLabel: record.siteLabel ?? null,
      note: record.note ?? null,
      version: record.version ?? null,
      portion: (record.portion ?? 'FULL').toLowerCase(),
    };
    const wire = record.id
      ? await apiPut<Parameters<typeof presenceFromWire>[0]>(`/api/presence/${record.id}`, body)
      : await apiPost<Parameters<typeof presenceFromWire>[0]>('/api/presence', body);
    return presenceFromWire(wire);
  }

  async deletePresence(id: string): Promise<void> {
    await apiDelete(`/api/presence/${id}`);
  }

  // -- Absences -----------------------------------------------------------

  async saveAbsence(record: AbsenceUpsert): Promise<Absence> {
    const body = {
      personId: record.personId,
      eventTypeId: record.eventTypeId,
      from: record.from,
      to: record.to,
      portion: (record.portion ?? 'FULL').toLowerCase(),
      note: record.note ?? null,
      version: record.version ?? null,
    };
    const wire = record.id
      ? await apiPut<Parameters<typeof absenceFromWire>[0]>(`/api/absences/${record.id}`, body)
      : await apiPost<Parameters<typeof absenceFromWire>[0]>('/api/absences', body);
    return absenceFromWire(wire);
  }

  async deleteAbsence(id: string): Promise<void> {
    await apiDelete(`/api/absences/${id}`);
  }

  // -- Audit --------------------------------------------------------------

  async history(range: DateRange): Promise<readonly ChangeHistoryEntry[]> {
    const wire = await apiGet<readonly Parameters<typeof historyEntryFromWire>[0][]>(
      `/api/history${qs({ from: range.from, to: range.to })}`,
    );
    return wire.map(historyEntryFromWire);
  }
}

/**
 * Every caller of `syncChanges` (`useSchedule.ts`) only reads
 * `.changes` off the returned bundle, never `.session` (the session itself was
 * already captured from `openDraft`) — this stub avoids a wasted round trip
 * just to refill fields nobody reads.
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

export const scheduleRepository: ScheduleRepository = new HttpScheduleRepository();
