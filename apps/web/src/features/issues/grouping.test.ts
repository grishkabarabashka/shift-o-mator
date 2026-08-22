import { describe, expect, it } from 'vitest';
import type { DatasetIndex } from '../../domain/lookup.ts';
import type { Issue, IssueCode } from '../../domain/types.ts';
import { dateSpanLabel, groupIssues } from './grouping.ts';

/** Ровно те два справочника, из которых группировка берёт имена. */
const index = {
  shifts: new Map([['AMER:Cover', { code: 'Cover' }]]),
  people: new Map([['p-anna', { displayName: 'Anna Petrova' }]]),
} as unknown as DatasetIndex;

function issue(over: Partial<Issue> & { key: string }): Issue {
  return {
    level: 'WARNING',
    category: 'COVERAGE',
    code: 'COVERAGE_GAP' as IssueCode,
    message: 'Below minimum',
    unitId: 'unit-amer',
    ...over,
  } as Issue;
}

describe('свёртка нарушений', () => {
  it('одна и та же находка на разные даты — одна группа', () => {
    const groups = groupIssues(
      [
        issue({ key: 'a', date: '2026-09-04', shiftId: 'AMER:Cover' }),
        issue({ key: 'b', date: '2026-09-11', shiftId: 'AMER:Cover' }),
        issue({ key: 'c', date: '2026-09-18', shiftId: 'AMER:Cover' }),
      ],
      index,
      new Set(),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.subject).toBe('Cover');
    expect(groups[0]?.what).toBe('uncovered');
    expect(groups[0]?.dates).toEqual(['2026-09-04', '2026-09-11', '2026-09-18']);
  });

  it('разные коды на одном предмете не сливаются', () => {
    const groups = groupIssues(
      [
        issue({ key: 'a', date: '2026-09-04', shiftId: 'AMER:Cover' }),
        issue({ key: 'b', date: '2026-09-04', shiftId: 'AMER:Cover', code: 'COVERAGE_THIN' }),
      ],
      index,
      new Set(),
    );

    expect(groups).toHaveLength(2);
  });

  it('человек называется именем, смена — кодом', () => {
    const groups = groupIssues(
      [issue({ key: 'a', date: '2026-09-04', personId: 'p-anna', code: 'WEEKEND_LOAD_EXCEEDED' })],
      index,
      new Set(),
    );

    expect(groups[0]?.subject).toBe('Anna Petrova');
  });

  it('самая частая находка идёт первой', () => {
    const groups = groupIssues(
      [
        issue({ key: 'a', date: '2026-09-04', personId: 'p-anna', code: 'WEEKEND_LOAD_EXCEEDED' }),
        issue({ key: 'b', date: '2026-09-04', shiftId: 'AMER:Cover' }),
        issue({ key: 'c', date: '2026-09-05', shiftId: 'AMER:Cover' }),
      ],
      index,
      new Set(),
    );

    expect(groups[0]?.subject).toBe('Cover');
    expect(groups[0]?.issues).toHaveLength(2);
  });

  it('подтверждённые предупреждения не считаются требующими внимания', () => {
    const groups = groupIssues(
      [
        issue({ key: 'a', date: '2026-09-04', shiftId: 'AMER:Cover' }),
        issue({ key: 'b', date: '2026-09-05', shiftId: 'AMER:Cover' }),
      ],
      index,
      new Set(['a']),
    );

    expect(groups[0]?.unacknowledged).toBe(1);
  });

  it('подпись диапазона дат', () => {
    expect(dateSpanLabel(['2026-09-04'])).toBe('09/04');
    expect(dateSpanLabel(['2026-09-04', '2026-09-25'])).toBe('09/04 – 09/25');
    expect(dateSpanLabel([])).toBe('');
  });
});
