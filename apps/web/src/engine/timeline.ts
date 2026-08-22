/**
 * NOTE: Timeline model — who is on shift at each moment of the day.
 *
 * This is the slice the product exists for beyond being a table. The grid
 * answers "who, on which day", and Excel answers that just as well. The
 * timeline answers "who, right now" and "which hour has a gap between
 * planning units" — and a table cannot express that: it has no time axis,
 * only dates.
 *
 * The axis is absolute time (UTC), because that is the only thing with
 * meaning. A shift carries its own absolute window in its own timezone
 * (ADR-0001), and `Crew` 09:00-18:00 America/Chicago is the same absolute
 * window regardless of which zone views it. Conversion to a display zone
 * happens in the view layer.
 *
 * A handover is not a separate entity: it's the intersection of two
 * planning units' windows. Storing it separately would let it drift from
 * reality at the first daylight-saving transition.
 */

import { DateTime } from 'luxon';
import type { DatasetIndex } from '../domain/lookup.ts';
import type {
  Assignment,
  CoverageCell,
  CoverageLevel,
  IsoDate,
  IsoInstant,
  PersonId,
  ShiftId,
  UnitId,
  UtcInterval,
} from '../domain/types.ts';
import { formatInZone, shiftInterval } from './dates.ts';

export interface TimelinePerson {
  readonly id: PersonId;
  readonly name: string;
}

export interface TimelineBlock {
  readonly shiftId: ShiftId;
  readonly code: string;
  readonly label: string;
  readonly color: string;
  readonly interval: UtcInterval;
  readonly people: readonly TimelinePerson[];
  readonly required: number;
  readonly filled: number;
  readonly level: CoverageLevel;
  /** NOTE: Shift is required but nobody is staffed on it: rendered as a dashed gap. */
  readonly empty: boolean;
  /**
   * NOTE: Sub-row within the planning unit's lane.
   *
   * AMER runs eight shifts in the same 09:00-18:00 window. Drawn on one row,
   * they'd stack on top of each other and only the last would show — the
   * lane would display one shift instead of eight. Blocks are packed
   * greedily: each takes the first sub-row it doesn't overlap with.
   */
  readonly row: number;
}

export interface TimelineLane {
  readonly unitId: UnitId;
  readonly unitName: string;
  readonly blocks: readonly TimelineBlock[];
  /** NOTE: Union of the unit's presence windows; `undefined` means the unit isn't working. */
  readonly span: UtcInterval | undefined;
  readonly gaps: number;
  /** NOTE: How many sub-rows were needed so blocks don't overlap. */
  readonly rowCount: number;
}

export interface Handover {
  readonly fromUnitId: UnitId;
  readonly toUnitId: UnitId;
  readonly interval: UtcInterval;
}

export interface TimelineDay {
  readonly date: IsoDate;
  /** NOTE: Axis from the first start to the last end, rounded to the hour. */
  readonly axis: UtcInterval;
  readonly lanes: readonly TimelineLane[];
  readonly handovers: readonly Handover[];
  /** NOTE: Headcount on shift in each hour of the axis. */
  readonly headcountByHour: readonly number[];
}

export interface TimelineInput {
  readonly date: IsoDate;
  readonly unitIds: readonly UnitId[];
  readonly assignments: readonly Assignment[];
  readonly coverageCells: readonly CoverageCell[];
  readonly index: DatasetIndex;
}

/**
 * One bar per assigned person, or one dashed bar for an unfilled requirement.
 *
 * The aggregate `TimelineBlock` above answers "is this shift covered" — it
 * collapses everyone into a count. The day drill-down answers "who,
 * specifically" — each assignment gets its own row instead of being folded
 * into `people.length`.
 */
export interface DayDetailBar {
  readonly key: string;
  readonly kind: 'assigned' | 'gap';
  readonly personId: PersonId | undefined;
  readonly personName: string | undefined;
  readonly shiftId: ShiftId;
  readonly code: string;
  readonly color: string;
  readonly interval: UtcInterval;
  readonly row: number;
}

