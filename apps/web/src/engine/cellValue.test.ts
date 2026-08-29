import { describe, expect, it } from 'vitest';
import { buildIndex } from '../domain/lookup.ts';
import { leadShift, makeAssignment, makeDataset, makePerson } from '../domain/testkit.ts';
import type { Absence, Assignment, CompDayEntry, Holiday } from '../domain/types.ts';
import { cellValueAt, isBlocked, projectCells } from './cellValue.ts';

const RANGE = { from: '2026-09-07', to: '2026-09-13' } as const;

const person = makePerson({ id: 'p-1' });

const holiday: Holiday = {
  id: 'hol-test',
  date: '2026-09-08',
  name: 'Test holiday',
  locationIds: ['loc-ny'],
  isFullDay: true,
};

function project(options: {
  assignments?: Assignment[];
  absences?: Absence[];
  compDays?: CompDayEntry[];
  holidays?: Holiday[];
}) {
  const data = makeDataset({
    people: [person],
    assignments: options.assignments ?? [],
    absences: options.absences ?? [],
    compDays: options.compDays ?? [],
    holidays: options.holidays ?? [],
  });
  return projectCells({
    range: RANGE,
    absences: data.absences,
    compDays: data.compDays,
    index: buildIndex(data),
  });
}

const vacation: Absence = {
  id: 'abs-1',
  personId: 'p-1',
  eventTypeId: 'et-vacation',
        portion: 'FULL',
  from: '2026-09-09',
  to: '2026-09-11',
  source: 'MANUAL',
  version: 1,
};

function compDay(status: CompDayEntry['status'], date: string): CompDayEntry {
  return {
    id: 'cd-1',
    personId: 'p-1',
    earnedForAssignmentId: 'as-x',
    earnedForDate: '2026-09-05',
    trigger: 'SATURDAY',
    proposedDate: date,
    ...(status === 'SCHEDULED' || status === 'TAKEN' ? { actualDate: date } : {}),
    status,
    version: 1,
  };
}

describe('basic states', () => {
  it('empty cell — no recorded decision', () => {
    const p = project({});
    expect(cellValueAt(p, 'p-1', '2026-09-07')).toEqual({ kind: 'EMPTY' });
  });

  it('working role', () => {
    const p = project({ assignments: [makeAssignment('p-1', leadShift.id, '2026-09-07')] });
    const value = cellValueAt(p, 'p-1', '2026-09-07');
    expect(value.kind).toBe('SHIFT');
    if (value.kind === 'SHIFT') expect(value.shiftId).toBe(leadShift.id);
  });

  it('a day with no shift is empty, not a status', () => {
    // The roster markers are gone (ADR-0052). "Considered and left blank" and "nobody has
    // looked at this yet" are one cell now; an engineer who wants to be left off a day
    // records the UNAVAILABLE absence instead, which lands on the ABSENT branch.
    const p = project({ assignments: [] });
    expect(cellValueAt(p, 'p-1', '2026-09-07')).toEqual({ kind: 'EMPTY' });
  });

  it('a vacation occupies the whole range', () => {
    const p = project({ absences: [vacation] });
    expect(cellValueAt(p, 'p-1', '2026-09-08')).toEqual({ kind: 'EMPTY' });
    for (const date of ['2026-09-09', '2026-09-10', '2026-09-11']) {
      expect(cellValueAt(p, 'p-1', date)).toMatchObject({ kind: 'STATUS', status: 'ABSENT' });
    }
    expect(cellValueAt(p, 'p-1', '2026-09-12')).toEqual({ kind: 'EMPTY' });
  });

  it("holiday by the person's location", () => {
    const p = project({ holidays: [holiday] });
    expect(cellValueAt(p, 'p-1', '2026-09-08')).toMatchObject({ kind: 'STATUS', status: 'PH' });
  });

  it('confirmed comp day', () => {
    const p = project({ compDays: [compDay('SCHEDULED', '2026-09-10')] });
    expect(cellValueAt(p, 'p-1', '2026-09-10')).toMatchObject({
      kind: 'STATUS',
      status: 'COMP_OFF',
    });
  });

  it('a proposed comp day does not occupy the day', () => {
    const p = project({ compDays: [compDay('PROPOSED', '2026-09-10')] });
    const value = cellValueAt(p, 'p-1', '2026-09-10');
    expect(value.kind).toBe('EMPTY');
    if (value.kind === 'EMPTY') expect(value.proposedCompDay).toBe('cd-1');
  });
});

