import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { queryClient } from '../api/queryClient.ts';
import { mockBackend, resetMockApi, server } from '../testUtils/mockApi.ts';
import { DEFAULT_UNIT } from '../testUtils/mockDataset.ts';
import { useSchedule } from './useSchedule.ts';

const RANGE = { from: '2026-08-01', to: '2026-08-31' } as const;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function loadStore() {
  resetMockApi();
  queryClient.clear();
  await useSchedule.getState().load(DEFAULT_UNIT, RANGE);
  await useSchedule.getState().startDraft();
}

/** NOTE: The first person in the unit eligible for a role with this code. */
function personWithShift(code: string) {
  const { reference } = useSchedule.getState();
  const shift = reference?.shifts.find((r) => r.unitId === DEFAULT_UNIT && r.code === code);
  const person = reference?.people.find(
    (p) =>
      p.unitId === DEFAULT_UNIT &&
      p.isIncluded &&
      p.eligibility.some((e) => e.shiftId === shift?.id),
  );
  return { shift, person };
}

function cellShiftId(personId: string, date: string): string | undefined {
  const assignment = useSchedule
    .getState()
    .plan?.assignments.find((a) => a.personId === personId && a.date === date);
  return assignment?.content.kind === 'SHIFT' ? assignment.content.shiftId : undefined;
}

/** NOTE: A person's free weekdays — the test dataset is empty, so any weekday is free. */
function freeDates(personId: string, count: number): string[] {
  const dates: string[] = [];
  for (let day = 1; day <= 31 && dates.length < count; day += 1) {
    const date = `2026-08-${String(day).padStart(2, '0')}`;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    dates.push(date);
  }
  void personId;
  if (dates.length < count) throw new Error(`fewer than ${count} free weekdays in August`);
  return dates;
}

function freeDate(personId: string): string {
  return freeDates(personId, 1)[0] as string;
}

describe('loading', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('loads reference data, the published plan, and the index', () => {
    const state = useSchedule.getState();
    expect(state.status).toBe('ready');
    expect(state.reference?.people.length).toBeGreaterThan(0);
    expect(state.index?.shifts.size).toBeGreaterThan(0);
  });

  it('an opened draft is empty, the plan equals published', () => {
    const state = useSchedule.getState();
    expect(state.session).toBeDefined();
    expect(state.changes).toHaveLength(0);
    expect(state.plan?.assignments).toEqual(state.published?.assignments);
  });
});

describe('cell edits', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('puts a role in a cell', () => {
    const { shift, person } = personWithShift('Cover');
    expect(shift && person).toBeTruthy();
    if (!shift || !person) return;

    const date = freeDate(person.id);
    useSchedule.getState().setCell(person.id, date, shift.id);
    expect(cellShiftId(person.id, date)).toBe(shift.id);
  });

  it('an edit does not touch published data', () => {
    const { shift, person } = personWithShift('Cover');
    if (!shift || !person) return;
    const date = freeDate(person.id);
    const publishedBefore = useSchedule.getState().published?.assignments.length;

    useSchedule.getState().setCell(person.id, date, shift.id);

    expect(useSchedule.getState().published?.assignments.length).toBe(publishedBefore);
    expect(useSchedule.getState().changes.length).toBeGreaterThan(0);
  });

  it('a cell keeps exactly one assignment', () => {
    const { person } = personWithShift('Cover');
    if (!person) return;
    const shifts = useSchedule
      .getState()
      .reference?.shifts.filter((s) => person.eligibility.some((e) => e.shiftId === s.id)) ?? [];
    if (shifts.length < 2) return;

    const date = freeDate(person.id);
    useSchedule.getState().setCell(person.id, date, shifts[0]?.id ?? null);
    useSchedule.getState().setCell(person.id, date, shifts[1]?.id ?? null);

    const inCell = useSchedule
      .getState()
      .plan?.assignments.filter((a) => a.personId === person.id && a.date === date);
    expect(inCell).toHaveLength(1);
    expect(cellShiftId(person.id, date)).toBe(shifts[1]?.id);
  });

  it('rejects a shift from a different unit', () => {
    const { person } = personWithShift('Cover');
    const foreignShift = useSchedule
      .getState()
      .reference?.shifts.find((s) => s.unitId === 'unit-emea');
    if (!person || !foreignShift) return;

    const date = freeDate(person.id);
    useSchedule.getState().setCell(person.id, date, foreignShift.id);
    expect(cellShiftId(person.id, date)).toBeUndefined();
  });

  it('sets a roster marker', () => {
    const { person } = personWithShift('Cover');
    if (!person) return;
    const date = freeDate(person.id);

    useSchedule.getState().setMarker([{ personId: person.id, date }], 'OFF');
    const assignment = useSchedule
      .getState()
      .plan?.assignments.find((a) => a.personId === person.id && a.date === date);
    expect(assignment?.content).toEqual({ kind: 'MARKER', marker: 'OFF' });
  });

  it('paints a range as one batch', () => {
    const { shift, person } = personWithShift('Cover');
    if (!shift || !person) return;

    const dates = freeDates(person.id, 3);
    useSchedule.getState().setCells(
      dates.map((date) => ({ personId: person.id, date })),
      shift.id,
    );
    expect(dates.every((date) => cellShiftId(person.id, date) === shift.id)).toBe(true);

    useSchedule.getState().undo();
    expect(dates.every((date) => cellShiftId(person.id, date) !== shift.id)).toBe(true);
  });
});