export interface DayDetailLane {
  readonly unitId: UnitId;
  readonly unitName: string;
  readonly bars: readonly DayDetailBar[];
  readonly span: UtcInterval | undefined;
  readonly rowCount: number;
  readonly gaps: number;
}

export interface DayDetail {
  readonly date: IsoDate;
  readonly axis: UtcInterval;
  readonly lanes: readonly DayDetailLane[];
  readonly handovers: readonly Handover[];
  readonly headcountByHour: readonly number[];
}

const HOUR_MS = 3_600_000;

export function buildTimelineDay({
  date,
  unitIds,
  assignments,
  coverageCells,
  index,
}: TimelineInput): TimelineDay {
  const onDate = assignments.filter((assignment) => assignment.date === date);

  const peopleByShift = new Map<ShiftId, TimelinePerson[]>();
  for (const assignment of onDate) {
    if (assignment.content.kind !== 'SHIFT') continue;
    const person = index.people.get(assignment.personId);
    const bucket = peopleByShift.get(assignment.content.shiftId);
    const entry = { id: assignment.personId, name: person?.displayName ?? assignment.personId };
    if (bucket) bucket.push(entry);
    else peopleByShift.set(assignment.content.shiftId, [entry]);
  }

  const lanes: TimelineLane[] = [];

  for (const unitId of unitIds) {
    const unit = index.units.get(unitId);
    if (!unit) continue;

    const raw: Omit<TimelineBlock, 'row'>[] = [];

    // The set of required shifts for the day comes from the coverage cells
    // themselves (server-resolved, Phase 5) rather than from a locally
    // re-resolved day configuration — they already enumerate exactly the
    // shifts required that day, one cell per shift.
    for (const cell of coverageCells) {
      if (cell.unitId !== unitId || cell.date !== date) continue;
      const shift = index.shifts.get(cell.shiftId);
      if (!shift || !shift.countsAsCoverage) continue;

      let interval: UtcInterval;
      try {
        interval = shiftInterval(shift, date);
      } catch {
        // NOTE: A malformed shift window is the validator's concern, not the timeline's.
        continue;
      }

      const people = peopleByShift.get(shift.id) ?? [];

      raw.push({
        shiftId: shift.id,
        code: shift.code,
        label: shift.label,
        color: shift.color,
        interval,
        people,
        required: cell.min,
        filled: cell.actual,
        level: cell.level,
        empty: people.length === 0,
      });
    }

    raw.sort((a, b) => a.interval.start.localeCompare(b.interval.start));
    const blocks = packRows(raw);

    lanes.push({
      unitId,
      unitName: unit.name,
      blocks,
      span: unionOf(blocks.map((block) => block.interval)),
      gaps: blocks.filter((block) => block.level === 'GAP').length,
      rowCount: blocks.reduce((max, block) => Math.max(max, block.row + 1), 1),
    });
  }

  // NOTE: Units are ordered by the start of their presence, so the lane reads
  // left to right as "the day follows the sun", not alphabetically by code.
  lanes.sort((a, b) => (a.span?.start ?? '~').localeCompare(b.span?.start ?? '~'));

  const axis = axisFor(lanes, date);

  return {
    date,
    axis,
    lanes,
    handovers: handoversOf(regionLanesFor(lanes, index)),
    headcountByHour: headcountOf(
      lanes.flatMap((lane) =>
        lane.blocks.filter((block) => !block.empty).map((block) => ({
          interval: block.interval,
          weight: block.people.length,
        })),
      ),
      axis,
    ),
  };
}

/**
 * Person-level day detail: one bar per assignment plus one dashed bar per
 * unfilled requirement. Same unit-window and handover math as
 * `buildTimelineDay` — only the bar granularity differs, so the two share
 * `axisFor`/`handoversOf`/`headcountOf` rather than each computing its own.
 */
