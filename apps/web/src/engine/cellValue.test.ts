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
  type: 'VACATION',
  from: '2026-09-09',
  to: '2026-09-11',
  source: 'MANUAL',
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

  it('Off marker — neither absence nor empty', () => {
    const p = project({
      assignments: [makeAssignment('p-1', { kind: 'MARKER', marker: 'OFF' }, '2026-09-07')],
    });
    expect(cellValueAt(p, 'p-1', '2026-09-07')).toMatchObject({ kind: 'STATUS', status: 'OFF' });
  });

  it('`0` differs from both Off and an empty cell', () => {
    const p = project({
      assignments: [
        makeAssignment('p-1', { kind: 'MARKER', marker: 'NOT_SCHEDULED' }, '2026-09-07'),
      ],
    });
    expect(cellValueAt(p, 'p-1', '2026-09-07')).toMatchObject({
      kind: 'STATUS',
      status: 'NOT_SCHEDULED',
    });
    expect(cellValueAt(p, 'p-1', '2026-09-10')).toEqual({ kind: 'EMPTY' });
  });

  it('a vacation occupies the whole range', () => {
    const p = project({ absences: [vacation] });
    expect(cellValueAt(p, 'p-1', '2026-09-08')).toEqual({ kind: 'EMPTY' });
    for (const date of ['2026-09-09', '2026-09-10', '2026-09-11']) {
      expect(cellValueAt(p, 'p-1', date)).toMatchObject({ kind: 'STATUS', status: 'VACATION' });
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
      status: 'VACATION',
    });
  });

  it('a holiday is more informative than the Off marker', () => {
    const p = project({
      assignments: [makeAssignment('p-1', { kind: 'MARKER', marker: 'OFF' }, '2026-09-08')],
      holidays: [holiday],
    });
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
  it('vacation, sick leave, and a confirmed comp day block', () => {
    expect(isBlocked({ kind: 'STATUS', status: 'VACATION' })).toBe(true);
    expect(isBlocked({ kind: 'STATUS', status: 'SICK' })).toBe(true);
    expect(isBlocked({ kind: 'STATUS', status: 'COMP_OFF' })).toBe(true);
  });

  it('Off, `0`, and a holiday do not block', () => {
    // NOTE: a shift can still be placed on these — a day off gets rescheduled, a holiday can be worked.
    expect(isBlocked({ kind: 'STATUS', status: 'OFF' })).toBe(false);
    expect(isBlocked({ kind: 'STATUS', status: 'NOT_SCHEDULED' })).toBe(false);
    expect(isBlocked({ kind: 'STATUS', status: 'PH' })).toBe(false);
    expect(isBlocked({ kind: 'EMPTY' })).toBe(false);
  });
});
