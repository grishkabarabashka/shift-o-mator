import { describe, expect, it } from 'vitest';
import { buildIndex } from '../domain/lookup.ts';
import type { Assignment, CoverageCell, IsoDate } from '../domain/types.ts';
import {
  leadShift,
  makeAssignment,
  makeDataset,
  makeDayConfig,
  makePerson,
  nightShift,
  testUnit,
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
  const shifts = [leadShift, nightShift];
  const cells: CoverageCell[] = [];
  for (const date of dates) {
    for (const shift of shifts) {
      const actual = assignments.filter(
        (a) => a.date === date && a.content.kind === 'SHIFT' && a.content.shiftId === shift.id,
      ).length;
      const min = 1;
      cells.push({
        date,
        unitId: testUnit.id,
        shiftId: shift.id,
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
 * NOTE: Lead 07:00-15:00 and Night 22:00-06:00+1 in America/New_York.
 * Overlapping windows are needed to test sub-row packing, and the
 * midnight crossing to test that the axis extends beyond a single day.
 */
const dayConfig = makeDayConfig({
  id: 'dc-all',
  key: 'weekday',
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  shiftRequirements: [
    { shiftId: leadShift.id, min: 1, isDefault: true },
    { shiftId: nightShift.id, min: 1, isDefault: true },
  ],
});

const alice = makePerson({
  id: 'p-alice',
  displayName: 'Alice',
  eligibility: [
    { shiftId: leadShift.id, targetShare: 0.5 },
    { shiftId: nightShift.id, targetShare: 0.5 },
  ],
});
const bob = makePerson({
  id: 'p-bob',
  displayName: 'Bob',
  eligibility: [
    { shiftId: leadShift.id, targetShare: 0.5 },
    { shiftId: nightShift.id, targetShare: 0.5 },
  ],
});

const DATES = ['2026-09-07', '2026-09-08', '2026-09-09'];

function setup(assignments = [
  makeAssignment('p-alice', leadShift.id, '2026-09-07'),
  makeAssignment('p-bob', nightShift.id, '2026-09-07'),
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

describe('continuous range timeline', () => {
  it('builds a single day-aligned axis for the whole range', () => {
    const { index, coverageCells, assignments } = setup();
    const timeline = buildTimelineRange({
      dates: DATES,
      unitIds: [testUnit.id],
      assignments,
      coverageCells,
      index,
    });

    // The axis starts exactly at midnight of the first day.
    expect(timeline.axis.start.startsWith('2026-09-07T00:00')).toBe(true);
    expect(timeline.days).toHaveLength(3);

    // Days run consecutively and cover the axis without gaps: without this
    // the vertical day lines would drift from their labels.
    for (let i = 1; i < timeline.days.length; i += 1) {
      const previous = timeline.days[i - 1]!;
      const current = timeline.days[i]!;
      expect(current.left).toBeCloseTo(previous.left + previous.width, 5);
    }
  });

  it('the axis extends to fit a shift crossing midnight', () => {
    const { index, coverageCells, assignments } = setup();
    const timeline = buildTimelineRange({
      dates: DATES,
      unitIds: [testUnit.id],
      assignments,
      coverageCells,
      index,
    });

    // Night ends at 06:00 the next day in NY time — that falls outside the
    // range's last UTC day, and the axis must accommodate it.
    const last = timeline.lanes[0]?.blocks.at(-1);
    expect(last).toBeDefined();
    expect(last!.interval.end <= timeline.axis.end).toBe(true);
  });

  it('overlapping shifts are laid out on different sub-rows', () => {
    const overlapping = [
      makeAssignment('p-alice', leadShift.id, '2026-09-07'),
      makeAssignment('p-bob', leadShift.id, '2026-09-07'),
    ];
    const { index, coverageCells } = setup(overlapping);
    const detail = buildDayDetail({
      date: '2026-09-07',
      unitIds: [testUnit.id],
      assignments: overlapping,
      coverageCells,
      index,
    });

    const bars = detail.lanes[0]?.bars.filter((bar) => bar.kind === 'assigned') ?? [];
    expect(bars).toHaveLength(2);
    // The same window for both: packing them into one row would show only one.
    expect(new Set(bars.map((bar) => bar.row)).size).toBe(2);
  });

  it('the collapsed summary tallies coverage per day', () => {
    const { index, coverageCells, assignments } = setup();
    const timeline = buildTimelineRange({
      dates: DATES,
      unitIds: [testUnit.id],
      assignments,
      coverageCells,
      index,
    });

    const daily = timeline.lanes[0]?.daily ?? [];
    expect(daily.map((day) => day.date)).toEqual(DATES);
    // The first day is covered by both roles, the following days are empty.
    expect(daily[0]?.level).not.toBe('GAP');
    expect(daily[1]?.level).toBe('GAP');
  });

  it('position of a moment on the axis is monotonic', () => {
    const axis = { start: '2026-09-07T00:00:00.000Z', end: '2026-09-10T00:00:00.000Z' };
    expect(positionOf(axis, '2026-09-07T00:00:00.000Z')).toBe(0);
    expect(positionOf(axis, '2026-09-08T12:00:00.000Z')).toBeCloseTo(0.5, 5);
    expect(positionOf(axis, '2026-09-10T00:00:00.000Z')).toBe(1);
    // Anything outside the axis clamps to the edge instead of running past it.
    expect(positionOf(axis, '2026-09-30T00:00:00.000Z')).toBe(1);
  });
});

describe('personal bars for the whole range (Overview reuses the day view)', () => {
  it('each assignment is its own bar, dated, on the shared range axis', () => {
    const { index, coverageCells, assignments } = setup();
    const range = buildDayDetailRange({
      dates: DATES,
      unitIds: [testUnit.id],
      assignments,
      coverageCells,
      index,
    });

    const bars = range.lanes[0]?.bars.filter((bar) => bar.kind === 'assigned') ?? [];
    expect(bars.map((bar) => bar.personName).sort()).toEqual(['Alice', 'Bob']);
    expect(bars.every((bar) => bar.date === '2026-09-07')).toBe(true);
  });

  it('gaps on different days do not collide by key', () => {
    // WHY: Regression — a gap bar's key within a single day is
    // `gap-${shiftId}`. Without the date in the key, the same uncovered Lead
    // on the second and third day got the same React key as the first —
    // React complained about duplicate keys, and the bars could collapse
    // into one.
    const { index, coverageCells, assignments } = setup();
    const range = buildDayDetailRange({
      dates: DATES,
      unitIds: [testUnit.id],
      assignments,
      coverageCells,
      index,
    });

    const gapKeys = range.lanes[0]?.bars.filter((bar) => bar.kind === 'gap').map((bar) => bar.key) ?? [];
    expect(gapKeys.length).toBeGreaterThan(1);
    expect(new Set(gapKeys).size).toBe(gapKeys.length);
  });

  it('the collapsed summary matches the aggregated timeline day for day', () => {
    const { index, coverageCells, assignments } = setup();
    const aggregate = buildTimelineRange({
      dates: DATES,
      unitIds: [testUnit.id],
      assignments,
      coverageCells,
      index,
    });
    const perPerson = buildDayDetailRange({
      dates: DATES,
      unitIds: [testUnit.id],
      assignments,
      coverageCells,
      index,
    });

    // Both strips share the same `dailyCoverage` — the collapsed view must
    // read the same regardless of which expanded view is behind it.
    expect(perPerson.lanes[0]?.daily).toEqual(aggregate.lanes[0]?.daily);
  });
});