export function buildDayDetail({
  date,
  unitIds,
  assignments,
  coverageCells,
  index,
}: TimelineInput): DayDetail {
  const onDate = assignments.filter((assignment) => assignment.date === date);

  const lanes: DayDetailLane[] = [];

  for (const unitId of unitIds) {
    const unit = index.units.get(unitId);
    if (!unit) continue;

    const raw: Omit<DayDetailBar, 'row'>[] = [];

    // Same source of truth as `buildTimelineDay`: the coverage cells already
    // enumerate exactly the shifts required that day (server-resolved).
    for (const cell of coverageCells) {
      if (cell.unitId !== unitId || cell.date !== date) continue;
      const shift = index.shifts.get(cell.shiftId);
      if (!shift || !shift.countsAsCoverage) continue;

      const assignedHere = onDate.filter(
        (assignment) => assignment.content.kind === 'SHIFT' && assignment.content.shiftId === shift.id,
      );
      const min = cell.min;

      if (assignedHere.length === 0) {
        if (min === 0) continue; // not required today — not a gap, just absent from the lane
        try {
          raw.push({
            key: `gap-${shift.id}`,
            kind: 'gap',
            personId: undefined,
            personName: undefined,
            shiftId: shift.id,
            code: shift.code,
            color: shift.color,
            interval: shiftInterval(shift, date),
          });
        } catch {
          // Malformed shift window — the validator's job, not the timeline's.
        }
        continue;
      }

      for (const assignment of assignedHere) {
        if (assignment.content.kind !== 'SHIFT') continue;
        let interval: UtcInterval;
        try {
          interval = shiftInterval(shift, date, assignment.content.timeOverride);
        } catch {
          continue;
        }
        const person = index.people.get(assignment.personId);
        raw.push({
          key: assignment.id,
          kind: 'assigned',
          personId: assignment.personId,
          personName: person?.displayName ?? assignment.personId,
          shiftId: shift.id,
          code: shift.code,
          color: shift.color,
          interval,
        });
      }
    }

    raw.sort((a, b) => a.interval.start.localeCompare(b.interval.start));
    const bars = packRows(raw);

    lanes.push({
      unitId,
      unitName: unit.name,
      bars,
      span: unionOf(bars.map((bar) => bar.interval)),
      gaps: bars.filter((bar) => bar.kind === 'gap').length,
      rowCount: bars.reduce((max, bar) => Math.max(max, bar.row + 1), 1),
    });
  }

  lanes.sort((a, b) => (a.span?.start ?? '~').localeCompare(b.span?.start ?? '~'));
  const axis = axisFor(lanes, date);

  return {
    date,
    axis,
    lanes,
    handovers: handoversOf(regionLanesFor(lanes, index)),
    headcountByHour: headcountOf(
      lanes.flatMap((lane) =>
        lane.bars.filter((bar) => bar.kind === 'assigned').map((bar) => ({
          interval: bar.interval,
          weight: 1,
        })),
      ),
      axis,
    ),
  };
}

/**
 * NOTE: Greedy sub-row packing: an item takes the first row it doesn't
 * overlap with. Input must arrive sorted by start — then the result is
 * minimal in row count for an interval graph. Shared by shift blocks and
 * personal bars — both layouts solve the same geometric problem.
 */
function packRows<T extends { interval: UtcInterval }>(items: readonly T[]): (T & { row: number })[] {
  const rowEnds: string[] = [];
  return items.map((item) => {
    let row = rowEnds.findIndex((end) => end <= item.interval.start);
    if (row === -1) row = rowEnds.length;
    rowEnds[row] = item.interval.end;
    return { ...item, row };
  });
}

function unionOf(intervals: readonly UtcInterval[]): UtcInterval | undefined {
  if (intervals.length === 0) return undefined;
  let start = intervals[0]!.start;
  let end = intervals[0]!.end;
  for (const interval of intervals) {
    if (interval.start < start) start = interval.start;
    if (interval.end > end) end = interval.end;
  }
  return { start, end };
}

/**
 * NOTE: The axis always covers at least one UTC day: otherwise a day where
 * only one planning unit works would render across the full width and look
 * like round-the-clock coverage.
 */
function axisFor(lanes: readonly { span: UtcInterval | undefined }[], date: IsoDate): UtcInterval {
  const dayStart = DateTime.fromISO(`${date}T00:00:00`, { zone: 'utc' });
  const dayEnd = dayStart.plus({ days: 1 });

  const spans = lanes.map((lane) => lane.span).filter((span): span is UtcInterval => !!span);
  const union = unionOf(spans);

  const start = union && union.start < dayStart.toISO()! ? floorHour(union.start) : dayStart.toISO()!;
  const end = union && union.end > dayEnd.toISO()! ? ceilHour(union.end) : dayEnd.toISO()!;
  return { start, end };
}

