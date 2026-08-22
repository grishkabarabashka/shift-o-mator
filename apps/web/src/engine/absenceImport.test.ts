import { describe, expect, it } from 'vitest';
import { buildIndex } from '../domain/lookup.ts';
import { makeAssignment, makeDataset, makePerson } from '../domain/testkit.ts';
import type { Absence } from '../domain/types.ts';
import {
  absenceFreshness,
  buildImportChanges,
  computeImportImpact,
  diffAbsenceImport,
  guessColumnMapping,
  mapRows,
  matchPeople,
  parseDelimited,
  parseFlexibleDate,
  type ColumnMapping,
} from './absenceImport.ts';

const alice = makePerson({ id: 'p-alice', displayName: 'Alice Johnson', employeeId: 'E100' });
const bob = makePerson({ id: 'p-bob', displayName: 'Bob Smith', employeeId: 'E200' });

function setup(overrides: Parameters<typeof makeDataset>[0] = {}) {
  const dataset = makeDataset({ people: [alice, bob], ...overrides });
  return buildIndex(dataset);
}

const MAPPING: ColumnMapping = { 0: 'personId', 1: 'personName', 2: 'type', 3: 'from', 4: 'to' };

describe('парсинг вставленной таблицы', () => {
  it('различает вставку из таблицы (tab) и csv-файл (запятая)', () => {
    expect(parseDelimited('E100\tAlice\tVacation\n E200 \tBob\tSick')).toEqual([
      ['E100', 'Alice', 'Vacation'],
      ['E200', 'Bob', 'Sick'],
    ]);
    expect(parseDelimited('E100,Alice,Vacation\nE200,Bob,Sick')).toEqual([
      ['E100', 'Alice', 'Vacation'],
      ['E200', 'Bob', 'Sick'],
    ]);
  });

  it('пропускает пустые строки', () => {
    expect(parseDelimited('a,b\n\n c,d \n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('гибкий разбор дат', () => {
  it('принимает ISO и день-первым, отклоняет мусор', () => {
    expect(parseFlexibleDate('2026-08-04')).toBe('2026-08-04');
    expect(parseFlexibleDate('4/8/2026')).toBe('2026-08-04');
    expect(parseFlexibleDate('04.08.2026')).toBe('2026-08-04');
    expect(parseFlexibleDate('31/02/2026')).toBeUndefined(); // 31 февраля не существует
    expect(parseFlexibleDate('not a date')).toBeUndefined();
  });
});

describe('применение маппинга колонок к строкам', () => {
  it('нормализует тип по словарю синонимов, одна дата = один день', () => {
    const table = [['E100', 'Alice', 'annual leave', '2026-08-10', '']];
    const [row] = mapRows(table, MAPPING, false);
    expect(row?.type).toBe('VACATION');
    expect(row?.from).toBe('2026-08-10');
    expect(row?.to).toBe('2026-08-10'); // нет столбца "to" — однодневное отсутствие
    expect(row?.error).toBeUndefined();
  });

  it('переставляет местами перепутанные from/to, не обрезая диапазон', () => {
    const table = [['E100', 'Alice', 'sick', '2026-08-10', '2026-08-05']];
    const [row] = mapRows(table, MAPPING, false);
    expect(row?.from).toBe('2026-08-05');
    expect(row?.to).toBe('2026-08-10');
  });

  it('без человека или без читаемой даты строка помечается ошибкой, а не отбрасывается', () => {
    const table = [
      ['', '', 'sick', '2026-08-10', ''],
      ['E100', 'Alice', 'sick', 'garbage', ''],
    ];
    const rows = mapRows(table, MAPPING, false);
    expect(rows[0]?.error).toBe('no person in this row');
    expect(rows[1]?.error).toContain('unreadable date');
  });

  it('пропускает строку заголовка, когда она есть', () => {
    const table = [
      ['Employee ID', 'Name', 'Type', 'From', 'To'],
      ['E100', 'Alice', 'sick', '2026-08-10', ''],
    ];
    const rows = mapRows(table, MAPPING, true);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.personIdRaw).toBe('E100');
  });
});

describe('угадывание маппинга по заголовку', () => {
  it('распознаёт обычные заголовки, неизвестные столбцы игнорирует', () => {
    const header = ['Employee ID', 'Full Name', 'Leave Type', 'From', 'To', 'Comment', 'Department'];
    expect(guessColumnMapping(header)).toEqual({
      0: 'personId',
      1: 'personName',
      2: 'type',
      3: 'from',
      4: 'to',
      5: 'note',
      6: 'ignore',
    });
  });
});

describe('сопоставление людей', () => {
  it('находит по employeeId точно', () => {
    const index = setup();
    const [row] = mapRows([['E100', '', 'sick', '2026-08-10', '']], MAPPING, false);
    const [match] = matchPeople([row!], index, new Map());
    expect(match?.personId).toBe('p-alice');
    expect(match?.suggestions).toHaveLength(0);
  });

  it('без employeeId предлагает совпадения по имени, не решает за планировщика', () => {
    const index = setup();
    const [row] = mapRows([['', 'Alice Johnsen', 'sick', '2026-08-10', '']], MAPPING, false);
    const [match] = matchPeople([row!], index, new Map());
    expect(match?.personId).toBeUndefined();
    expect(match?.suggestions[0]?.personId).toBe('p-alice');
  });

  it('точное совпадение по имени резолвится сразу', () => {
    const index = setup();
    const [row] = mapRows([['', 'Bob Smith', 'sick', '2026-08-10', '']], MAPPING, false);
    const [match] = matchPeople([row!], index, new Map());
    expect(match?.personId).toBe('p-bob');
  });

  it('запомненное решение планировщика применяется без повторного вопроса', () => {
    const index = setup();
    const [row] = mapRows([['', 'Al Johnson', 'sick', '2026-08-10', '']], MAPPING, false);
    const remembered = new Map([['al johnson', 'p-alice']]);
    const [match] = matchPeople([row!], index, remembered);
    expect(match?.personId).toBe('p-alice');
  });
});

describe('диф с уже существующими отсутствиями', () => {
  it('классифицирует add/update/unchanged и различает их корректно', () => {
    const index = setup();
    const existing: Absence[] = [
      {
        id: 'abs-1',
        personId: 'p-alice',
        type: 'VACATION',
        from: '2026-08-10',
        to: '2026-08-12',
        source: 'IMPORT',
      },
      {
        id: 'abs-2',
        personId: 'p-bob',
        type: 'SICK',
        from: '2026-08-01',
        to: '2026-08-01',
        source: 'IMPORT',
      },
    ];
    const table = [
      ['E100', '', 'vacation', '2026-08-10', '2026-08-12'], // unchanged
      ['E200', '', 'vacation', '2026-08-01', '2026-08-01'], // update: type differs
      ['', 'Alice Johnson', 'sick', '2026-08-20', '2026-08-21'], // add
    ];
    const rows = mapRows(table, MAPPING, false);
    const matches = matchPeople(rows, index, new Map());
    const diff = diffAbsenceImport({ rows, matches, existingAbsences: existing, index });

    const byPerson = new Map(diff.rows.map((r) => [`${r.personId}|${r.from}`, r.decision]));
    expect(byPerson.get('p-alice|2026-08-10')).toBe('unchanged');
    expect(byPerson.get('p-bob|2026-08-01')).toBe('update');
    expect(byPerson.get('p-alice|2026-08-20')).toBe('add');
  });

  it('строки без разрешённого человека попадают в unresolved, не в rows', () => {
    const index = setup();
    const table = [['', 'Someone Unknown', 'sick', '2026-08-10', '']];
    const rows = mapRows(table, MAPPING, false);
    const matches = matchPeople(rows, index, new Map());
    const diff = diffAbsenceImport({ rows, matches, existingAbsences: [], index });
    expect(diff.rows).toHaveLength(0);
    expect(diff.unresolved).toHaveLength(1);
  });

  it('пропавшую запись помечает "gone", только если период импорта её покрывает', () => {
    const index = setup();
    const existing: Absence[] = [
      {
        id: 'abs-old',
        personId: 'p-alice',
        type: 'VACATION',
        from: '2026-08-10',
        to: '2026-08-12',
        source: 'IMPORT',
      },
      {
        id: 'abs-outside',
        personId: 'p-alice',
        type: 'VACATION',
        from: '2026-11-01',
        to: '2026-11-02',
        source: 'IMPORT',
      },
    ];
    // Импорт покрывает весь август (включая диапазон abs-old) — запись за
    // ноябрь вне зоны видимости этого экспорта и не должна выглядеть отменённой.
    const table = [['E200', '', 'sick', '2026-08-01', '2026-08-31']];
    const rows = mapRows(table, MAPPING, false);
    const matches = matchPeople(rows, index, new Map());
    const diff = diffAbsenceImport({ rows, matches, existingAbsences: existing, index });

    expect(diff.gone.map((g) => g.absence.id)).toEqual(['abs-old']);
  });

  it('отсутствия, введённые вручную, никогда не считаются "gone"', () => {
    const index = setup();
    const existing: Absence[] = [
      {
        id: 'abs-manual',
        personId: 'p-alice',
        type: 'VACATION',
        from: '2026-08-10',
        to: '2026-08-12',
        source: 'MANUAL',
      },
    ];
    const table = [['E200', '', 'sick', '2026-08-01', '2026-08-01']];
    const rows = mapRows(table, MAPPING, false);
    const matches = matchPeople(rows, index, new Map());
    const diff = diffAbsenceImport({ rows, matches, existingAbsences: existing, index });
    expect(diff.gone).toHaveLength(0);
  });
});

describe('влияние на опубликованные назначения', () => {
  it('находит опубликованные роли, попадающие в новый или изменённый диапазон', () => {
    const index = setup();
    const published = [
      makeAssignment('p-alice', 'r-lead', '2026-08-11'),
      makeAssignment('p-bob', 'r-lead', '2026-08-11'),
    ];
    const rows = [
      {
        rowIndex: 0,
        personId: 'p-alice',
        type: 'VACATION' as const,
        from: '2026-08-10',
        to: '2026-08-12',
        note: undefined,
        decision: 'add' as const,
        existing: undefined,
      },
      {
        rowIndex: 1,
        personId: 'p-bob',
        type: 'VACATION' as const,
        from: '2026-08-10',
        to: '2026-08-12',
        note: undefined,
        decision: 'unchanged' as const,
        existing: undefined,
      },
    ];
    const impact = computeImportImpact({ rows, publishedAssignments: published, index });
    expect(impact.map((i) => i.assignment.personId)).toEqual(['p-alice']);
  });
});

describe('построение изменений черновика', () => {
  it('каждая строка несёт importBatchId и обновлённый lastSeenInImportAt', () => {
    const rows = [
      {
        rowIndex: 0,
        personId: 'p-alice',
        type: 'VACATION' as const,
        from: '2026-08-10',
        to: '2026-08-12',
        note: undefined,
        decision: 'add' as const,
        existing: undefined,
      },
    ];
    const changes = buildImportChanges({
      rows,
      gone: [],
      goneToRemove: new Set(),
      batchId: 'batch-1',
      now: '2026-08-15T00:00:00Z',
    });
    expect(changes).toHaveLength(1);
    const change = changes[0]!;
    expect(change.targetType).toBe('ABSENCE');
    if (change.targetType !== 'ABSENCE') throw new Error('expected an absence change');
    expect(change.after?.importBatchId).toBe('batch-1');
    expect(change.after?.lastSeenInImportAt).toBe('2026-08-15T00:00:00Z');
  });

  it('только подтверждённые "gone" записи удаляются', () => {
    const gone = [
      {
        absence: {
          id: 'abs-1',
          personId: 'p-alice',
          type: 'VACATION' as const,
          from: '2026-08-10',
          to: '2026-08-12',
          source: 'IMPORT' as const,
        },
        personName: 'Alice Johnson',
      },
      {
        absence: {
          id: 'abs-2',
          personId: 'p-bob',
          type: 'SICK' as const,
          from: '2026-08-01',
          to: '2026-08-01',
          source: 'IMPORT' as const,
        },
        personName: 'Bob Smith',
      },
    ];
    const changes = buildImportChanges({
      rows: [],
      gone,
      goneToRemove: new Set(['abs-1']),
      batchId: 'batch-1',
      now: '2026-08-15T00:00:00Z',
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.before && 'id' in changes[0].before ? changes[0].before.id : undefined).toBe(
      'abs-1',
    );
    expect(changes[0]?.after).toBeNull();
  });
});

describe('свежесть данных об отсутствиях', () => {
  it('берёт самый поздний lastSeenInImportAt', () => {
    const absences: Absence[] = [
      {
        id: 'a',
        personId: 'p-alice',
        type: 'VACATION',
        from: '2026-08-01',
        to: '2026-08-01',
        source: 'IMPORT',
        lastSeenInImportAt: '2026-08-10T00:00:00Z',
      },
      {
        id: 'b',
        personId: 'p-bob',
        type: 'SICK',
        from: '2026-08-02',
        to: '2026-08-02',
        source: 'IMPORT',
        lastSeenInImportAt: '2026-08-14T00:00:00Z',
      },
    ];
    expect(absenceFreshness(absences)).toBe('2026-08-14T00:00:00Z');
    expect(absenceFreshness([])).toBeUndefined();
  });
});
