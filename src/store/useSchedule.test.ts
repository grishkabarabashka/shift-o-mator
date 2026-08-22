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

/** Первый человек единицы, умеющий роль с этим кодом. */
function personWithRole(code: string) {
  const { reference } = useSchedule.getState();
  const role = reference?.roles.find((r) => r.regionId === 'AMER' && r.code === code);
  const person = reference?.people.find(
    (p) =>
      p.unitId === DEFAULT_UNIT &&
      p.isIncluded &&
      p.eligibility.some((e) => e.roleId === role?.id),
  );
  return { role, person };
}

function cellRoleId(personId: string, date: string): string | undefined {
  const assignment = useSchedule
    .getState()
    .plan?.assignments.find((a) => a.personId === personId && a.date === date);
  return assignment?.content.kind === 'ROLE' ? assignment.content.roleId : undefined;
}

/** Свободные будни человека — датасет тестов не заполнен, любой будний день свободен. */
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

describe('загрузка', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('поднимает справочник, опубликованный план и индекс', () => {
    const state = useSchedule.getState();
    expect(state.status).toBe('ready');
    expect(state.reference?.people.length).toBeGreaterThan(0);
    expect(state.index?.roles.size).toBeGreaterThan(0);
  });

  it('открытый черновик пуст, план равен опубликованному', () => {
    const state = useSchedule.getState();
    expect(state.session).toBeDefined();
    expect(state.changes).toHaveLength(0);
    expect(state.plan?.assignments).toEqual(state.published?.assignments);
  });
});

describe('правка ячеек', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('ставит роль в ячейку', () => {
    const { role, person } = personWithRole('Cover');
    expect(role && person).toBeTruthy();
    if (!role || !person) return;

    const date = freeDate(person.id);
    useSchedule.getState().setCell(person.id, date, role.id);
    expect(cellRoleId(person.id, date)).toBe(role.id);
  });

  it('правка не трогает опубликованные данные', () => {
    const { role, person } = personWithRole('Cover');
    if (!role || !person) return;
    const date = freeDate(person.id);
    const publishedBefore = useSchedule.getState().published?.assignments.length;

    useSchedule.getState().setCell(person.id, date, role.id);

    expect(useSchedule.getState().published?.assignments.length).toBe(publishedBefore);
    expect(useSchedule.getState().changes.length).toBeGreaterThan(0);
  });

  it('в ячейке остаётся одно назначение', () => {
    const { person } = personWithRole('Cover');
    if (!person) return;
    const roles = useSchedule
      .getState()
      .reference?.roles.filter((r) => person.eligibility.some((e) => e.roleId === r.id)) ?? [];
    if (roles.length < 2) return;

    const date = freeDate(person.id);
    useSchedule.getState().setCell(person.id, date, roles[0]?.id ?? null);
    useSchedule.getState().setCell(person.id, date, roles[1]?.id ?? null);

    const inCell = useSchedule
      .getState()
      .plan?.assignments.filter((a) => a.personId === person.id && a.date === date);
    expect(inCell).toHaveLength(1);
    expect(cellRoleId(person.id, date)).toBe(roles[1]?.id);
  });

  it('не принимает роль чужого региона', () => {
    const { person } = personWithRole('Cover');
    const foreignRole = useSchedule
      .getState()
      .reference?.roles.find((r) => r.regionId === 'EMEA');
    if (!person || !foreignRole) return;

    const date = freeDate(person.id);
    useSchedule.getState().setCell(person.id, date, foreignRole.id);
    expect(cellRoleId(person.id, date)).toBeUndefined();
  });

  it('ставит маркер ростера', () => {
    const { person } = personWithRole('Cover');
    if (!person) return;
    const date = freeDate(person.id);

    useSchedule.getState().setMarker([{ personId: person.id, date }], 'OFF');
    const assignment = useSchedule
      .getState()
      .plan?.assignments.find((a) => a.personId === person.id && a.date === date);
    expect(assignment?.content).toEqual({ kind: 'MARKER', marker: 'OFF' });
  });

  it('красит диапазон одним батчем', () => {
    const { role, person } = personWithRole('Cover');
    if (!role || !person) return;

    const dates = freeDates(person.id, 3);
    useSchedule.getState().setCells(
      dates.map((date) => ({ personId: person.id, date })),
      role.id,
    );
    expect(dates.every((date) => cellRoleId(person.id, date) === role.id)).toBe(true);

    useSchedule.getState().undo();
    expect(dates.every((date) => cellRoleId(person.id, date) !== role.id)).toBe(true);
  });
});

describe('undo и redo', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('возвращает и повторяет правку', () => {
    const { role, person } = personWithRole('Cover');
    if (!role || !person) return;
    const date = freeDate(person.id);

    useSchedule.getState().setCell(person.id, date, role.id);
    useSchedule.getState().undo();
    expect(cellRoleId(person.id, date)).toBeUndefined();

    useSchedule.getState().redo();
    expect(cellRoleId(person.id, date)).toBe(role.id);
  });

  it('новая правка обнуляет стек повтора', () => {
    const { role, person } = personWithRole('Cover');
    if (!role || !person) return;
    const [first, second] = freeDates(person.id, 2);

    useSchedule.getState().setCell(person.id, first as string, role.id);
    useSchedule.getState().undo();
    expect(useSchedule.getState().redoStack).toHaveLength(1);

    useSchedule.getState().setCell(person.id, second as string, role.id);
    expect(useSchedule.getState().redoStack).toHaveLength(0);
  });

  it('отмена на пустом стеке ничего не ломает', () => {
    const snapshot = useSchedule.getState().plan;
    useSchedule.getState().undo();
    expect(useSchedule.getState().plan).toBe(snapshot);
  });

  it('правка, ничего не меняющая, в стек не попадает', () => {
    const { role, person } = personWithRole('Cover');
    if (!role || !person) return;

    const date = freeDate(person.id);
    useSchedule.getState().setCell(person.id, date, role.id);
    const depth = useSchedule.getState().undoStack.length;
    useSchedule.getState().setCell(person.id, date, role.id);
    expect(useSchedule.getState().undoStack).toHaveLength(depth);
  });
});

describe('отсутствия', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('setAbsences создаёт несколько записей одним батчем undo', () => {
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

  it('пустой список не создаёт шаг отмены', () => {
    const before = useSchedule.getState().undoStack.length;
    useSchedule.getState().setAbsences([]);
    expect(useSchedule.getState().undoStack).toHaveLength(before);
  });
});

describe('синхронизация с сервером (debounce)', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('правка помечает pendingSync и снимает его после флаша', async () => {
    const { role, person } = personWithRole('Cover');
    if (!role || !person) return;
    const date = freeDate(person.id);

    useSchedule.getState().setCell(person.id, date, role.id);
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

describe('публикация', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('публикует черновик и очищает его', async () => {
    const { role, person } = personWithRole('Cover');
    if (!role || !person) return;
    const date = freeDate(person.id);

    useSchedule.getState().setCell(person.id, date, role.id);
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
    expect(cellRoleId(person.id, date)).toBe(role.id);
  });

  it('отмена черновика возвращает опубликованное состояние', async () => {
    const { role, person } = personWithRole('Cover');
    if (!role || !person) return;
    const date = freeDate(person.id);

    useSchedule.getState().setCell(person.id, date, role.id);
    await useSchedule.getState().discard();

    expect(useSchedule.getState().changes).toHaveLength(0);
    expect(cellRoleId(person.id, date)).toBeUndefined();
  });
});