describe('undo and redo', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('undoes and redoes an edit', () => {
    const { shift, person } = personWithShift('Cover');
    if (!shift || !person) return;
    const date = freeDate(person.id);

    useSchedule.getState().setCell(person.id, date, shift.id);
    useSchedule.getState().undo();
    expect(cellShiftId(person.id, date)).toBeUndefined();

    useSchedule.getState().redo();
    expect(cellShiftId(person.id, date)).toBe(shift.id);
  });

  it('a new edit clears the redo stack', () => {
    const { shift, person } = personWithShift('Cover');
    if (!shift || !person) return;
    const [first, second] = freeDates(person.id, 2);

    useSchedule.getState().setCell(person.id, first as string, shift.id);
    useSchedule.getState().undo();
    expect(useSchedule.getState().redoStack).toHaveLength(1);

    useSchedule.getState().setCell(person.id, second as string, shift.id);
    expect(useSchedule.getState().redoStack).toHaveLength(0);
  });

  it('undo on an empty stack breaks nothing', () => {
    const snapshot = useSchedule.getState().plan;
    useSchedule.getState().undo();
    expect(useSchedule.getState().plan).toBe(snapshot);
  });

  it('an edit that changes nothing does not enter the stack', () => {
    const { shift, person } = personWithShift('Cover');
    if (!shift || !person) return;

    const date = freeDate(person.id);
    useSchedule.getState().setCell(person.id, date, shift.id);
    const depth = useSchedule.getState().undoStack.length;
    useSchedule.getState().setCell(person.id, date, shift.id);
    expect(useSchedule.getState().undoStack).toHaveLength(depth);
  });
});

describe('absences', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('setAbsences creates several records as one undo batch', () => {
    const people = useSchedule
      .getState()
      .reference?.people.filter((p) => p.unitId === DEFAULT_UNIT && p.isIncluded)
      .slice(0, 2);
    if (!people || people.length < 2) return;

    const before = useSchedule.getState().undoStack.length;
    useSchedule.getState().setAbsences(
      people.map((person, i) => ({
        id: `abs-test-${i}`,
        personId: person.id,
        type: 'VACATION' as const,
        from: '2026-08-24',
        to: '2026-08-26',
        source: 'MANUAL' as const,
      })),
    );

    expect(
      (useSchedule.getState().plan?.absences ?? []).filter((a) => a.id.startsWith('abs-test-')),
    ).toHaveLength(2);
    expect(useSchedule.getState().undoStack).toHaveLength(before + 1);

    useSchedule.getState().undo();
    expect(
      (useSchedule.getState().plan?.absences ?? []).filter((a) => a.id.startsWith('abs-test-')),
    ).toHaveLength(0);
  });

  it('an empty list does not create an undo step', () => {
    const before = useSchedule.getState().undoStack.length;
    useSchedule.getState().setAbsences([]);
    expect(useSchedule.getState().undoStack).toHaveLength(before);
  });
});

describe('server sync (debounce)', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('an edit sets pendingSync and clears it after the flush', async () => {
    const { shift, person } = personWithShift('Cover');
    if (!shift || !person) return;
    const date = freeDate(person.id);

    useSchedule.getState().setCell(person.id, date, shift.id);
    expect(useSchedule.getState().pendingSync).toBe(true);

    await vi.waitFor(() => {
      expect(useSchedule.getState().pendingSync).toBe(false);
    });

    const sessionId = useSchedule.getState().session?.id;
    expect(sessionId).toBeDefined();
    const entry = sessionId ? mockBackend.sessions.get(sessionId) : undefined;
    expect(entry?.changes.length).toBeGreaterThan(0);
  });
});

