import { describe, expect, it } from 'vitest';
import { buildIndex } from '../domain/lookup.ts';
import {
  leadRole,
  makeAssignment,
  makeDataset,
  makePerson,
  puneLocation,
  testCompOffPolicy,
  testRegion,
} from '../domain/testkit.ts';
import type { Absence, CompDayEntry, Holiday } from '../domain/types.ts';
import { compDayBalance, compDayAge, isAged, proposeCompDays, triggerFor } from './compDays.ts';

const AUGUST = { from: '2026-08-01', to: '2026-08-31' } as const;

const holidays: Holiday[] = [
  { id: 'hol-us-test', date: '2026-08-20', name: 'US test holiday', locationIds: ['loc-ny'], isFullDay: true },
  { id: 'hol-in-test', date: '2026-08-19', name: 'IN test holiday', locationIds: ['loc-pune'], isFullDay: true },
];

const person = makePerson({ id: 'p-ny' });
const punePerson = makePerson({ id: 'p-pune', locationId: puneLocation.id });

function datasetWith(assignments = [], absences: Absence[] = [], compDays: CompDayEntry[] = []) {
  return makeDataset({ people: [person, punePerson], holidays, assignments, absences, compDays });
}

function proposeFor(
  placements: ReadonlyArray<[string, string]>,
  existing: CompDayEntry[] = [],
  absences: Absence[] = [],
) {
  const assignments = placements.map(([personId, date]) =>
    makeAssignment(personId, leadRole.id, date),
  );
  const data = makeDataset({
    people: [person, punePerson],
    holidays,
    assignments,
    absences,
    compDays: existing,
  });
  return proposeCompDays({
    range: AUGUST,
    assignments: data.assignments,
    absences: data.absences,
    existing,
    index: buildIndex(data),
  });
}

describe('срабатывание политики', () => {
  const index = buildIndex(datasetWith());

  it('рабочий день начисления не даёт', () => {
    expect(triggerFor('2026-08-17', person.locationId, index)).toBeUndefined();
  });

  it('различает субботу и воскресенье', () => {
    expect(triggerFor('2026-08-15', person.locationId, index)).toBe('SATURDAY');
    expect(triggerFor('2026-08-16', person.locationId, index)).toBe('SUNDAY');
  });

  it('праздник важнее дня недели', () => {
    // 20 августа — четверг и праздник в календаре Нью-Йорка.
    expect(triggerFor('2026-08-20', person.locationId, index)).toBe('HOLIDAY');
  });

  it('берёт календарь локации человека', () => {
    expect(triggerFor('2026-08-19', punePerson.locationId, index)).toBe('HOLIDAY');
    expect(triggerFor('2026-08-19', person.locationId, index)).toBeUndefined();
    expect(triggerFor('2026-08-20', punePerson.locationId, index)).toBeUndefined();
  });
});

describe('подбор даты в окне', () => {
  it('за рабочий день не начисляет', () => {
    expect(proposeFor([['p-ny', '2026-08-17']]).added).toHaveLength(0);
  });

  it('за субботу даёт четверг той же недели', () => {
    // Поиск идёт наружу от даты начисления, сначала «после»:
    //   +1 = вс 16-го — нерабочий
    //   −1 = пт 14-го — исключён политикой
    //   +2 = пн 17-го — исключён политикой
    //   −2 = чт 13-го — подходит
    // Это ровно исходное правило «суббота → −2 дня», полученное из окна,
    // а не зашитое смещением.
    const [entry] = proposeFor([['p-ny', '2026-08-15']]).added;
    expect(entry?.trigger).toBe('SATURDAY');
    expect(entry?.proposedDate).toBe('2026-08-13');
    expect(entry?.status).toBe('PROPOSED');
  });

  it('за воскресенье даёт вторник следующей недели', () => {
    // +1 = пн (исключён), −1 = сб (нерабочий), +2 = вт 18-го — подходит.
    // Исходное правило «воскресенье → +2 дня», тоже выведенное из окна.
    const [entry] = proposeFor([['p-ny', '2026-08-16']]).added;
    expect(entry?.trigger).toBe('SUNDAY');
    expect(entry?.proposedDate).toBe('2026-08-18');
  });

  it('не ставит отгул на исключённые дни недели', () => {
    const [entry] = proposeFor([['p-ny', '2026-08-15']]).added;
    const weekday = new Date(`${entry?.proposedDate ?? ''}T00:00:00Z`).getUTCDay();
    expect(weekday).not.toBe(1); // не понедельник
    expect(weekday).not.toBe(5); // не пятница
  });

  it('обходит день, занятый другим назначением', () => {
    const result = proposeFor([
      ['p-ny', '2026-08-15'],
      ['p-ny', '2026-08-13'],
    ]);
    const earned = result.added.find((e) => e.earnedForDate === '2026-08-15');
    expect(earned?.proposedDate).not.toBe('2026-08-13');
  });

  it('обходит день, закрытый отпуском', () => {
    const vacation: Absence = {
      id: 'abs-1',
      personId: 'p-ny',
      type: 'VACATION',
      from: '2026-08-11',
      to: '2026-08-14',
      source: 'MANUAL',
    };
    const [entry] = proposeFor([['p-ny', '2026-08-15']], [], [vacation]).added;
    expect(entry?.proposedDate).toBeDefined();
    expect(['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']).not.toContain(
      entry?.proposedDate,
    );
  });

  it('два начисления не встают на один день', () => {
    // Суббота и воскресенье — два независимых события начисления.
    const result = proposeFor([
      ['p-ny', '2026-08-15'],
      ['p-ny', '2026-08-16'],
    ]);
    expect(result.added).toHaveLength(2);
    const dates = result.added.map((e) => e.proposedDate);
    expect(new Set(dates).size).toBe(2);
  });

  it('без свободного дня — PENDING_APPROVAL, а не молча', () => {
    const wall: Absence = {
      id: 'abs-wall',
      personId: 'p-ny',
      type: 'VACATION',
      from: '2026-07-25',
      to: '2026-09-05',
      source: 'MANUAL',
    };
    const [entry] = proposeFor([['p-ny', '2026-08-15']], [], [wall]).added;
    expect(entry?.status).toBe('PENDING_APPROVAL');
    expect(entry?.proposedDate).toBeUndefined();
  });
});

