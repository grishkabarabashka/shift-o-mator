import { describe, expect, it } from 'vitest';
import { buildIndex } from '../domain/lookup.ts';
import { leadRole, makeAssignment, makeDataset, makePerson } from '../domain/testkit.ts';
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

describe('базовые состояния', () => {
  it('пустая ячейка — нет записанного решения', () => {
    const p = project({});
    expect(cellValueAt(p, 'p-1', '2026-09-07')).toEqual({ kind: 'EMPTY' });
  });

  it('рабочая роль', () => {
    const p = project({ assignments: [makeAssignment('p-1', leadRole.id, '2026-09-07')] });
    const value = cellValueAt(p, 'p-1', '2026-09-07');
    expect(value.kind).toBe('ROLE');
    if (value.kind === 'ROLE') expect(value.roleId).toBe(leadRole.id);
  });

  it('маркер Off — не отсутствие и не пусто', () => {
    const p = project({
      assignments: [makeAssignment('p-1', { kind: 'MARKER', marker: 'OFF' }, '2026-09-07')],
    });
    expect(cellValueAt(p, 'p-1', '2026-09-07')).toMatchObject({ kind: 'STATUS', status: 'OFF' });
  });

  it('`0` отличается и от Off, и от пустой ячейки', () => {
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

  it('отпуск занимает весь диапазон', () => {
    const p = project({ absences: [vacation] });
    expect(cellValueAt(p, 'p-1', '2026-09-08')).toEqual({ kind: 'EMPTY' });
    for (const date of ['2026-09-09', '2026-09-10', '2026-09-11']) {
      expect(cellValueAt(p, 'p-1', date)).toMatchObject({ kind: 'STATUS', status: 'VACATION' });
    }
    expect(cellValueAt(p, 'p-1', '2026-09-12')).toEqual({ kind: 'EMPTY' });
  });

  it('праздник по локации человека', () => {
    const p = project({ holidays: [holiday] });
    expect(cellValueAt(p, 'p-1', '2026-09-08')).toMatchObject({ kind: 'STATUS', status: 'PH' });
  });

  it('подтверждённый отгул', () => {
    const p = project({ compDays: [compDay('SCHEDULED', '2026-09-10')] });
    expect(cellValueAt(p, 'p-1', '2026-09-10')).toMatchObject({
      kind: 'STATUS',
      status: 'COMP_OFF',
    });
  });

  it('предложенный отгул день не занимает', () => {
    const p = project({ compDays: [compDay('PROPOSED', '2026-09-10')] });
    const value = cellValueAt(p, 'p-1', '2026-09-10');
    expect(value.kind).toBe('EMPTY');
    if (value.kind === 'EMPTY') expect(value.proposedCompDay).toBe('cd-1');
  });
});

describe('приоритет — рабочая роль выигрывает и даёт конфликт', () => {
  it('назначение поверх отпуска', () => {
    const p = project({
      assignments: [makeAssignment('p-1', leadRole.id, '2026-09-10')],
      absences: [vacation],
    });
    const value = cellValueAt(p, 'p-1', '2026-09-10');
    expect(value.kind).toBe('ROLE');
    if (value.kind === 'ROLE') expect(value.conflict).toBe('ABSENCE');
  });

  it('назначение поверх подтверждённого отгула', () => {
    const p = project({
      assignments: [makeAssignment('p-1', leadRole.id, '2026-09-10')],
      compDays: [compDay('SCHEDULED', '2026-09-10')],
    });
    const value = cellValueAt(p, 'p-1', '2026-09-10');
    expect(value.kind).toBe('ROLE');
    if (value.kind === 'ROLE') expect(value.conflict).toBe('COMP_DAY');
  });

  it('работа в праздник — это норма, но помечается', () => {
    const p = project({
      assignments: [makeAssignment('p-1', leadRole.id, '2026-09-08')],
      holidays: [holiday],
    });
    const value = cellValueAt(p, 'p-1', '2026-09-08');
    expect(value.kind).toBe('ROLE');
    if (value.kind === 'ROLE') expect(value.conflict).toBe('HOLIDAY');
  });

  it('отпуск перебивает праздник', () => {
    const overlapping: Absence = { ...vacation, from: '2026-09-08', to: '2026-09-08' };
    const p = project({ absences: [overlapping], holidays: [holiday] });
    expect(cellValueAt(p, 'p-1', '2026-09-08')).toMatchObject({
      kind: 'STATUS',
      status: 'VACATION',
    });
  });

  it('праздник информативнее маркера Off', () => {
    const p = project({
      assignments: [makeAssignment('p-1', { kind: 'MARKER', marker: 'OFF' }, '2026-09-08')],
      holidays: [holiday],
    });
    expect(cellValueAt(p, 'p-1', '2026-09-08')).toMatchObject({ kind: 'STATUS', status: 'PH' });
  });
});

describe('нерабочие дни', () => {
  it('выходные и праздники локации помечены', () => {
    const p = project({ holidays: [holiday] });
    expect(p.nonWorkingByCell.has('p-1|2026-09-12')).toBe(true); // суббота
    expect(p.nonWorkingByCell.has('p-1|2026-09-13')).toBe(true); // воскресенье
    expect(p.nonWorkingByCell.has('p-1|2026-09-08')).toBe(true); // праздник
    expect(p.nonWorkingByCell.has('p-1|2026-09-09')).toBe(false);
  });
});

describe('блокировка назначения', () => {
  it('отпуск, больничный и подтверждённый отгул блокируют', () => {
    expect(isBlocked({ kind: 'STATUS', status: 'VACATION' })).toBe(true);
    expect(isBlocked({ kind: 'STATUS', status: 'SICK' })).toBe(true);
    expect(isBlocked({ kind: 'STATUS', status: 'COMP_OFF' })).toBe(true);
  });

  it('Off, `0` и праздник — не блокируют', () => {
    // На них можно поставить смену: выходной переставляется, в праздник работают.
    expect(isBlocked({ kind: 'STATUS', status: 'OFF' })).toBe(false);
    expect(isBlocked({ kind: 'STATUS', status: 'NOT_SCHEDULED' })).toBe(false);
    expect(isBlocked({ kind: 'STATUS', status: 'PH' })).toBe(false);
    expect(isBlocked({ kind: 'EMPTY' })).toBe(false);
  });
});
