import { describe, expect, it } from 'vitest';
import { buildIndex } from '../domain/lookup.ts';
import {
  leadRole,
  makeAssignment,
  makeDataset,
  makePerson,
  testRegion,
} from '../domain/testkit.ts';
import type { Absence, CompDayEntry } from '../domain/types.ts';
import { rankCandidates } from './candidates.ts';

// Понедельник — будний день для всех фикстур.
const DATE = '2026-09-07';

function setup(overrides: Parameters<typeof makeDataset>[0] = {}) {
  const alice = makePerson({ id: 'p-alice', displayName: 'Alice' });
  const bob = makePerson({ id: 'p-bob', displayName: 'Bob' });
  const dataset = makeDataset({ people: [alice, bob], ...overrides });
  return { index: buildIndex(dataset), alice, bob };
}

describe('ранжирование кандидатов', () => {
  it('исключает человека без eligibility на роль', () => {
    const notEligible = makePerson({ id: 'p-carl', displayName: 'Carl', eligibility: [] });
    const { index } = setup({ people: [notEligible] });

    const result = rankCandidates({
      roleId: leadRole.id,
      date: DATE,
      regionId: testRegion.id,
      index,
      assignments: [],
      absences: [],
      compDays: [],
    });

    expect(result.available).toHaveLength(0);
    expect(result.excluded).toHaveLength(0); // не в пуле вообще, не «исключён»
  });

  it('исключает человека в отпуске с объяснением', () => {
    const { index } = setup();
    const absence: Absence = {
      id: 'abs-1',
      personId: 'p-alice',
      type: 'VACATION',
      from: '2026-09-05',
      to: '2026-09-10',
      source: 'MANUAL',
    };

    const result = rankCandidates({
      roleId: leadRole.id,
      date: DATE,
      regionId: testRegion.id,
      index,
      assignments: [],
      absences: [absence],
      compDays: [],
    });

    expect(result.available.map((c) => c.personId)).toEqual(['p-bob']);
    expect(result.excluded).toEqual([
      { personId: 'p-alice', name: 'Alice', reason: 'on leave' },
    ]);
  });

  it('исключает человека на подтверждённом отгуле, но не на предложенном', () => {
    const { index } = setup();
    const scheduled: CompDayEntry = {
      id: 'cd-1',
      personId: 'p-alice',
      earnedForAssignmentId: 'as-x',
      earnedForDate: '2026-08-30',
      trigger: 'SATURDAY',
      actualDate: DATE,
      status: 'SCHEDULED',
    };

    const result = rankCandidates({
      roleId: leadRole.id,
      date: DATE,
      regionId: testRegion.id,
      index,
      assignments: [],
      absences: [],
      compDays: [scheduled],
    });
    expect(result.available.map((c) => c.personId)).toEqual(['p-bob']);

    const proposed: CompDayEntry = { ...scheduled, id: 'cd-2', status: 'PROPOSED' };
    const stillAvailable = rankCandidates({
      roleId: leadRole.id,
      date: DATE,
      regionId: testRegion.id,
      index,
      assignments: [],
      absences: [],
      compDays: [proposed],
    });
    expect(stillAvailable.available.map((c) => c.personId).sort()).toEqual(['p-alice', 'p-bob']);
  });

  it('исключает по недоступному будню и blackout-дате', () => {
    const weekdayOnly = makePerson({
      id: 'p-carl',
      displayName: 'Carl',
      availableWeekdays: [6, 7], // только выходные — понедельник вне доступности
    });
    const blackedOut = makePerson({
      id: 'p-dora',
      displayName: 'Dora',
      preferences: { blackoutDates: [DATE] },
    });
    const { index } = setup({ people: [weekdayOnly, blackedOut] });

    const result = rankCandidates({
      roleId: leadRole.id,
      date: DATE,
      regionId: testRegion.id,
      index,
      assignments: [],
      absences: [],
      compDays: [],
    });

    const reasons = new Map(result.excluded.map((e) => [e.personId, e.reason]));
    expect(reasons.get('p-carl')).toBe('not available this weekday');
    expect(reasons.get('p-dora')).toBe('blackout date');
  });

  it('ставит выше того, кто реже держал роль за 90 дней', () => {
    const { index } = setup();
    const assignments = [
      makeAssignment('p-alice', leadRole.id, '2026-08-10'),
      makeAssignment('p-alice', leadRole.id, '2026-08-17'),
      makeAssignment('p-alice', leadRole.id, '2026-08-24'),
    ];

    const result = rankCandidates({
      roleId: leadRole.id,
      date: DATE,
      regionId: testRegion.id,
      index,
      assignments,
      absences: [],
      compDays: [],
    });

    // Bob ни разу не держал роль — он идёт первым, несмотря на алфавит.
    expect(result.available.map((c) => c.personId)).toEqual(['p-bob', 'p-alice']);
    expect(result.available[1]?.roleCountLast90).toBe(3);
  });

  it('назначения за пределами 90-дневного окна не считаются', () => {
    const { index } = setup();
    const assignments = [
      // 95 дней до DATE — уже вне окна.
      makeAssignment('p-alice', leadRole.id, '2026-06-04'),
    ];

    const result = rankCandidates({
      roleId: leadRole.id,
      date: DATE,
      regionId: testRegion.id,
      index,
      assignments,
      absences: [],
      compDays: [],
    });

    const alice = result.available.find((c) => c.personId === 'p-alice');
    expect(alice?.roleCountLast90).toBe(0);
  });

  it('давний держатель роли отодвигается недавним', () => {
    const { index } = setup();
    const assignments = [
      makeAssignment('p-alice', leadRole.id, '2026-09-01'), // 6 дней назад
      makeAssignment('p-bob', leadRole.id, '2026-08-01'), // 37 дней назад
    ];

    const result = rankCandidates({
      roleId: leadRole.id,
      date: DATE,
      regionId: testRegion.id,
      index,
      assignments,
      absences: [],
      compDays: [],
    });

    // Оба держали ровно один раз — решает давность: Bob держал давнее.
    expect(result.available.map((c) => c.personId)).toEqual(['p-bob', 'p-alice']);
  });

  it('превышение недельного максимума понижает, но не исключает', () => {
    const capped = makePerson({
      id: 'p-eve',
      displayName: 'Eve',
      eligibility: [{ roleId: leadRole.id, targetShare: 1, maxPerWeek: 1 }],
    });
    const { index } = setup({ people: [capped] });
    // Уже одна смена на этой ISO-неделе (DATE — понедельник той же недели).
    const assignments = [makeAssignment('p-eve', leadRole.id, '2026-09-08')];

    const result = rankCandidates({
      roleId: leadRole.id,
      date: DATE,
      regionId: testRegion.id,
      index,
      assignments,
      absences: [],
      compDays: [],
    });

    expect(result.available.map((c) => c.personId)).toContain('p-eve');
    const eve = result.available.find((c) => c.personId === 'p-eve');
    expect(eve?.warnings).toEqual(['would exceed 1 shifts this week']);
  });

  it('уже занятые сегодня чем-то другим попадают в excluded с честной причиной', () => {
    // Раньше такие люди пропадали без следа: единственный eligible человек,
    // занятый другой ролью, превращал «занят» в ложное «никто не eligible».
    const { index } = setup();

    const result = rankCandidates({
      roleId: leadRole.id,
      date: DATE,
      regionId: testRegion.id,
      index,
      assignments: [],
      absences: [],
      compDays: [],
      excludePersonIds: new Set(['p-alice']),
    });

    expect(result.available.map((c) => c.personId)).toEqual(['p-bob']);
    expect(result.excluded).toEqual([
      { personId: 'p-alice', name: 'Alice', reason: 'already assigned to something else that day' },
    ]);
  });

  it('порядок детерминирован при полном равенстве кандидатов', () => {
    const { index } = setup();
    const run = () =>
      rankCandidates({
        roleId: leadRole.id,
        date: DATE,
        regionId: testRegion.id,
        index,
        assignments: [],
        absences: [],
        compDays: [],
      }).available.map((c) => c.personId);

    expect(run()).toEqual(run());
    expect(run()).toEqual(['p-alice', 'p-bob']); // алфавитный tie-break
  });
});
