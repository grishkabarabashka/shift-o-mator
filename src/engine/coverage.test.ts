import { describe, expect, it } from 'vitest';
import { buildIndex } from '../domain/lookup.ts';
import type { CoverageRule } from '../domain/types.ts';
import { leadRole, makeAssignment, makeDataset, makePerson, testUnit } from '../domain/testkit.ts';
import { computeCoverage, coverageLevel, resolveCoverageRule, summarizeCoverage } from './coverage.ts';

const weekdayRule: CoverageRule = {
  id: 'cr-weekday',
  unitId: testUnit.id,
  roleId: leadRole.id,
  appliesTo: 'WEEKDAY',
  min: 1,
  target: 2,
  max: 3,
};

const weekendRule: CoverageRule = {
  id: 'cr-weekend',
  unitId: testUnit.id,
  roleId: leadRole.id,
  appliesTo: 'WEEKEND',
  min: 1,
  target: 1,
};

const holidayRule: CoverageRule = {
  id: 'cr-holiday',
  unitId: testUnit.id,
  roleId: leadRole.id,
  appliesTo: 'HOLIDAY',
  min: 2,
};

const drTestRule: CoverageRule = {
  id: 'cr-dr-test',
  unitId: testUnit.id,
  roleId: leadRole.id,
  appliesTo: 'DATE',
  date: '2026-09-08',
  label: 'DR test',
  min: 3,
  target: 4,
};

describe('уровень покрытия', () => {
  it('различает четыре состояния клетки', () => {
    expect(coverageLevel(0, 1, 2, 3)).toBe('BELOW_MIN');
    expect(coverageLevel(1, 1, 2, 3)).toBe('BELOW_TARGET');
    expect(coverageLevel(2, 1, 2, 3)).toBe('OK');
    expect(coverageLevel(4, 1, 2, 3)).toBe('OVER_MAX');
  });

  it('без цели и максимума достаточно минимума', () => {
    expect(coverageLevel(5, 1)).toBe('OK');
  });
});

describe('выбор действующего правила', () => {
  const rules = [weekdayRule, weekendRule, holidayRule, drTestRule];

  it('правило с датой перекрывает всё остальное', () => {
    expect(resolveCoverageRule(rules, leadRole.id, '2026-09-08', 'WEEKDAY')?.id).toBe('cr-dr-test');
  });

  it('праздничное правило перекрывает будничное', () => {
    expect(resolveCoverageRule(rules, leadRole.id, '2026-09-07', 'HOLIDAY')?.id).toBe('cr-holiday');
  });

  it('выходное правило применяется только к выходным', () => {
    expect(resolveCoverageRule(rules, leadRole.id, '2026-09-12', 'WEEKEND')?.id).toBe('cr-weekend');
    expect(resolveCoverageRule(rules, leadRole.id, '2026-09-09', 'WEEKDAY')?.id).toBe('cr-weekday');
  });

  it('без подходящего правила требований нет', () => {
    expect(resolveCoverageRule([holidayRule], leadRole.id, '2026-09-09', 'WEEKDAY')).toBeUndefined();
  });
});

describe('расчёт покрытия за период', () => {
  const people = [makePerson({ id: 'p-1' }), makePerson({ id: 'p-2' }), makePerson({ id: 'p-3' })];

  function coverageFor(assignmentDates: ReadonlyArray<[string, string]>) {
    const assignments = assignmentDates.map(([personId, date]) =>
      makeAssignment(personId, leadRole.id, date),
    );
    const data = makeDataset({
      people,
      assignments,
      coverageRules: [weekdayRule, weekendRule, holidayRule, drTestRule],
      holidays: [{ calendarKey: 'US', date: '2026-09-07', name: 'Labor Day' }],
    });
    return computeCoverage({
      unitId: testUnit.id,
      range: { from: '2026-09-07', to: '2026-09-13' },
      assignments: data.assignments,
      coverageRules: data.coverageRules,
      index: buildIndex(data),
    });
  }

  it('даёт по клетке на каждый день с действующим правилом', () => {
    expect(coverageFor([])).toHaveLength(7);
  });

  it('пустой день против минимума — дыра', () => {
    const cells = coverageFor([]);
    expect(cells.every((cell) => cell.level === 'BELOW_MIN')).toBe(true);
  });

  it('считает фактически назначенных', () => {
    const cells = coverageFor([
      ['p-1', '2026-09-09'],
      ['p-2', '2026-09-09'],
    ]);
    const cell = cells.find((c) => c.date === '2026-09-09');
    expect(cell?.actual).toBe(2);
    expect(cell?.level).toBe('OK');
  });

  it('применяет к празднику праздничный минимум', () => {
    const cells = coverageFor([['p-1', '2026-09-07']]);
    const holiday = cells.find((c) => c.date === '2026-09-07');
    expect(holiday?.min).toBe(2);
    expect(holiday?.level).toBe('BELOW_MIN');
    expect(holiday?.appliedScope).toBe('HOLIDAY');
  });

  it('переносит метку события в клетку', () => {
    // ASSUMPTION в фикстурах, здесь — проверка механизма ADR-0008.
    const cells = coverageFor([]);
    const drTest = cells.find((c) => c.date === '2026-09-08');
    expect(drTest?.ruleLabel).toBe('DR test');
    expect(drTest?.min).toBe(3);
  });

  it('игнорирует назначения вне периода и чужих ролей', () => {
    const cells = coverageFor([['p-1', '2026-10-01']]);
    expect(cells.every((cell) => cell.actual === 0)).toBe(true);
  });

  it('сводка считает клетки по уровням', () => {
    const summary = summarizeCoverage(
      coverageFor([
        ['p-1', '2026-09-09'],
        ['p-2', '2026-09-09'],
        ['p-3', '2026-09-10'],
      ]),
    );
    expect(summary.total).toBe(7);
    expect(summary.belowTarget).toBe(1); // 10-е: один при цели два
    expect(summary.belowMin).toBe(5);
  });
});
