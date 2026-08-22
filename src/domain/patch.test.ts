import { describe, expect, it } from 'vitest';
import { applyPatch, applyPatches, invert, invertAll, isNoop, type Patch } from './patch.ts';
import { leadRole, makeAssignment, nightRole } from './testkit.ts';
import type { PlanData } from './types.ts';

const emptyPlan: PlanData = {
  assignments: [],
  absences: [],
  compDays: [],
  acknowledgements: [],
};

const lead = makeAssignment('p-1', leadRole.id, '2026-09-09');
const night = makeAssignment('p-1', nightRole.id, '2026-09-09');

const setLead: Patch = {
  kind: 'SET_CELL',
  personId: 'p-1',
  date: '2026-09-09',
  before: null,
  after: lead,
};

describe('патчи ячеек', () => {
  it('ставят назначение в пустую ячейку', () => {
    expect(applyPatch(emptyPlan, setLead).assignments).toEqual([lead]);
  });

  it('в ячейке остаётся не больше одного назначения', () => {
    const plan = applyPatches(emptyPlan, [
      setLead,
      { kind: 'SET_CELL', personId: 'p-1', date: '2026-09-09', before: lead, after: night },
    ]);
    expect(plan.assignments).toEqual([night]);
  });

  it('очищают ячейку', () => {
    const plan = applyPatches(emptyPlan, [
      setLead,
      { kind: 'SET_CELL', personId: 'p-1', date: '2026-09-09', before: lead, after: null },
    ]);
    expect(plan.assignments).toEqual([]);
  });

  it('не задевают соседние ячейки', () => {
    const other = makeAssignment('p-2', leadRole.id, '2026-09-09');
    const plan = applyPatches(emptyPlan, [
      setLead,
      { kind: 'SET_CELL', personId: 'p-2', date: '2026-09-09', before: null, after: other },
      { kind: 'SET_CELL', personId: 'p-1', date: '2026-09-09', before: lead, after: null },
    ]);
    expect(plan.assignments).toEqual([other]);
  });
});

describe('обращение патчей', () => {
  it('обратный патч возвращает состояние', () => {
    const applied = applyPatch(emptyPlan, setLead);
    expect(applyPatch(applied, invert(setLead))).toEqual(emptyPlan);
  });

  it('батч отменяется в обратном порядке', () => {
    const batch: Patch[] = [
      setLead,
      { kind: 'SET_CELL', personId: 'p-1', date: '2026-09-10', before: null, after: night },
    ];
    const applied = applyPatches(emptyPlan, batch);
    expect(applyPatches(applied, invertAll(batch))).toEqual(emptyPlan);
  });
});

describe('подтверждения', () => {
  it('на один ключ приходится одно подтверждение', () => {
    const first = {
      issueKey: 'COVERAGE_BELOW_TARGET|2026-09-09||r-sl',
      comment: 'первое',
      byPersonId: 'p-planner',
      at: '2026-09-07T10:00:00Z',
    };
    const second = { ...first, comment: 'второе', at: '2026-09-07T11:00:00Z' };
    const plan = applyPatches(emptyPlan, [
      { kind: 'SET_ACK', before: null, after: first },
      { kind: 'SET_ACK', before: first, after: second },
    ]);
    expect(plan.acknowledgements).toEqual([second]);
  });
});

describe('пустые патчи', () => {
  it('распознаёт правку, ничего не меняющую', () => {
    expect(
      isNoop({ kind: 'SET_CELL', personId: 'p-1', date: '2026-09-09', before: null, after: null }),
    ).toBe(true);
    expect(isNoop(setLead)).toBe(false);
  });
});
