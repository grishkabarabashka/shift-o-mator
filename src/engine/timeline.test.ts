import { describe, expect, it } from 'vitest';
import { buildIndex } from '../domain/lookup.ts';
import type { Assignment, CoverageCell, IsoDate } from '../domain/types.ts';
import {
  leadRole,
  makeAssignment,
  makeDataset,
  makeDayConfig,
  makePerson,
  nightRole,
  testRegion,
} from '../domain/testkit.ts';
import { buildDayDetail, buildDayDetailRange, buildTimelineRange, positionOf } from './timeline.ts';

/**
 * `coverage.ts` (the engine) moved to the server in Phase 5 and is deleted
 * from TS; timeline now takes coverage cells as an *input* it doesn't
 * compute (per the module's own doc comment). This test only needs
 * realistic cells for the two fixture roles across `DATES` — a minimal
 * stand-in for what `GET /api/schedule`'s `coverage` array would carry.
 */
function fakeCoverage(dates: readonly IsoDate[], assignments: readonly Assignment[]): CoverageCell[] {
  const roles = [leadRole, nightRole];
  const cells: CoverageCell[] = [];
  for (const date of dates) {
    for (const role of roles) {
      const actual = assignments.filter(
        (a) => a.date === date && a.content.kind === 'ROLE' && a.content.roleId === role.id,
      ).length;
      const min = 1;
      cells.push({
        date,
        regionId: testRegion.id,
        roleId: role.id,
        actual,
        min,
        level: actual < min ? 'GAP' : 'OK',
        appliedKey: 'weekday',
      });
    }
  }
  return cells;
}

/**
 * Lead 07:00–15:00 и Night 22:00–06:00+1 в America/New_York. Пересекающиеся
 * окна нужны, чтобы проверить раскладку по подстрокам, а переход через
 * полночь — чтобы ось расширялась за границы суток.
 */
const dayConfig = makeDayConfig({
  id: 'dc-all',
  key: 'weekday',
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  roleRequirements: [
    { roleId: leadRole.id, min: 1, isDefault: true },
    { roleId: nightRole.id, min: 1, isDefault: true },
  ],
});

const alice = makePerson({
  id: 'p-alice',
  displayName: 'Alice',
  eligibility: [
    { roleId: leadRole.id, targetShare: 0.5 },
    { roleId: nightRole.id, targetShare: 0.5 },
  ],
});
const bob = makePerson({
  id: 'p-bob',
  displayName: 'Bob',
  eligibility: [
    { roleId: leadRole.id, targetShare: 0.5 },
    { roleId: nightRole.id, targetShare: 0.5 },
  ],
});

const DATES = ['2026-09-07', '2026-09-08', '2026-09-09'];

function setup(assignments = [
  makeAssignment('p-alice', leadRole.id, '2026-09-07'),
  makeAssignment('p-bob', nightRole.id, '2026-09-07'),
]) {
  const dataset = makeDataset({
    people: [alice, bob],
    dayConfigurations: [dayConfig],
    assignments,
  });
  const index = buildIndex(dataset);
  const coverageCells = fakeCoverage(DATES, assignments);
  return { index, coverageCells, assignments };
}

