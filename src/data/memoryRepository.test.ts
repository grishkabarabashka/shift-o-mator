import { beforeEach, describe, expect, it } from 'vitest';
import { makeAssignment } from '../domain/testkit.ts';
import type { Patch } from '../domain/patch.ts';
import { MemoryScheduleRepository } from './memoryRepository.ts';

const RANGE = { from: '2026-08-01', to: '2026-08-31' } as const;
const UNIT = 'unit-amer';

function repo() {
  return new MemoryScheduleRepository({ persist: false });
}

describe('загрузка', () => {
  it('отдаёт справочник целиком', async () => {
    const reference = await repo().loadReference();
    expect(reference.units).toHaveLength(4);
    expect(reference.people.length).toBeGreaterThan(70);
    expect(reference.roles.some((role) => role.unitId === UNIT)).toBe(true);
  });

  it('план ограничен единицей и периодом', async () => {
    const repository = repo();
    const reference = await repository.loadReference();
    const plan = await repository.loadPlan(UNIT, RANGE);
    const unitPeople = new Set(
      reference.people.filter((person) => person.unitId === UNIT).map((person) => person.id),
    );

    expect(plan.assignments.length).toBeGreaterThan(0);
    expect(plan.assignments.every((a) => unitPeople.has(a.personId))).toBe(true);
    expect(plan.assignments.every((a) => a.date >= RANGE.from && a.date <= RANGE.to)).toBe(true);
  });

  it('отдаёт отпуска, начавшиеся до периода', async () => {
    const repository = repo();
    const before = await repository.loadPlan(UNIT, { from: '2026-08-10', to: '2026-08-12' });
    expect(before.absences.every((a) => a.to >= '2026-08-10' && a.from <= '2026-08-12')).toBe(true);
  });
});

describe('сохранение', () => {
  it('применяет патчи и возвращает обновлённый план', async () => {
    const repository = repo();
    const reference = await repository.loadReference();
    const person = reference.people.find((p) => p.unitId === UNIT && !p.isPlannerOnly);
    const roleId = person?.eligibility[0]?.roleId;
    expect(person && roleId).toBeTruthy();
    if (!person || !roleId) return;

    const assignment = makeAssignment(person.id, roleId, '2026-08-05');
    const patch: Patch = {
      kind: 'SET_CELL',
      personId: person.id,
      date: '2026-08-05',
      before: null,
      after: assignment,
    };

    const plan = await repository.savePatches(UNIT, RANGE, [patch]);
    const saved = plan.assignments.filter(
      (a) => a.personId === person.id && a.date === '2026-08-05',
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]?.roleId).toBe(roleId);
  });
});

describe('блокировка периода', () => {
  let repository: MemoryScheduleRepository;

  beforeEach(() => {
    repository = repo();
  });

  it('свободный период берётся', async () => {
    const result = await repository.acquireLock(UNIT, RANGE, 'p-a');
    expect(result.ok).toBe(true);
    expect(await repository.getLock(UNIT, RANGE)).toBeDefined();
  });

  it('занятый период вторым человеком не берётся', async () => {
    await repository.acquireLock(UNIT, RANGE, 'p-a');
    const result = await repository.acquireLock(UNIT, RANGE, 'p-b');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.heldBy.byPersonId).toBe('p-a');
  });

  it('блокировка распространяется на пересекающийся период', async () => {
    await repository.acquireLock(UNIT, RANGE, 'p-a');
    const result = await repository.acquireLock(
      UNIT,
      { from: '2026-08-20', to: '2026-09-20' },
      'p-b',
    );
    expect(result.ok).toBe(false);
  });

  it('соседняя единица не блокируется', async () => {
    await repository.acquireLock(UNIT, RANGE, 'p-a');
    const result = await repository.acquireLock('unit-emea', RANGE, 'p-b');
    expect(result.ok).toBe(true);
  });

  it('владелец снимает свою блокировку', async () => {
    await repository.acquireLock(UNIT, RANGE, 'p-a');
    await repository.releaseLock(UNIT, RANGE, 'p-b');
    expect(await repository.getLock(UNIT, RANGE)).toBeDefined();
    await repository.releaseLock(UNIT, RANGE, 'p-a');
    expect(await repository.getLock(UNIT, RANGE)).toBeUndefined();
  });
});

describe('экспорт и импорт', () => {
  it('состояние переживает круг через JSON', async () => {
    const source = repo();
    const json = await source.exportJson();

    const target = new MemoryScheduleRepository({ persist: false });
    await target.importJson(json);

    expect((await target.loadPlan(UNIT, RANGE)).assignments).toEqual(
      (await source.loadPlan(UNIT, RANGE)).assignments,
    );
  });

  it('чужой JSON отвергается', async () => {
    await expect(repo().importJson('{"foo":1}')).rejects.toThrow(/не похож/);
  });
});