function floorHour(instant: IsoInstant): IsoInstant {
  return DateTime.fromISO(instant, { zone: 'utc' }).startOf('hour').toISO()!;
}

function ceilHour(instant: IsoInstant): IsoInstant {
  const dt = DateTime.fromISO(instant, { zone: 'utc' });
  const floored = dt.startOf('hour');
  return (floored.equals(dt) ? dt : floored.plus({ hours: 1 })).toISO()!;
}

/**
 * NOTE: Only REGION units participate in shift handover — handover only
 * exists between them (follow-the-sun: AMER -> EMEA -> APAC -> AMER). A
 * CROSS_REGION unit like unit-st overlaps in time with its regional
 * neighbors almost always, but that's not a handover: its own per-region
 * coverage (ST:AMER/ST:EMEA/ST:APAC) is that unit's own internal matter,
 * drawn in its own lane, and shading "this unit hands off to that one" here
 * would misrepresent it (owner review).
 */
function regionLanesFor<T extends { unitId: UnitId }>(
  lanes: readonly T[],
  index: DatasetIndex,
): readonly T[] {
  return lanes.filter((lane) => index.units.get(lane.unitId)?.kind === 'REGION');
}

/**
 * NOTE: A handover is the intersection of the windows of time-adjacent
 * planning units.
 *
 * Adjacent, not every pair: the intersection of APAC and AMER (if any) is
 * not a handover but a coincidence of day boundaries, and labeling it
 * "handover" would misrepresent the process.
 */
function handoversOf(
  lanes: readonly { unitId: UnitId; span: UtcInterval | undefined }[],
): Handover[] {
  const handovers: Handover[] = [];
  for (let i = 0; i < lanes.length - 1; i += 1) {
    const a = lanes[i]?.span;
    const b = lanes[i + 1]?.span;
    const fromId = lanes[i]?.unitId;
    const toId = lanes[i + 1]?.unitId;
    if (!a || !b || !fromId || !toId) continue;
    if (a.end <= b.start) continue;
    handovers.push({
      fromUnitId: fromId,
      toUnitId: toId,
      interval: { start: b.start, end: a.end < b.end ? a.end : b.end },
    });
  }
  return handovers;
}

/** NOTE: Headcount on shift in each hour of the axis. Weights come from the
 * caller: a block carries `people.length`, a personal bar is always 1. */
