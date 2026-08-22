import { describe, expect, it } from 'vitest';
import {
  absenceChange,
  applyChange,
  applyChanges,
  assignmentChange,
  compDayChange,
  invertAll,
  invertChange,
  isNoop,
  summarizeChanges,
} from './draft.ts';
import { leadRole, makeAssignment, nightRole } from './testkit.ts';
import type { Absence, CompDayEntry, PlanData } from './types.ts';

const emptyPlan: PlanData = {
  assignments: [],
  absences: [],
  compDays: [],
  acknowledgements: [],
};

const AT = '2026-09-07T10:00:00Z';

const lead = makeAssignment('p-1', leadRole.id, '2026-09-09');
const night = makeAssignment('p-1', nightRole.id, '2026-09-09');

describe('изменения назначений', () => {
  it('ставит назначение в пустую ячейку', () => {
    const change = assignmentChange(null, lead, 0, AT);
    expect(change.op).toBe('CREATE');
    expect(applyChange(emptyPlan, change).assignments).toEqual([lead]);
  });

  it('в ячейке остаётся не больше одного назначения', () => {
    const plan = applyChanges(emptyPlan, [
      assignmentChange(null, lead, 0, AT),
      assignmentChange(lead, night, 1, AT),
    ]);
    expect(plan.assignments).toEqual([night]);
  });

  it('очищает ячейку', () => {
    const plan = applyChanges(emptyPlan, [
      assignmentChange(null, lead, 0, AT),
      assignmentChange(lead, null, 1, AT),
    ]);
    expect(plan.assignments).toEqual([]);
  });

  it('не задевает соседние ячейки', () => {
    const other = makeAssignment('p-2', leadRole.id, '2026-09-09');
    const plan = applyChanges(emptyPlan, [
      assignmentChange(null, lead, 0, AT),
      assignmentChange(null, other, 1, AT),
      assignmentChange(lead, null, 2, AT),
    ]);
    expect(plan.assignments).toEqual([other]);
  });

  it('применяет изменения в порядке seq, а не в порядке массива', () => {
    const plan = applyChanges(emptyPlan, [
      assignmentChange(lead, null, 2, AT),
      assignmentChange(null, lead, 0, AT),
      assignmentChange(lead, night, 1, AT),
    ]);
    expect(plan.assignments).toEqual([]);
  });
});

describe('изменения отсутствий и отгулов', () => {
  const absence: Absence = {
    id: 'abs-1',
    personId: 'p-1',
    type: 'VACATION',
    from: '2026-09-09',
    to: '2026-09-11',
    source: 'MANUAL',
  };

  const entry: CompDayEntry = {
    id: 'cd-1',
    personId: 'p-1',
    earnedForAssignmentId: 'as-1',
    earnedForDate: '2026-09-05',
    trigger: 'SATURDAY',
    proposedDate: '2026-09-03',
    status: 'PROPOSED',
  };

  it('добавляет и удаляет отсутствие по id', () => {
    const added = applyChange(emptyPlan, absenceChange(null, absence, 0, AT));
    expect(added.absences).toEqual([absence]);
    const removed = applyChange(added, absenceChange(absence, null, 1, AT));
    expect(removed.absences).toEqual([]);
  });

  it('обновляет отгул на месте', () => {
    const added = applyChange(emptyPlan, compDayChange(null, entry, 0, AT));
    const confirmed: CompDayEntry = { ...entry, status: 'SCHEDULED', actualDate: '2026-09-03' };
    const updated = applyChange(added, compDayChange(entry, confirmed, 1, AT));
    expect(updated.compDays).toHaveLength(1);
    expect(updated.compDays[0]?.status).toBe('SCHEDULED');
  });

  it('разные типы целей не мешают друг другу', () => {
    const plan = applyChanges(emptyPlan, [
      assignmentChange(null, lead, 0, AT),
      absenceChange(null, absence, 1, AT),
      compDayChange(null, entry, 2, AT),
    ]);
    expect(plan.assignments).toHaveLength(1);
    expect(plan.absences).toHaveLength(1);
    expect(plan.compDays).toHaveLength(1);
  });
});

describe('обращение', () => {
  it('обратное изменение возвращает состояние', () => {
    const change = assignmentChange(null, lead, 0, AT);
    const applied = applyChange(emptyPlan, change);
    expect(applyChange(applied, invertChange(change))).toEqual(emptyPlan);
  });

  it('обращение переставляет op', () => {
    expect(invertChange(assignmentChange(null, lead, 0, AT)).op).toBe('DELETE');
    expect(invertChange(assignmentChange(lead, null, 0, AT)).op).toBe('CREATE');
    expect(invertChange(assignmentChange(lead, night, 0, AT)).op).toBe('UPDATE');
  });

  it('батч отменяется в обратном порядке', () => {
    const batch = [
      assignmentChange(null, lead, 0, AT),
      assignmentChange(null, makeAssignment('p-1', nightRole.id, '2026-09-10'), 1, AT),
    ];
    const applied = applyChanges(emptyPlan, batch);
    expect(applyChanges(applied, invertAll(batch))).toEqual(emptyPlan);
  });

  it('отмена замены роли возвращает прежнюю роль', () => {
    const batch = [assignmentChange(null, lead, 0, AT), assignmentChange(lead, night, 1, AT)];
    const applied = applyChanges(emptyPlan, batch);
    const undone = applyChanges(applied, invertAll([batch[1] as never]));
    expect(undone.assignments).toEqual([lead]);
  });
});

describe('прочее', () => {
  it('распознаёт изменение, ничего не меняющее', () => {
    expect(isNoop(assignmentChange(null, null, 0, AT))).toBe(true);
    expect(isNoop(assignmentChange(lead, { ...lead, version: 2 }, 0, AT))).toBe(true);
    expect(isNoop(assignmentChange(null, lead, 0, AT))).toBe(false);
    expect(isNoop(assignmentChange(lead, night, 0, AT))).toBe(false);
  });

  it('считает сводку для экрана review', () => {
    const summary = summarizeChanges([
      assignmentChange(null, lead, 0, AT),
      assignmentChange(lead, night, 1, AT),
      assignmentChange(night, null, 2, AT),
    ]);
    expect(summary).toEqual({ created: 1, updated: 1, deleted: 1 });
  });
});
