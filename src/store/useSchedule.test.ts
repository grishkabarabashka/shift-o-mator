import { beforeEach, describe, expect, it } from 'vitest';
import { useSchedule } from './useSchedule.ts';

const UNIT = 'unit-amer';
const RANGE = { from: '2026-08-01', to: '2026-08-31' } as const;

async function loadStore() {
  await useSchedule.getState().load(UNIT, RANGE);
  return useSchedule.getState();
}

/** Первый человек единицы, умеющий указанную роль. */
function personWithRole(roleCode: string) {
  const { reference } = useSchedule.getState();
  const role = reference?.roles.find((r) => r.unitId === UNIT && r.code === roleCode);
  const person = reference?.people.find(
    (p) => p.unitId === UNIT && !p.isPlannerOnly && p.eligibility.some((e) => e.roleId === role?.id),
  );
  return { role, person };
}

function cellRoleId(personId: string, date: string): string | undefined {
  return useSchedule
    .getState()
    .plan?.assignments.find((a) => a.personId === personId && a.date === date)?.roleId;
}

/**
 * Свободная ячейка человека. В фикстурах август уже частично заполнен, поэтому
 * дату нельзя писать в тесте руками: она может оказаться занятой.
 */
function freeDates(personId: string, count: number): string[] {
  const dates: string[] = [];
  for (let day = 1; day <= 31 && dates.length < count; day += 1) {
    const date = `2026-08-${String(day).padStart(2, '0')}`;
    if (cellRoleId(personId, date) === undefined) dates.push(date);
  }
  if (dates.length < count) throw new Error(`У ${personId} нет ${count} свободных дней`);
  return dates;
}

function freeDate(personId: string): string {
  return freeDates(personId, 1)[0] as string;
}

describe('загрузка', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('поднимает справочник, план и индекс', () => {
    const state = useSchedule.getState();
    expect(state.status).toBe('ready');
    expect(state.reference?.people.length).toBeGreaterThan(0);
    expect(state.plan?.assignments.length).toBeGreaterThan(0);
    expect(state.index?.roles.size).toBeGreaterThan(0);
  });

  it('назначает текущим пользователем планировщика единицы', () => {
    expect(useSchedule.getState().currentUserId).toBe('p-amer-planner');
  });

  it('сразу предлагает отгулы за уже назначенные выходные', () => {
    // В фикстурах отгулов нет: они рождаются при первом расчёте.
    const compDays = useSchedule.getState().plan?.compDays ?? [];
    expect(compDays.length).toBeGreaterThan(0);
    expect(compDays.every((entry) => entry.status === 'PROPOSED')).toBe(true);
  });
});

describe('правка ячеек', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('ставит роль в ячейку', () => {
    const { role, person } = personWithRole('CAVA');
    expect(role && person).toBeTruthy();
    if (!role || !person) return;

    const date = freeDate(person.id);
    useSchedule.getState().setCell(person.id, date, role.id);
    expect(cellRoleId(person.id, date)).toBe(role.id);
  });

  it('в ячейке остаётся одно назначение', () => {
    const { person } = personWithRole('CAVA');
    const roles = useSchedule
      .getState()
      .reference?.roles.filter((r) =>
        person?.eligibility.some((e) => e.roleId === r.id),
      ) ?? [];
    if (!person || roles.length < 2) return;

    const date = freeDate(person.id);
    useSchedule.getState().setCell(person.id, date, roles[0]?.id ?? null);
    useSchedule.getState().setCell(person.id, date, roles[1]?.id ?? null);

    const inCell = useSchedule
      .getState()
      .plan?.assignments.filter((a) => a.personId === person.id && a.date === date);
    expect(inCell).toHaveLength(1);
    expect(inCell?.[0]?.roleId).toBe(roles[1]?.id);
  });

  it('не принимает роль чужой единицы', () => {
    const { person } = personWithRole('CAVA');
    const foreignRole = useSchedule.getState().reference?.roles.find((r) => r.unitId === 'unit-emea');
    if (!person || !foreignRole) return;

    const date = freeDate(person.id);
    useSchedule.getState().setCell(person.id, date, foreignRole.id);
    expect(cellRoleId(person.id, date)).toBeUndefined();
  });

  it('красит диапазон одним патчем-батчем', () => {
    const { role, person } = personWithRole('CAVA');
    if (!role || !person) return;

    const dates = freeDates(person.id, 3);
    useSchedule.getState().setCells(
      dates.map((date) => ({ personId: person.id, date })),
      role.id,
    );

    expect(dates.every((date) => cellRoleId(person.id, date) === role.id)).toBe(true);
    // Один батч — одна отмена.
    useSchedule.getState().undo();
    expect(dates.every((date) => cellRoleId(person.id, date) !== role.id)).toBe(true);
  });
});

describe('undo и redo', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('возвращает и повторяет правку', () => {
    const { role, person } = personWithRole('CAVA');
    if (!role || !person) return;
    const date = freeDate(person.id);

    useSchedule.getState().setCell(person.id, date, role.id);
    useSchedule.getState().undo();
    expect(cellRoleId(person.id, date)).toBeUndefined();

    useSchedule.getState().redo();
    expect(cellRoleId(person.id, date)).toBe(role.id);
  });

  it('новая правка обнуляет стек повтора', () => {
    const { role, person } = personWithRole('CAVA');
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
    const { role, person } = personWithRole('CAVA');
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
    const state = useSchedule.getState();
    const people = state.reference?.people
      .filter((p) => p.unitId === 'unit-amer' && !p.isPlannerOnly)
      .slice(0, 2);
    expect(people?.length).toBe(2);
    if (!people) return;

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

    const absences = useSchedule.getState().plan?.absences ?? [];
    expect(absences.filter((a) => a.id.startsWith('abs-test-'))).toHaveLength(2);
    expect(useSchedule.getState().undoStack).toHaveLength(before + 1);

    useSchedule.getState().undo();
    const afterUndo = useSchedule.getState().plan?.absences ?? [];
    expect(afterUndo.filter((a) => a.id.startsWith('abs-test-'))).toHaveLength(0);
  });

  it('setAbsences с пустым списком не создаёт шаг отмены', () => {
    const before = useSchedule.getState().undoStack.length;
    useSchedule.getState().setAbsences([]);
    expect(useSchedule.getState().undoStack).toHaveLength(before);
  });
});

describe('сохранение', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('копит несохранённые правки и очищает очередь после сохранения', async () => {
    const { role, person } = personWithRole('CAVA');
    if (!role || !person) return;

    useSchedule.getState().setCell(person.id, freeDate(person.id), role.id);
    expect(useSchedule.getState().pending.length).toBeGreaterThan(0);

    await useSchedule.getState().save();
    expect(useSchedule.getState().pending).toHaveLength(0);
    expect(useSchedule.getState().lastSavedAt).toBeDefined();
  });
});

describe('блокировка периода', () => {
  beforeEach(async () => {
    await loadStore();
  });

  it('берётся и снимается', async () => {
    const result = await useSchedule.getState().acquireLock();
    expect(result?.ok).toBe(true);
    expect(useSchedule.getState().lock?.byPersonId).toBe('p-amer-planner');

    await useSchedule.getState().releaseLock();
    expect(useSchedule.getState().lock).toBeUndefined();
  });
});
