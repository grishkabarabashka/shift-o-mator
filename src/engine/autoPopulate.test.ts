import { describe, expect, it } from 'vitest';
import { buildIndex } from '../domain/lookup.ts';
import {
  leadRole,
  makeAssignment,
  makeDataset,
  makeDayConfig,
  makePerson,
  nightRole,
  testRegion,
} from '../domain/testkit.ts';
import { AUTO_POPULATE_MAX_DAYS, autoPopulate } from './autoPopulate.ts';

// 2026-09-07 понедельник; неделя закрывается воскресеньем 2026-09-13.
const RANGE = { from: '2026-09-07', to: '2026-09-13' };

const weekdayConfig = makeDayConfig({
  id: 'dc-weekday',
  key: 'weekday',
  weekdays: [1, 2, 3, 4, 5],
  roleRequirements: [{ roleId: leadRole.id, min: 1, isDefault: true }],
});

const weekendConfig = makeDayConfig({
  id: 'dc-weekend',
  key: 'weekend',
  weekdays: [6, 7],
  roleRequirements: [{ roleId: nightRole.id, min: 1, isDefault: false }],
});

function run(overrides: Parameters<typeof makeDataset>[0] & { locked?: string[] } = {}) {
  const { locked, ...datasetOverrides } = overrides;
  const dataset = makeDataset({
    dayConfigurations: [weekdayConfig, weekendConfig],
    ...datasetOverrides,
  });
  const index = buildIndex(dataset);
  return autoPopulate({
    regionId: testRegion.id,
    range: RANGE,
    lockedAssignmentIds: new Set(locked ?? []),
    assignments: dataset.assignments,
    absences: dataset.absences,
    compDays: dataset.compDays,
    index,
    actorId: 'p-planner',
    now: '2026-09-01T00:00:00Z',
  });
}

describe('автозаполнение — дефолты', () => {
  it('ставит defaultRoleId человеку на его будние дни', () => {
    const alice = makePerson({
      id: 'p-alice',
      defaultRoleId: leadRole.id,
      eligibility: [
        { roleId: leadRole.id, targetShare: 1 },
        { roleId: nightRole.id, targetShare: 0 },
      ],
    });
    const result = run({ people: [alice] });

    const weekdayCreates = result.changes.filter(
      (c) =>
        c.targetType === 'ASSIGNMENT' &&
        c.after?.content.kind === 'ROLE' &&
        c.after.content.roleId === leadRole.id,
    );
    // Пн–Пт этой недели — пять дней.
    expect(weekdayCreates).toHaveLength(5);
    expect(weekdayCreates.every((c) => c.after?.personId === 'p-alice')).toBe(true);
  });

  it('не трогает уже занятую ячейку', () => {
    const alice = makePerson({ id: 'p-alice', defaultRoleId: leadRole.id });
    const existing = makeAssignment('p-alice', nightRole.id, '2026-09-08'); // вторник, уже занят
    const result = run({ people: [alice], assignments: [existing] });

    const touchedTuesday = result.changes.some(
      (c) => c.targetType === 'ASSIGNMENT' && c.after?.personId === 'p-alice' && c.after.date === '2026-09-08',
    );
    expect(touchedTuesday).toBe(false);
  });

  it('не трогает заблокированную ячейку, даже если она пуста в другом смысле', () => {
    // Блокировка снимает роль с рассмотрения целиком — генерация не видит день.
    const alice = makePerson({ id: 'p-alice', defaultRoleId: leadRole.id });
    const locked = makeAssignment('p-alice', leadRole.id, '2026-09-07', { id: 'as-locked' });
    const result = run({ people: [alice], assignments: [locked], locked: ['as-locked'] });

    const mondayChanges = result.changes.filter(
      (c) => c.targetType === 'ASSIGNMENT' && c.after?.personId === 'p-alice' && c.after.date === '2026-09-07',
    );
    expect(mondayChanges).toHaveLength(0);
  });

  it('несовпадающий дефолт не используется в проходе A', () => {
    // Дефолт — ночная роль, а будняя группа требует дневную: дефолт не
    // подходит дню, и остаток (проход B) закрыть некем — eligibility нет.
    const bob = makePerson({
      id: 'p-bob',
      defaultRoleId: nightRole.id,
      eligibility: [{ roleId: nightRole.id, targetShare: 1 }],
    });
    const result = run({ people: [bob] });

    const weekdayLead = result.changes.some(
      (c) =>
        c.targetType === 'ASSIGNMENT' &&
        c.after?.content.kind === 'ROLE' &&
        c.after.content.roleId === leadRole.id,
    );
    expect(weekdayLead).toBe(false);
    expect(result.gaps.some((g) => g.roleId === leadRole.id)).toBe(true);
  });
});

describe('автозаполнение — остаток по ранжированию', () => {
  it('закрывает выходную роль без дефолта через кандидатов', () => {
    const alice = makePerson({
      id: 'p-alice',
      eligibility: [{ roleId: nightRole.id, targetShare: 1 }],
    });
    const result = run({ people: [alice] });

    // Сб 12, Вс 13 — единственные выходные дни диапазона.
    const weekendCreates = result.changes.filter(
      (c) =>
        c.targetType === 'ASSIGNMENT' &&
        (c.after?.date === '2026-09-12' || c.after?.date === '2026-09-13'),
    );
    expect(weekendCreates).toHaveLength(2);
    expect(weekendCreates.every((c) => c.after?.personId === 'p-alice')).toBe(true);
  });

  it('оставляет дыру с причиной, если закрыть некем', () => {
    const alice = makePerson({
      id: 'p-alice',
      eligibility: [{ roleId: nightRole.id, targetShare: 1 }],
      availableWeekdays: [1, 2, 3, 4, 5], // выходные вне доступности
    });
    const result = run({ people: [alice] });

    const gap = result.gaps.find((g) => g.roleId === nightRole.id);
    expect(gap).toBeDefined();
    expect(gap?.reason).toMatch(/not available this weekday/);
  });

  it('генерирует отгул за только что созданную выходную смену', () => {
    const alice = makePerson({
      id: 'p-alice',
      eligibility: [{ roleId: nightRole.id, targetShare: 1 }],
    });
    const result = run({ people: [alice] });

    const compDayCreates = result.changes.filter((c) => c.targetType === 'COMP_DAY');
    expect(compDayCreates.length).toBeGreaterThan(0);
    expect(compDayCreates[0]?.after?.personId).toBe('p-alice');
  });
});

describe('автозаполнение — детерминизм', () => {
  it('одинаковый вход даёт одинаковый набор изменений', () => {
    const alice = makePerson({
      id: 'p-alice',
      defaultRoleId: leadRole.id,
      eligibility: [
        { roleId: leadRole.id, targetShare: 1 },
        { roleId: nightRole.id, targetShare: 1 },
      ],
    });
    const bob = makePerson({
      id: 'p-bob',
      eligibility: [{ roleId: nightRole.id, targetShare: 1 }],
    });

    const a = run({ people: [alice, bob] });
    const b = run({ people: [alice, bob] });

    const summarize = (result: ReturnType<typeof run>) =>
      result.changes
        .map((c) =>
          c.targetType === 'ASSIGNMENT'
            ? `${c.after?.personId}|${c.after?.date}|${c.targetType}`
            : `${c.after?.personId}|${c.targetType}`,
        )
        .sort();

    expect(summarize(a)).toEqual(summarize(b));
  });
});

it('ограничение диапазона задокументировано константой', () => {
  expect(AUTO_POPULATE_MAX_DAYS).toBe(92);
});
