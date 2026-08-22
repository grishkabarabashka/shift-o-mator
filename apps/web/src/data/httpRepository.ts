/**
 * `ScheduleRepository` over the .NET API — the Phase 5 HTTP cutover
 * (ADR: HTTP cutover, supersedes `MemoryScheduleRepository`/IndexedDB).
 *
 * Every wire shape differs from `domain/types.ts` in casing or structure
 * (enums are `camelCase` on the wire vs `UPPER_SNAKE` here, `Assignment.content`
 * is flattened into `contentKind`/`roleId`/`marker`) — `src/api/mapping.ts` does
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
import {
  absenceFromWire,
  assignmentFromWire,
  compDayFromWire,
  draftChangeFromWire,
  draftChangeToWireBody,
  draftSessionFromWire,
  historyEntryFromWire,
  publishConflictFromWire,
  publishResultFromWire,
  referenceFromWire,
  weekdayToWire,
  type WireReferenceData,
} from '../api/mapping.ts';
import type {
  Acknowledgement,
  AssignmentHistoryEntry,
  DateRange,
  DraftChange,
  DraftSession,
  DraftSessionId,
  Person,
  PersonId,
  PlanData,
  ReferenceData,
  UnitId,
} from '../domain/types.ts';
import type { DraftBundle, PublishOutcome, ScheduleRepository } from './repository.ts';

interface WireScheduleResponse {
  readonly unitIds: readonly string[];
  readonly plan: {
    readonly assignments: readonly Parameters<typeof assignmentFromWire>[0][];
    readonly absences: readonly Parameters<typeof absenceFromWire>[0][];
    readonly compDays: readonly Parameters<typeof compDayFromWire>[0][];
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
    await apiPost('/api/acknowledgements', {
      issueKey: ack.issueKey,
      comment: ack.comment,
      byPersonId: ack.byPersonId,
    });
  }

  // -- Drafts -----------------------------------------------------------------

  async openDraft(unitId: UnitId, range: DateRange, editorId: PersonId): Promise<DraftBundle> {
    const wire = await apiPost<Parameters<typeof draftSessionFromWire>[0]>('/api/drafts', {
      editorPersonId: editorId,
      unitId,
      rangeFrom: range.from,
      rangeTo: range.to,
    });
    const session = draftSessionFromWire(wire);
    return { session, changes: [] };
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

  async appendChanges(
    sessionId: DraftSessionId,
    changes: readonly DraftChange[],
  ): Promise<DraftBundle> {
    for (const change of changes) {
      const body = draftChangeToWireBody(change);
      await apiPost(`/api/drafts/${sessionId}/changes`, body);
    }
    const all = (await this.fetchChanges(sessionId)) ?? [];
    return { session: sessionStub(sessionId), changes: all };
  }

  async removeChanges(
    sessionId: DraftSessionId,
    changeIds: readonly string[],
  ): Promise<DraftBundle> {
    for (const changeId of changeIds) {
      await apiDelete(`/api/drafts/${sessionId}/changes/${changeId}`);
    }
    const all = (await this.fetchChanges(sessionId)) ?? [];
    return { session: sessionStub(sessionId), changes: all };
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

  // -- Audit --------------------------------------------------------------

  async history(range: DateRange): Promise<readonly AssignmentHistoryEntry[]> {
    const wire = await apiGet<readonly Parameters<typeof historyEntryFromWire>[0][]>(
      `/api/history${qs({ from: range.from, to: range.to })}`,
    );
    return wire.map(historyEntryFromWire);
  }
}

/**
 * Every caller of `appendChanges`/`removeChanges` (`useSchedule.ts`) only reads
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