describe('непрерывный таймлайн периода', () => {
  it('строит одну ось на весь период, выровненную по суткам', () => {
    const { index, coverageCells, assignments } = setup();
    const timeline = buildTimelineRange({
      dates: DATES,
      regionIds: [testRegion.id],
      assignments,
      coverageCells,
      index,
    });

    // Ось начинается ровно в полночь первого дня.
    expect(timeline.axis.start.startsWith('2026-09-07T00:00')).toBe(true);
    expect(timeline.days).toHaveLength(3);

    // Дни идут подряд и покрывают ось без разрывов: без этого вертикальные
    // линии дней разъезжаются с подписями.
    for (let i = 1; i < timeline.days.length; i += 1) {
      const previous = timeline.days[i - 1]!;
      const current = timeline.days[i]!;
      expect(current.left).toBeCloseTo(previous.left + previous.width, 5);
    }
  });

  it('ось расширяется под смену, переходящую через полночь', () => {
    const { index, coverageCells, assignments } = setup();
    const timeline = buildTimelineRange({
      dates: DATES,
      regionIds: [testRegion.id],
      assignments,
      coverageCells,
      index,
    });

    // Night заканчивается 06:00 следующего дня по NY — это выходит за
    // последние сутки диапазона в UTC, и ось обязана это вместить.
    const last = timeline.lanes[0]?.blocks.at(-1);
    expect(last).toBeDefined();
    expect(last!.interval.end <= timeline.axis.end).toBe(true);
  });

  it('пересекающиеся смены раскладываются по разным подстрокам', () => {
    const overlapping = [
      makeAssignment('p-alice', leadRole.id, '2026-09-07'),
      makeAssignment('p-bob', leadRole.id, '2026-09-07'),
    ];
    const { index, coverageCells } = setup(overlapping);
    const detail = buildDayDetail({
      date: '2026-09-07',
      regionIds: [testRegion.id],
      assignments: overlapping,
      coverageCells,
      index,
    });

    const bars = detail.lanes[0]?.bars.filter((bar) => bar.kind === 'assigned') ?? [];
    expect(bars).toHaveLength(2);
    // Одно и то же окно на двоих: класть их в одну строку значит показать одного.
    expect(new Set(bars.map((bar) => bar.row)).size).toBe(2);
  });

  it('свёрнутая сводка считает покрытие по каждому дню', () => {
    const { index, coverageCells, assignments } = setup();
    const timeline = buildTimelineRange({
      dates: DATES,
      regionIds: [testRegion.id],
      assignments,
      coverageCells,
      index,
    });

    const daily = timeline.lanes[0]?.daily ?? [];
    expect(daily.map((day) => day.date)).toEqual(DATES);
    // Первый день закрыт обеими ролями, следующие пустые.
    expect(daily[0]?.level).not.toBe('GAP');
    expect(daily[1]?.level).toBe('GAP');
  });

  it('позиция момента на оси монотонна', () => {
    const axis = { start: '2026-09-07T00:00:00.000Z', end: '2026-09-10T00:00:00.000Z' };
    expect(positionOf(axis, '2026-09-07T00:00:00.000Z')).toBe(0);
    expect(positionOf(axis, '2026-09-08T12:00:00.000Z')).toBeCloseTo(0.5, 5);
    expect(positionOf(axis, '2026-09-10T00:00:00.000Z')).toBe(1);
    // Выходящее за ось прижимается к краю, а не уезжает за него.
    expect(positionOf(axis, '2026-09-30T00:00:00.000Z')).toBe(1);
  });
});

describe('персональные полосы на весь период (Overview reuses the day view)', () => {
  it('каждое назначение — своя полоса, с датой, на общей оси периода', () => {
    const { index, coverageCells, assignments } = setup();
    const range = buildDayDetailRange({
      dates: DATES,
      regionIds: [testRegion.id],
      assignments,
      coverageCells,
      index,
    });

    const bars = range.lanes[0]?.bars.filter((bar) => bar.kind === 'assigned') ?? [];
    expect(bars.map((bar) => bar.personName).sort()).toEqual(['Alice', 'Bob']);
    expect(bars.every((bar) => bar.date === '2026-09-07')).toBe(true);
  });

  it('дыры на разных днях не путаются друг с другом ключом', () => {
    // Регрессия: ключ дырной полосы внутри одного дня — `gap-${roleId}`.
    // Без даты в ключе тот же непокрытый Lead на второй и третий день
    // получал тот же React key, что и на первый — React ругался на
    // дублирующиеся ключи, и полосы могли схлопнуться в одну.
    const { index, coverageCells, assignments } = setup();
    const range = buildDayDetailRange({
      dates: DATES,
      regionIds: [testRegion.id],
      assignments,
      coverageCells,
      index,
    });

    const gapKeys = range.lanes[0]?.bars.filter((bar) => bar.kind === 'gap').map((bar) => bar.key) ?? [];
    expect(gapKeys.length).toBeGreaterThan(1);
    expect(new Set(gapKeys).size).toBe(gapKeys.length);
  });

  it('свёрнутая сводка совпадает с агрегированным таймлайном день-в-день', () => {
    const { index, coverageCells, assignments } = setup();
    const aggregate = buildTimelineRange({
      dates: DATES,
      regionIds: [testRegion.id],
      assignments,
      coverageCells,
      index,
    });
    const perPerson = buildDayDetailRange({
      dates: DATES,
      regionIds: [testRegion.id],
      assignments,
      coverageCells,
      index,
    });

    // Обе ленты делят один и тот же `dailyCoverage` — свёрнутый вид должен
    // читаться одинаково, каким бы видом ни был развёрнутый.
    expect(perPerson.lanes[0]?.daily).toEqual(aggregate.lanes[0]?.daily);
  });
});
