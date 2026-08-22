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
import { leadShift, makeAssignment, nightShift } from './testkit.ts';
import type { Absence, CompDayEntry, PlanData } from './types.ts';

const emptyPlan: PlanData = {
  assignments: [],
  absences: [],
  compDays: [],
  acknowledgements: [],
};

const AT = '2026-09-07T10:00:00Z';

const lead = makeAssignment('p-1', leadShift.id, '2026-09-09');
const night = makeAssignment('p-1', nightShift.id, '2026-09-09');

describe('assignment changes', () => {
  it('places an assignment into an empty cell', () => {
    const change = assignmentChange(null, lead, 0, AT);
    expect(change.op).toBe('CREATE');
    expect(applyChange(emptyPlan, change).assignments).toEqual([lead]);
  });

  it('keeps at most one assignment per cell', () => {
    const plan = applyChanges(emptyPlan, [
      assignmentChange(null, lead, 0, AT),
      assignmentChange(lead, night, 1, AT),
    ]);
    expect(plan.assignments).toEqual([night]);
  });

  it('clears a cell', () => {
    const plan = applyChanges(emptyPlan, [
      assignmentChange(null, lead, 0, AT),
      assignmentChange(lead, null, 1, AT),
    ]);
    expect(plan.assignments).toEqual([]);
  });

  it('does not touch neighboring cells', () => {
    const other = makeAssignment('p-2', leadShift.id, '2026-09-09');
    const plan = applyChanges(emptyPlan, [
      assignmentChange(null, lead, 0, AT),
      assignmentChange(null, other, 1, AT),
      assignmentChange(lead, null, 2, AT),
    ]);
    expect(plan.assignments).toEqual([other]);
  });

  it('applies changes in seq order, not array order', () => {
    const plan = applyChanges(emptyPlan, [
      assignmentChange(lead, null, 2, AT),
      assignmentChange(null, lead, 0, AT),
      assignmentChange(lead, night, 1, AT),
    ]);
    expect(plan.assignments).toEqual([]);
  });
});

describe('absence and comp-day changes', () => {
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

  it('adds and removes an absence by id', () => {
    const added = applyChange(emptyPlan, absenceChange(null, absence, 0, AT));
    expect(added.absences).toEqual([absence]);
    const removed = applyChange(added, absenceChange(absence, null, 1, AT));
    expect(removed.absences).toEqual([]);
  });

  it('updates a comp day in place', () => {
    const added = applyChange(emptyPlan, compDayChange(null, entry, 0, AT));
    const confirmed: CompDayEntry = { ...entry, status: 'SCHEDULED', actualDate: '2026-09-03' };
    const updated = applyChange(added, compDayChange(entry, confirmed, 1, AT));
    expect(updated.compDays).toHaveLength(1);
    expect(updated.compDays[0]?.status).toBe('SCHEDULED');
  });

  it('different target types do not interfere with each other', () => {
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

describe('inversion', () => {
  it('an inverted change restores the prior state', () => {
    const change = assignmentChange(null, lead, 0, AT);
    const applied = applyChange(emptyPlan, change);
    expect(applyChange(applied, invertChange(change))).toEqual(emptyPlan);
  });

  it('inversion swaps the op', () => {
    expect(invertChange(assignmentChange(null, lead, 0, AT)).op).toBe('DELETE');
    expect(invertChange(assignmentChange(lead, null, 0, AT)).op).toBe('CREATE');
    expect(invertChange(assignmentChange(lead, night, 0, AT)).op).toBe('UPDATE');
  });

  it('a batch is undone in reverse order', () => {
    const batch = [
      assignmentChange(null, lead, 0, AT),
      assignmentChange(null, makeAssignment('p-1', nightShift.id, '2026-09-10'), 1, AT),
    ];
    const applied = applyChanges(emptyPlan, batch);
    expect(applyChanges(applied, invertAll(batch))).toEqual(emptyPlan);
  });

  it('undoing a role swap restores the previous role', () => {
    const batch = [assignmentChange(null, lead, 0, AT), assignmentChange(lead, night, 1, AT)];
    const applied = applyChanges(emptyPlan, batch);
    const undone = applyChanges(applied, invertAll([batch[1] as never]));
    expect(undone.assignments).toEqual([lead]);
  });
});

describe('other', () => {
  it('recognizes a change that changes nothing', () => {
    expect(isNoop(assignmentChange(null, null, 0, AT))).toBe(true);
    expect(isNoop(assignmentChange(lead, { ...lead, version: 2 }, 0, AT))).toBe(true);
    expect(isNoop(assignmentChange(null, lead, 0, AT))).toBe(false);
    expect(isNoop(assignmentChange(lead, night, 0, AT))).toBe(false);
  });

  it('computes the summary for the review screen', () => {
    const summary = summarizeChanges([
      assignmentChange(null, lead, 0, AT),
      assignmentChange(lead, night, 1, AT),
      assignmentChange(night, null, 2, AT),
    ]);
    expect(summary).toEqual({ created: 1, updated: 1, deleted: 1 });
  });
});