describe('precedence — a working role wins and produces a conflict', () => {
  it('an assignment over a vacation', () => {
    const p = project({
      assignments: [makeAssignment('p-1', leadShift.id, '2026-09-10')],
      absences: [vacation],
    });
    const value = cellValueAt(p, 'p-1', '2026-09-10');
    expect(value.kind).toBe('SHIFT');
    if (value.kind === 'SHIFT') expect(value.conflict).toBe('ABSENCE');
  });

  it('an assignment over a confirmed comp day', () => {
    const p = project({
      assignments: [makeAssignment('p-1', leadShift.id, '2026-09-10')],
      compDays: [compDay('SCHEDULED', '2026-09-10')],
    });
    const value = cellValueAt(p, 'p-1', '2026-09-10');
    expect(value.kind).toBe('SHIFT');
    if (value.kind === 'SHIFT') expect(value.conflict).toBe('COMP_DAY');
  });

  it('working on a holiday is normal, but flagged', () => {
    const p = project({
      assignments: [makeAssignment('p-1', leadShift.id, '2026-09-08')],
      holidays: [holiday],
    });
    const value = cellValueAt(p, 'p-1', '2026-09-08');
    expect(value.kind).toBe('SHIFT');
    if (value.kind === 'SHIFT') expect(value.conflict).toBe('HOLIDAY');
  });

  it('vacation overrides a holiday', () => {
    const overlapping: Absence = { ...vacation, from: '2026-09-08', to: '2026-09-08' };
    const p = project({ absences: [overlapping], holidays: [holiday] });
    expect(cellValueAt(p, 'p-1', '2026-09-08')).toMatchObject({
      kind: 'STATUS',
      status: 'ABSENT',
    });
  });

  it('a holiday shows on an otherwise empty cell', () => {
    const p = project({ holidays: [holiday] });
    expect(cellValueAt(p, 'p-1', '2026-09-08')).toMatchObject({ kind: 'STATUS', status: 'PH' });
  });
});

describe('non-working days', () => {
  it('weekends and location holidays are flagged', () => {
    const p = project({ holidays: [holiday] });
    expect(p.nonWorkingByCell.has('p-1|2026-09-12')).toBe(true); // Saturday
    expect(p.nonWorkingByCell.has('p-1|2026-09-13')).toBe(true); // Sunday
    expect(p.nonWorkingByCell.has('p-1|2026-09-08')).toBe(true); // holiday
    expect(p.nonWorkingByCell.has('p-1|2026-09-09')).toBe(false);
  });
});

describe('blocking an assignment', () => {
  it('a blocking absence and a confirmed comp day block', () => {
    expect(isBlocked({ kind: 'STATUS', status: 'ABSENT', event: absenceEvent(true) })).toBe(true);
    expect(isBlocked({ kind: 'STATUS', status: 'COMP_OFF' })).toBe(true);
  });

  it('an absence whose type does not block leaves the day open', () => {
    // A floating holiday somebody worked through is recorded, and does not close the
    // day out (ADR-0049).
    expect(isBlocked({ kind: 'STATUS', status: 'ABSENT', event: absenceEvent(false) })).toBe(false);
  });

  it('a holiday and an empty cell do not block', () => {
    // NOTE: a shift can still be placed on these — a holiday can be worked.
    expect(isBlocked({ kind: 'STATUS', status: 'PH' })).toBe(false);
    expect(isBlocked({ kind: 'EMPTY' })).toBe(false);
  });
});

/** A minimal `CellEventInfo` for the blocking tests. */
function absenceEvent(blocksAssignment: boolean) {
  return {
    eventTypeId: 'et-x',
    shortLabel: 'Leave',
    color: '#7c9cf5',
    blocksAssignment,
    portion: 'FULL' as const,
  };
}