function headcountOf(
  items: readonly { interval: UtcInterval; weight: number }[],
  axis: UtcInterval,
): number[] {
  const start = Date.parse(axis.start);
  const hours = Math.max(1, Math.round((Date.parse(axis.end) - start) / HOUR_MS));
  const counts = new Array<number>(hours).fill(0);

  for (const item of items) {
    const from = Math.floor((Date.parse(item.interval.start) - start) / HOUR_MS);
    const to = Math.ceil((Date.parse(item.interval.end) - start) / HOUR_MS);
    for (let hour = Math.max(0, from); hour < Math.min(hours, to); hour += 1) {
      counts[hour] = (counts[hour] ?? 0) + item.weight;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Continuous range: time runs horizontally, planning units stack vertically
// ---------------------------------------------------------------------------

/**
 * NOTE: Multi-day timeline with a **single** time axis.
 *
 * The first version drew each day as its own block with its own axis,
 * stacked one under the other. That reads as a report, not a strip: to see
 * that APAC's Monday shift ends exactly where EMEA's begins, you had to
 * compare two percentages in two different coordinate systems.
 *
 * Here there is one continuous axis for the whole range, days are vertical
 * lines on it, and planning units stack under each other. Then a handover
 * between them reads as a seam, not a coincidence of numbers, and scrolling
 * right is scrolling through time.
 */
export interface RangeDay {
  readonly date: IsoDate;
  /** NOTE: Fraction of the axis where the day starts, 0..1. */
  readonly left: number;
  readonly width: number;
}

export interface TimelineRangeBlock extends TimelineBlock {
  readonly date: IsoDate;
}

/** NOTE: Per-day coverage summary — what shows in a unit's collapsed header. */
export interface DayCoverage {
  readonly date: IsoDate;
  readonly filled: number;
  readonly required: number;
  readonly level: CoverageLevel;
}

export interface TimelineRangeLane {
  readonly unitId: UnitId;
  readonly unitName: string;
  readonly blocks: readonly TimelineRangeBlock[];
  readonly rowCount: number;
  readonly gaps: number;
  readonly daily: readonly DayCoverage[];
}

export interface DatedHandover extends Handover {
  readonly date: IsoDate;
}

export interface TimelineRange {
  readonly axis: UtcInterval;
  readonly days: readonly RangeDay[];
  readonly lanes: readonly TimelineRangeLane[];
  readonly handovers: readonly DatedHandover[];
  readonly headcountByHour: readonly number[];
}

export interface TimelineRangeInput {
  readonly dates: readonly IsoDate[];
  readonly unitIds: readonly UnitId[];
  readonly assignments: readonly Assignment[];
  readonly coverageCells: readonly CoverageCell[];
  readonly index: DatasetIndex;
}

export function buildTimelineRange({
  dates,
  unitIds,
  assignments,
  coverageCells,
  index,
}: TimelineRangeInput): TimelineRange {
  // NOTE: Built from the per-day model, not in parallel with it: the rules
  // for shift windows, gaps, and handovers must stay identical, or the
  // timeline and the drill-down would start disagreeing on edge cases.
  const days = dates.map((date) =>
    buildTimelineDay({ date, unitIds, assignments, coverageCells, index }),
  );

  const axis = axisOverDays(days, dates);

  const byUnit = new Map<UnitId, { name: string; blocks: TimelineRangeBlock[] }>();
  const handovers: DatedHandover[] = [];

  for (const day of days) {
    for (const lane of day.lanes) {
      const bucket = byUnit.get(lane.unitId) ?? { name: lane.unitName, blocks: [] };
      for (const block of lane.blocks) {
        // NOTE: An empty, non-required shift doesn't occupy a row: otherwise
        // a rarely used shift would inflate the lane across the whole range
        // for nothing.
        if (block.empty && block.level !== 'GAP') continue;
        bucket.blocks.push({ ...block, date: day.date });
      }
      byUnit.set(lane.unitId, bucket);
    }
    for (const handover of day.handovers) handovers.push({ ...handover, date: day.date });
  }

  const coverageByDayUnit = dailyCoverage(coverageCells, dates, unitIds);

  const lanes: TimelineRangeLane[] = [...byUnit.entries()].map(([unitId, bucket]) => {
    const sorted = [...bucket.blocks].sort((a, b) =>
      a.interval.start.localeCompare(b.interval.start),
    );
    const packed = packRows(sorted);
    return {
      unitId,
      unitName: bucket.name,
      blocks: packed,
      rowCount: packed.reduce((max, block) => Math.max(max, block.row + 1), 1),
      gaps: packed.filter((block) => block.level === 'GAP').length,
      daily: coverageByDayUnit.get(unitId) ?? [],
    };
  });

  // NOTE: Units are ordered by the start of their first shift in the range —
  // the strip reads top to bottom as "the day follows the sun".
  lanes.sort((a, b) =>
    (a.blocks[0]?.interval.start ?? '~').localeCompare(b.blocks[0]?.interval.start ?? '~'),
  );

  return {
    axis,
    days: dates.map((date) => dayGeometry(axis, date)),
    lanes,
    handovers,
    headcountByHour: headcountOf(
      lanes.flatMap((lane) =>
        lane.blocks
          .filter((block) => !block.empty)
          .map((block) => ({ interval: block.interval, weight: block.people.length })),
      ),
      axis,
    ),
  };
}

// ---------------------------------------------------------------------------
// Continuous range, personal bars: the same day-detail view, but spanning
// the full range instead of a single day.
// ---------------------------------------------------------------------------

/**
 * NOTE: For a single day, `buildDayDetail` answers "who exactly is covering
 * the shift" — each assignment gets its own bar instead of a count. The
 * dashboard used to show a range via `buildTimelineRange`, i.e. aggregated
 * shift blocks — the view that didn't work well: collapsed it wasn't
 * distinct enough from expanded, and expanded it still hid people behind a
 * number. Extending day-detail to a range with this function gives the
 * dashboard strip the same grammar as day-detail, just across several days
 * at once — the same bars, the same gaps, the same handovers, one axis.
 */
export interface DayDetailRangeBar extends DayDetailBar {
  readonly date: IsoDate;
}

export interface DayDetailRangeLane {
  readonly unitId: UnitId;
  readonly unitName: string;
  readonly bars: readonly DayDetailRangeBar[];
  readonly rowCount: number;
  readonly gaps: number;
  readonly daily: readonly DayCoverage[];
  /** This unit's own on-shift headcount, hour by hour across the axis — not
   * the combined figure every lane shares, so each unit's own load reads on
   * its own row instead of only in one graph at the bottom of everything. */
  readonly headcountByHour: readonly number[];
}

export interface DayDetailRange {
  readonly axis: UtcInterval;
  readonly days: readonly RangeDay[];
  readonly lanes: readonly DayDetailRangeLane[];
  readonly handovers: readonly DatedHandover[];
  readonly headcountByHour: readonly number[];
}

export function buildDayDetailRange({
  dates,
  unitIds,
  assignments,
  coverageCells,
  index,
}: TimelineRangeInput): DayDetailRange {
  // NOTE: Built from the per-day model, same as `buildTimelineRange` — the
  // same rules for shift windows and gaps, no separate copy.
  const days = dates.map((date) => buildDayDetail({ date, unitIds, assignments, coverageCells, index }));

  const axis = axisOverDays(days, dates);

  const byUnit = new Map<UnitId, { name: string; bars: DayDetailRangeBar[] }>();
  const handovers: DatedHandover[] = [];

  for (const day of days) {
    for (const lane of day.lanes) {
      const bucket = byUnit.get(lane.unitId) ?? { name: lane.unitName, bars: [] };
      for (const bar of lane.bars) {
        // `bar.key` is unique within one day only — a gap bar's key is
        // `gap-${shiftId}`, so the same unfilled shift on two different days
        // collided once bars from every day landed in the same list.
        bucket.bars.push({ ...bar, date: day.date, key: `${day.date}-${bar.key}` });
      }
      byUnit.set(lane.unitId, bucket);
    }
    for (const handover of day.handovers) handovers.push({ ...handover, date: day.date });
  }

  const coverageByDayUnit = dailyCoverage(coverageCells, dates, unitIds);

  const lanes: DayDetailRangeLane[] = [...byUnit.entries()].map(([unitId, bucket]) => {
    const sorted = [...bucket.bars].sort((a, b) => a.interval.start.localeCompare(b.interval.start));
    const packed = packRows(sorted);
    return {
      unitId,
      unitName: bucket.name,
      bars: packed,
      rowCount: packed.reduce((max, bar) => Math.max(max, bar.row + 1), 1),
      gaps: packed.filter((bar) => bar.kind === 'gap').length,
      daily: coverageByDayUnit.get(unitId) ?? [],
      headcountByHour: headcountOf(
        packed.filter((bar) => bar.kind === 'assigned').map((bar) => ({ interval: bar.interval, weight: 1 })),
        axis,
      ),
    };
  });

  // NOTE: Same ordering as the aggregated strip — by the start of the first
  // shift in the range, otherwise the same unit would jump places between
  // the two views.
  lanes.sort((a, b) => (a.bars[0]?.interval.start ?? '~').localeCompare(b.bars[0]?.interval.start ?? '~'));

  return {
    axis,
    days: dates.map((date) => dayGeometry(axis, date)),
    lanes,
    handovers,
    headcountByHour: headcountOf(
      lanes.flatMap((lane) =>
        lane.bars.filter((bar) => bar.kind === 'assigned').map((bar) => ({ interval: bar.interval, weight: 1 })),
      ),
      axis,
    ),
  };
}

/**
 * NOTE: The axis aligns to UTC day boundaries even when a shift extends
 * beyond them. Otherwise the vertical day lines drift from their labels, and
 * the whole time grid stops being a grid.
 */
function axisOverDays(days: readonly { axis: UtcInterval }[], dates: readonly IsoDate[]): UtcInterval {
  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) {
    const now = DateTime.utc().startOf('day');
    return { start: now.toISO()!, end: now.plus({ days: 1 }).toISO()! };
  }

  let start = DateTime.fromISO(`${first}T00:00:00`, { zone: 'utc' });
  let end = DateTime.fromISO(`${last}T00:00:00`, { zone: 'utc' }).plus({ days: 1 });

  for (const day of days) {
    const dayStart = DateTime.fromISO(day.axis.start, { zone: 'utc' });
    const dayEnd = DateTime.fromISO(day.axis.end, { zone: 'utc' });
    // WHY: Compare the raw instant, round only the result. Rounding before
    // comparing swallowed the extension: a shift ending at 10:00 the next
    // day produced the same midnight as the range boundary, and the axis
    // clipped it.
    if (dayStart < start) start = dayStart.startOf('day');
    if (dayEnd > end) end = ceilDay(dayEnd);
  }

  return { start: start.toISO()!, end: end.toISO()! };
}

function ceilDay(dt: DateTime): DateTime {
  const floored = dt.startOf('day');
  return floored.equals(dt) ? dt : floored.plus({ days: 1 });
}

function dayGeometry(axis: UtcInterval, date: IsoDate): RangeDay {
  const start = `${date}T00:00:00.000Z`;
  const end = DateTime.fromISO(start, { zone: 'utc' }).plus({ days: 1 }).toISO()!;
  const left = positionOf(axis, start);
  return { date, left, width: positionOf(axis, end) - left };
}

function dailyCoverage(
  cells: readonly CoverageCell[],
  dates: readonly IsoDate[],
  unitIds: readonly UnitId[],
): Map<UnitId, DayCoverage[]> {
  const result = new Map<UnitId, DayCoverage[]>();

  for (const unitId of unitIds) {
    const perDay: DayCoverage[] = dates.map((date) => {
      let filled = 0;
      let required = 0;
      let level: CoverageLevel = 'OK';

      for (const cell of cells) {
        if (cell.unitId !== unitId || cell.date !== date) continue;
        filled += cell.actual;
        required += cell.min;
        if (cell.level === 'GAP') level = 'GAP';
        else if (cell.level === 'THIN' && level !== 'GAP') level = 'THIN';
      }
      return { date, filled, required, level };
    });
    result.set(unitId, perDay);
  }
  return result;
}

/** NOTE: Fraction of a moment on the axis, 0..1 — for absolute positioning of blocks. */
export function positionOf(axis: UtcInterval, instant: IsoInstant): number {
  const start = Date.parse(axis.start);
  const total = Date.parse(axis.end) - start;
  if (total <= 0) return 0;
  return Math.min(Math.max((Date.parse(instant) - start) / total, 0), 1);
}

export interface HourTick {
  readonly at: IsoInstant;
  readonly left: number;
  readonly label: string;
}

/**
 * NOTE: Hour ticks on the axis — shared between day-detail and Overview at
 * the "1 day"/"2 day" zoom, where the axis fills the whole screen and reads
 * as one featureless strip without them. A 3-hour step within a day, 6-hour
 * on a longer axis — otherwise ticks would overlap.
 */
export function hourTicks(axis: UtcInterval, zone: string): HourTick[] {
  const start = Date.parse(axis.start);
  const end = Date.parse(axis.end);
  const hours = Math.round((end - start) / HOUR_MS);
  const step = hours <= 24 ? 3 : 6;

  const ticks: HourTick[] = [];
  for (let hour = 0; hour <= hours; hour += step) {
    const at = new Date(start + hour * HOUR_MS).toISOString();
    ticks.push({ at, left: positionOf(axis, at) * 100, label: formatInZone(at, zone, 'HH:mm') });
  }
  return ticks;
}