describe('сохранение решений планировщика', () => {
  it('не перетирает перенесённый отгул', () => {
    const assignment = makeAssignment('p-ny', leadRole.id, '2026-08-15');
    const data = makeDataset({ people: [person], holidays, assignments: [assignment] });
    const moved: CompDayEntry = {
      id: `cd-${assignment.id}`,
      personId: 'p-ny',
      earnedForAssignmentId: assignment.id,
      earnedForDate: '2026-08-15',
      trigger: 'SATURDAY',
      proposedDate: '2026-08-18',
      actualDate: '2026-08-27',
      status: 'SCHEDULED',
    };

    const result = proposeCompDays({
      range: AUGUST,
      assignments: data.assignments,
      absences: [],
      existing: [moved],
      index: buildIndex(data),
    });

    expect(result.added).toHaveLength(0);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.actualDate).toBe('2026-08-27');
  });

  it('помечает начисления, чьё назначение исчезло', () => {
    const orphan: CompDayEntry = {
      id: 'cd-gone',
      personId: 'p-ny',
      earnedForAssignmentId: 'as-removed',
      earnedForDate: '2026-08-15',
      trigger: 'SATURDAY',
      proposedDate: '2026-08-18',
      status: 'SCHEDULED',
    };
    expect(proposeFor([], [orphan]).orphaned.map((e) => e.id)).toEqual(['cd-gone']);
  });

  it('маркер ростера начисления не порождает', () => {
    const marker = makeAssignment('p-ny', { kind: 'MARKER', marker: 'OFF' }, '2026-08-15');
    const data = makeDataset({ people: [person], holidays, assignments: [marker] });
    const result = proposeCompDays({
      range: AUGUST,
      assignments: data.assignments,
      absences: [],
      existing: [],
      index: buildIndex(data),
    });
    expect(result.added).toHaveLength(0);
  });
});

describe('возраст и баланс', () => {
  const entries: CompDayEntry[] = [
    { id: 'a', personId: 'p-ny', earnedForAssignmentId: 'as-1', earnedForDate: '2026-06-06', trigger: 'SATURDAY', proposedDate: '2026-06-09', status: 'PROPOSED' },
    { id: 'b', personId: 'p-ny', earnedForAssignmentId: 'as-2', earnedForDate: '2026-08-08', trigger: 'SATURDAY', proposedDate: '2026-08-11', status: 'SCHEDULED' },
    { id: 'c', personId: 'p-ny', earnedForAssignmentId: 'as-3', earnedForDate: '2026-05-02', trigger: 'SATURDAY', actualDate: '2026-05-05', status: 'TAKEN' },
    { id: 'd', personId: 'p-other', earnedForAssignmentId: 'as-4', earnedForDate: '2026-07-11', trigger: 'SATURDAY', proposedDate: '2026-07-14', status: 'PROPOSED' },
  ];

  it('считает возраст от даты начисления', () => {
    expect(compDayAge(entries[0] as CompDayEntry, '2026-08-16')).toBe(71);
  });

  it('отгулянное не стареет', () => {
    expect(isAged(entries[2] as CompDayEntry, '2026-08-16', 14)).toBe(false);
  });

  it('висящее дольше порога помечается', () => {
    expect(isAged(entries[0] as CompDayEntry, '2026-08-16', 14)).toBe(true);
    expect(isAged(entries[1] as CompDayEntry, '2026-08-16', 14)).toBe(false);
  });

  it('баланс считает только своего человека', () => {
    const balance = compDayBalance('p-ny', entries, '2026-08-16', testCompOffPolicy.agingThresholdDays);
    expect(balance.earned).toBe(3);
    expect(balance.proposed).toBe(1);
    expect(balance.scheduled).toBe(1);
    expect(balance.taken).toBe(1);
    expect(balance.due).toBe(2);
    expect(balance.aged).toBe(1);
  });

  it('политика региона задаёт порог', () => {
    expect(testRegion.compOffPolicy.agingThresholdDays).toBe(14);
  });
});