describe('publish', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('publishes the draft and clears it', async () => {
    const { shift, person } = personWithShift('Cover');
    if (!shift || !person) return;
    const date = freeDate(person.id);

    useSchedule.getState().setCell(person.id, date, shift.id);
    expect(useSchedule.getState().changes.length).toBeGreaterThan(0);

    // Wait for the debounced flush so the draft's changes actually reach the
    // (mock) server before publish reads them.
    await vi.waitFor(() => {
      expect(useSchedule.getState().pendingSync).toBe(false);
    });

    const outcome = await useSchedule.getState().publish();
    expect(outcome?.ok).toBe(true);
    expect(useSchedule.getState().changes).toHaveLength(0);
    expect(useSchedule.getState().session).toBeUndefined();
    expect(cellShiftId(person.id, date)).toBe(shift.id);
  });

  /**
   * NOTE: Regression tests for "only part of the cells were saved".
   *
   * All three used to break the same way: the client sent one POST per
   * change, the first 400 broke the batch, and the rest of the edits never
   * went out — silently. Publishing after that saved exactly what had made
   * it through.
   */
  it('publishes the latest edit of a cell repainted within the draft', async () => {
    const { person } = personWithShift('Cover');
    if (!person) return;
    const shifts = useSchedule
      .getState()
      .reference?.shifts.filter((s) => person.eligibility.some((e) => e.shiftId === s.id)) ?? [];
    if (shifts.length < 2) return;
    const date = freeDate(person.id);

    useSchedule.getState().setCell(person.id, date, shifts[0]?.id ?? null);
    useSchedule.getState().setCell(person.id, date, shifts[1]?.id ?? null);

    // NOTE: Two edits to one cell are one decision: the draft on the server
    // holds exactly one change, not a CREATE plus an UPDATE of a nonexistent row.
    await useSchedule.getState().flushNow();
    const sessionId = useSchedule.getState().session?.id;
    expect(sessionId ? mockBackend.sessions.get(sessionId)?.changes : undefined).toHaveLength(1);

    const outcome = await useSchedule.getState().publish();
    expect(outcome?.ok).toBe(true);
    expect(cellShiftId(person.id, date)).toBe(shifts[1]?.id);
  });

  it('publishes an edit made right before pressing Publish', async () => {
    const { shift, person } = personWithShift('Cover');
    if (!shift || !person) return;
    const date = freeDate(person.id);

    // NOTE: No waiting for the debounce: exactly what the planner does when
    // painting a cell and immediately hitting Publish.
    useSchedule.getState().setCell(person.id, date, shift.id);
    const outcome = await useSchedule.getState().publish();

    expect(outcome?.ok).toBe(true);
    expect(cellShiftId(person.id, date)).toBe(shift.id);
  });

  it('a published cell that is cleared and repainted publishes again', async () => {
    const { person } = personWithShift('Cover');
    if (!person) return;
    const shifts = useSchedule
      .getState()
      .reference?.shifts.filter((s) => person.eligibility.some((e) => e.shiftId === s.id)) ?? [];
    if (shifts.length < 2) return;
    const date = freeDate(person.id);

    useSchedule.getState().setCell(person.id, date, shifts[0]?.id ?? null);
    expect((await useSchedule.getState().publish())?.ok).toBe(true);

    await useSchedule.getState().startDraft();
    useSchedule.getState().setCell(person.id, date, null);
    useSchedule.getState().setCell(person.id, date, shifts[1]?.id ?? null);

    const outcome = await useSchedule.getState().publish();
    expect(outcome?.ok).toBe(true);
    expect(cellShiftId(person.id, date)).toBe(shifts[1]?.id);
  });

  it('an undone edit is not published', async () => {
    const { shift, person } = personWithShift('Cover');
    if (!shift || !person) return;
    const date = freeDate(person.id);

    useSchedule.getState().setCell(person.id, date, shift.id);
    await vi.waitFor(() => {
      expect(useSchedule.getState().pendingSync).toBe(false);
    });
    useSchedule.getState().undo();

    const outcome = await useSchedule.getState().publish();
    expect(outcome?.ok).toBe(true);
    expect(cellShiftId(person.id, date)).toBeUndefined();
  });

  it('discarding the draft restores the published state', async () => {
    const { shift, person } = personWithShift('Cover');
    if (!shift || !person) return;
    const date = freeDate(person.id);

    useSchedule.getState().setCell(person.id, date, shift.id);
    await useSchedule.getState().discard();

    expect(useSchedule.getState().changes).toHaveLength(0);
    expect(cellShiftId(person.id, date)).toBeUndefined();
  });
});
