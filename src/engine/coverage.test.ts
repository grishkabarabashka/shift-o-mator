import { describe, expect, it } from 'vitest';
import { buildIndex } from '../domain/lookup.ts';
import {
  leadRole,
  makeAssignment,
  makeDataset,
  makeDayConfig,
  makePerson,
  nightRole,
  testRegion,
} from '../domain/testkit.ts';
import type { DayConfiguration } from '../domain/types.ts';
import { computeCoverage, coverageLevel, indexCoverage, summarizeCoverage } from './coverage.ts';

const weekday: DayConfiguration = makeDayConfig({
  id: 'dc-weekday',
  key: 'weekday',
  weekdays: [1, 2, 3, 4, 5],
  roleRequirements: [{ roleId: leadRole.id, min: 1, max: 3, isDefault: true }],
});

const weekend: DayConfiguration = makeDayConfig({
  id: 'dc-weekend',
  key: 'weekend',
  weekdays: [6, 7],
  roleRequirements: [{ roleId: leadRole.id, min: 1, max: 1, isDefault: true }],
});

const holiday: DayConfiguration = makeDayConfig({
  id: 'dc-holiday',
  key: 'holiday',
  weekdays: [],
  roleRequirements: [{ roleId: leadRole.id, min: 2, isDefault: true }],
});

describe('уровень покрытия', () => {
  it('различает четыре состояния', () => {
    expect(coverageLevel(0, 1, 3)).toBe('GAP');
    expect(coverageLevel(1, 1, 3)).toBe('THIN');
    expect(coverageLevel(2, 1, 3)).toBe('OK');
    expect(coverageLevel(4, 1, 3)).toBe('OVER');
  });

  it('THIN — это ровно минимум, а не оттенок зелёного', () => {
    expect(coverageLevel(2, 2)).toBe('THIN');
    expect(coverageLevel(3, 2)).toBe('OK');
  });

  it('нулевой минимум THIN не даёт', () => {
    // Роль с min 0 всегда «закрыта»; называть это впритык бессмысленно.
    expect(coverageLevel(0, 0)).toBe('OK');
  });
});

describe('расчёт покрытия за период', () => {
  const people = [makePerson({ id: 'p-1' }), makePerson({ id: 'p-2' }), makePerson({ id: 'p-3' })];

  function coverageFor(placements: ReadonlyArray<[string, string]>) {
    const assignments = placements.map(([personId, date]) =>
      makeAssignment(personId, leadRole.id, date),
    );
    const data = makeDataset({
      people,
      assignments,
      dayConfigurations: [weekday, weekend, holiday],
      holidays: [{ date: '2026-09-07', name: 'Labor Day', locationIds: ['loc-ny'], isFullDay: true }],
    });
    return computeCoverage({
      regionId: testRegion.id,
      range: { from: '2026-09-07', to: '2026-09-13' },
      assignments: data.assignments,
      index: buildIndex(data),
    });
  }

  it('даёт по клетке на каждый день с действующим требованием', () => {
    expect(coverageFor([])).toHaveLength(7);
  });

  it('пустой день против минимума — дыра', () => {
    expect(coverageFor([]).every((cell) => cell.level === 'GAP')).toBe(true);
  });

  it('считает фактически назначенных', () => {
    const cells = coverageFor([
      ['p-1', '2026-09-08'],
      ['p-2', '2026-09-08'],
    ]);
    const cell = cells.find((c) => c.date === '2026-09-08');
    expect(cell?.actual).toBe(2);
    expect(cell?.level).toBe('OK');
  });

  it('один при минимуме один — впритык', () => {
    const cell = coverageFor([['p-1', '2026-09-08']]).find((c) => c.date === '2026-09-08');
    expect(cell?.level).toBe('THIN');
  });

  it('применяет к празднику праздничную конфигурацию', () => {
    const holidayCell = coverageFor([['p-1', '2026-09-07']]).find((c) => c.date === '2026-09-07');
    expect(holidayCell?.min).toBe(2);
    expect(holidayCell?.level).toBe('GAP');
    expect(holidayCell?.appliedKey).toBe('holiday');
  });

  it('выходные считаются по своей конфигурации', () => {
    const cell = coverageFor([['p-1', '2026-09-12']]).find((c) => c.date === '2026-09-12');
    expect(cell?.appliedKey).toBe('weekend');
    expect(cell?.max).toBe(1);
  });

  it('игнорирует назначения вне периода', () => {
    expect(coverageFor([['p-1', '2026-10-01']]).every((cell) => cell.actual === 0)).toBe(true);
  });

  it('маркеры ростера в покрытие не идут', () => {
    const data = makeDataset({
      people,
      assignments: [makeAssignment('p-1', { kind: 'MARKER', marker: 'OFF' }, '2026-09-08')],
      dayConfigurations: [weekday, weekend, holiday],
    });
    const cells = computeCoverage({
      regionId: testRegion.id,
      range: { from: '2026-09-08', to: '2026-09-08' },
      assignments: data.assignments,
      index: buildIndex(data),
    });
    expect(cells[0]?.actual).toBe(0);
  });

  it('роль без countsAsCoverage не учитывается', () => {
    const shadow = { ...nightRole, id: 'r-shadow', code: 'Shadow', countsAsCoverage: false };
    const config = makeDayConfig({
      id: 'dc-shadow',
      key: 'weekday',
      weekdays: [1, 2, 3, 4, 5],
      roleRequirements: [
        { roleId: leadRole.id, min: 1, isDefault: true },
        { roleId: shadow.id, min: 1, isDefault: false },
      ],
    });
    const data = makeDataset({
      people,
      roles: [leadRole, shadow],
      dayConfigurations: [config],
      assignments: [makeAssignment('p-1', shadow.id, '2026-09-08')],
    });
    const cells = computeCoverage({
      regionId: testRegion.id,
      range: { from: '2026-09-08', to: '2026-09-08' },
      assignments: data.assignments,
      index: buildIndex(data),
    });
    // Клетка для Shadow не создаётся, и назначение никуда не засчитывается.
    expect(cells).toHaveLength(1);
    expect(cells[0]?.roleId).toBe(leadRole.id);
    expect(cells[0]?.actual).toBe(0);
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
    expect(summary.thin).toBe(1); // 10-е: один при минимуме один
    expect(summary.gaps).toBe(5);
  });

  it('индексирует клетки по дате и роли', () => {
    const map = indexCoverage(coverageFor([['p-1', '2026-09-09']]));
    expect(map.get(`2026-09-09|${leadRole.id}`)?.actual).toBe(1);
  });
});
