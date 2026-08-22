import { describe, expect, it } from 'vitest';
import { buildIndex } from '../domain/lookup.ts';
import type { CompDayEntry } from '../domain/types.ts';
import {
  leadRole,
  makeAssignment,
  makeDataset,
  makePerson,
  puneLocation,
} from '../domain/testkit.ts';
import { compDayBalance, proposeCompDays, triggerFor } from './compDays.ts';

const AUGUST = { from: '2026-08-01', to: '2026-08-31' } as const;

const holidays = [
  { calendarKey: 'US', date: '2026-08-20', name: 'Тестовый праздник US' },
  { calendarKey: 'IN', date: '2026-08-15', name: 'Independence Day' },
];

const person = makePerson({ id: 'p-ny' });
const punePerson = makePerson({ id: 'p-pune', locationId: puneLocation.id });

function proposeFor(dates: ReadonlyArray<[string, string]>, existing: CompDayEntry[] = []) {
  const assignments = dates.map(([personId, date]) => makeAssignment(personId, leadRole.id, date));
  const data = makeDataset({ people: [person, punePerson], assignments, holidays });
  return proposeCompDays({
    range: AUGUST,
    assignments: data.assignments,
    existing,
    index: buildIndex(data),
  });
}

describe('срабатывание политики', () => {
  const index = buildIndex(makeDataset({ people: [person, punePerson], holidays }));

  it('рабочий день начисления не даёт', () => {
    expect(triggerFor('2026-08-17', person.locationId, index)).toBeUndefined();
  });

  it('различает субботу и воскресенье', () => {
    expect(triggerFor('2026-08-15', person.locationId, index)).toBe('SATURDAY');
    expect(triggerFor('2026-08-16', person.locationId, index)).toBe('SUNDAY');
  });

  it('праздник важнее дня недели', () => {
    // 20 августа — четверг и праздник в календаре US.
    expect(triggerFor('2026-08-20', person.locationId, index)).toBe('HOLIDAY');
  });

  it('берёт календарь локации человека, а не таймзону роли', () => {
    // 15 августа — праздник в Индии и обычная суббота в США.
    expect(triggerFor('2026-08-15', punePerson.locationId, index)).toBe('HOLIDAY');
    expect(triggerFor('2026-08-15', person.locationId, index)).toBe('SATURDAY');
    // 20 августа — праздник только в США.
    expect(triggerFor('2026-08-20', punePerson.locationId, index)).toBeUndefined();
  });
});

describe('предложение отгулов', () => {
  it('за рабочий день не начисляет', () => {
    expect(proposeFor([['p-ny', '2026-08-17']]).added).toHaveLength(0);
  });

  it('за субботу предлагает четверг той же недели', () => {
    const [entry] = proposeFor([['p-ny', '2026-08-15']]).added;
    expect(entry?.trigger).toBe('SATURDAY');
    expect(entry?.proposedDate).toBe('2026-08-13');
    expect(entry?.status).toBe('PROPOSED');
  });

  it('за воскресенье предлагает вторник следующей недели', () => {
    const [entry] = proposeFor([['p-ny', '2026-08-16']]).added;
    expect(entry?.proposedDate).toBe('2026-08-18');
  });

  it('за праздник берёт смещение праздничного правила', () => {
    const [entry] = proposeFor([['p-ny', '2026-08-20']]).added;
    expect(entry?.trigger).toBe('HOLIDAY');
    expect(entry?.proposedDate).toBe('2026-08-23');
  });

  it('ставит срок сгорания из политики', () => {
    const [entry] = proposeFor([['p-ny', '2026-08-15']]).added;
    expect(entry?.expiresOn).toBe('2026-11-07'); // 12 недель
  });

  it('не перетирает решение планировщика', () => {
    const assignment = makeAssignment('p-ny', leadRole.id, '2026-08-15');
    const data = makeDataset({ people: [person], assignments: [assignment], holidays });
    const moved: CompDayEntry = {
      id: `cd-${assignment.id}`,
      personId: 'p-ny',
      earnedForAssignmentId: assignment.id,
      earnedForDate: '2026-08-15',
      trigger: 'SATURDAY',
      proposedDate: '2026-08-13',
      actualDate: '2026-08-27',
      status: 'SCHEDULED',
      expiresOn: '2026-11-07',
    };

    const result = proposeCompDays({
      range: AUGUST,
      assignments: data.assignments,
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
      earnedForAssignmentId: 'as-удалено',
      earnedForDate: '2026-08-15',
      trigger: 'SATURDAY',
      proposedDate: '2026-08-13',
      status: 'SCHEDULED',
      expiresOn: '2026-11-07',
    };
    const result = proposeFor([], [orphan]);
    expect(result.orphaned.map((e) => e.id)).toEqual(['cd-gone']);
  });
});

describe('баланс', () => {
  const entries: CompDayEntry[] = [
    { id: 'a', personId: 'p-ny', earnedForAssignmentId: 'as-1', earnedForDate: '2026-06-06', trigger: 'SATURDAY', proposedDate: '2026-06-04', status: 'PROPOSED', expiresOn: '2026-08-29' },
    { id: 'b', personId: 'p-ny', earnedForAssignmentId: 'as-2', earnedForDate: '2026-07-04', trigger: 'SATURDAY', proposedDate: '2026-07-02', status: 'SCHEDULED', expiresOn: '2026-09-26' },
    { id: 'c', personId: 'p-ny', earnedForAssignmentId: 'as-3', earnedForDate: '2026-05-02', trigger: 'SATURDAY', proposedDate: '2026-04-30', status: 'TAKEN', expiresOn: '2026-07-25' },
    { id: 'd', personId: 'p-other', earnedForAssignmentId: 'as-4', earnedForDate: '2026-07-11', trigger: 'SATURDAY', proposedDate: '2026-07-09', status: 'PROPOSED', expiresOn: '2026-10-03' },
  ];

  it('считает только своего человека', () => {
    const balance = compDayBalance('p-ny', entries, '2026-08-16');
    expect(balance.proposed).toBe(1);
    expect(balance.scheduled).toBe(1);
    expect(balance.taken).toBe(1);
    expect(balance.outstanding).toBe(2);
  });

  it('видит сгорающие в ближайшие четыре недели', () => {
    expect(compDayBalance('p-ny', entries, '2026-08-16').expiringSoon).toBe(1);
    expect(compDayBalance('p-ny', entries, '2026-06-01').expiringSoon).toBe(0);
  });
});
