/**
 * Модель таймлайна: кто на смене в каждый момент суток.
 *
 * Это тот срез, ради которого продукт вообще перестаёт быть таблицей. Сетка
 * отвечает на вопрос «кто в какой день», и на него Excel отвечает не хуже.
 * Таймлайн отвечает на «а сейчас-то кто?» и «в какой час у нас дыра между
 * единицами планирования» — и вот этого в таблице нет и быть не может: там
 * нет времени, только даты.
 *
 * Оси — абсолютное время (UTC), потому что смысл имеет только оно. Смена
 * несёт собственное абсолютное окно в собственной таймзоне (ADR-0001), и
 * `Crew` 09:00–18:00 America/Chicago — это одно и то же абсолютное окно
 * независимо от того, в какой зоне на него смотрят. Перевод в зону
 * отображения делает слой вида.
 *
 * Передача смены (handover) не отдельная сущность: это пересечение окон двух
 * единиц планирования. Хранить его отдельно значило бы дать ему разойтись с
 * действительностью в первый же переход на летнее время.
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
  /** Смена требуется, но не поставлен никто: показывается пунктирной дырой. */
  readonly empty: boolean;
  /**
   * Подстрока внутри дорожки единицы планирования.
   *
   * В AMER восемь смен идут в одном и том же окне 09:00–18:00. Нарисованные
   * в одну строку, они кладутся друг на друга, и видна только последняя —
   * дорожка показывает одну смену вместо восьми. Блоки раскладываются жадно:
   * каждый занимает первую подстроку, где ни с чем не пересекается.
   */
  readonly row: number;
}

export interface TimelineLane {
  readonly unitId: UnitId;
  readonly unitName: string;
  readonly blocks: readonly TimelineBlock[];
  /** Объединённое окно присутствия единицы; `undefined` — единица не работает. */
  readonly span: UtcInterval | undefined;
  readonly gaps: number;
  /** Сколько подстрок понадобилось, чтобы блоки не наехали друг на друга. */
  readonly rowCount: number;
}

export interface Handover {
  readonly fromUnitId: UnitId;
  readonly toUnitId: UnitId;
  readonly interval: UtcInterval;
}

export interface TimelineDay {
  readonly date: IsoDate;
  /** Ось: от первого начала до последнего конца, выровнено по часу. */
  readonly axis: UtcInterval;
  readonly lanes: readonly TimelineLane[];
  readonly handovers: readonly Handover[];
  /** Сколько человек на смене в каждом часе оси. */
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
        // Некорректное окно смены — забота валидатора, не таймлайна.
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

  // Единицы выстраиваются по началу присутствия — так лента читается слева
  // направо как «сутки следуют за солнцем», а не в алфавитном порядке кодов.
  lanes.sort((a, b) => (a.span?.start ?? '~').localeCompare(b.span?.start ?? '~'));

  const axis = axisFor(lanes, date);

  return {
    date,
    axis,
    lanes,
    handovers: handoversOf(lanes),
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
    handovers: handoversOf(lanes),
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
 * Жадная раскладка по подстрокам: элемент занимает первую строку, где он ни с
 * чем не пересекается. Вход должен прийти отсортированным по началу — тогда
 * результат минимален по числу строк для интервального графа. Общая для
 * блоков смен и персональных баров — обе раскладки решают одну и ту же
 * геометрическую задачу.
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
 * Ось всегда покрывает как минимум сутки в UTC: иначе день, в котором работает
 * одна единица планирования, рисовался бы во всю ширину и выглядел бы как
 * круглосуточное покрытие.
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
 * Передача смены — пересечение окон соседних по времени единиц планирования.
 *
 * Соседних, а не всех пар: пересечение APAC и AMER (если оно есть) — это не
 * передача, а совпадение краёв суток, и подписывать его «handover» значило бы
 * врать про процесс.
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

/** Голов на смене в каждом часе оси. Веса приходят от вызывающей стороны:
 * блок несёт `people.length`, персональный бар — всегда 1. */
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
// Непрерывный период: время по горизонтали, единицы планирования друг под другом
// ---------------------------------------------------------------------------

/**
 * Многодневный таймлайн с **одной** осью времени.
 *
 * Первая версия рисовала каждый день отдельным блоком со своей осью, один под
 * другим. Это читается как отчёт, а не как лента: чтобы понять, что смена
 * APAC в понедельник кончается ровно там, где начинается EMEA, приходилось
 * сравнивать два процента в двух разных системах координат.
 *
 * Здесь одна непрерывная ось на весь период, дни — вертикальные линии на ней,
 * а единицы планирования стоят друг под другом. Тогда передача смены между
 * ними читается как стык, а не как совпадение чисел, и промотка вправо — это
 * промотка времени.
 */
export interface RangeDay {
  readonly date: IsoDate;
  /** Доля начала дня на оси, 0…1. */
  readonly left: number;
  readonly width: number;
}

export interface TimelineRangeBlock extends TimelineBlock {
  readonly date: IsoDate;
}

/** Сводка покрытия за день — то, что видно в свёрнутом заголовке единицы. */
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
  // Собирается из посуточной модели, а не параллельно ей: правила про окна
  // смен, дыры и передачи смены должны быть одни и те же, иначе таймлайн и
  // drill-down начнут расходиться в частных случаях.
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
        // Пустая и не требуемая смена не занимает строку: иначе редко
        // используемая смена раздувает дорожку на весь период ради пустоты.
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

  // Единицы упорядочены по началу первой смены за период — лента читается
  // сверху вниз как «сутки следуют за солнцем».
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
// Непрерывный период, персональные полосы: тот же день-детализация, но на
// всю ширину периода вместо одних суток.
// ---------------------------------------------------------------------------

/**
 * `buildDayDetail` для одного дня отвечает «кем именно закрыта смена» —
 * каждое назначение своей полосой вместо счётчика. Дашборд раньше показывал
 * период через `buildTimelineRange`, то есть агрегированными блоками смен —
 * тот вид, который и не нравился: в свёрнутом состоянии он не отличался от
 * развёрнутого достаточно, а в развёрнутом всё равно прятал людей за числом.
 * Разворачивая период этой функцией, лента дашборда получает ту же
 * грамматику, что и день-детализация, просто на несколько дней сразу — те же
 * полосы, те же дыры, те же передачи смены, одна ось.
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
  // Собирается из посуточной модели, как и `buildTimelineRange` — те же
  // правила про окна смен и дыры, никакой отдельной копии.
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
    };
  });

  // Тот же порядок, что у агрегированной ленты — по началу первой смены за
  // период, иначе одна и та же единица прыгала бы местами между двумя видами.
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
 * Ось выравнивается по границам суток UTC, даже если смена выходит за них.
 * Иначе вертикальные линии дней разъезжаются с подписями, и вся сетка времени
 * перестаёт быть сеткой.
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
    // Сравнивать надо сам момент, а округлять — уже результат. Округление
    // перед сравнением съедало расширение: смена, кончающаяся в 10:00
    // следующих суток, давала ту же полночь, что и граница периода, и ось
    // обрезала её.
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

/** Доля момента на оси, 0…1 — для абсолютного позиционирования блоков. */
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
 * Часовые метки на оси — общие для дневной детализации и для Overview на
 * масштабе «день»/«2 дня», где ось занимает весь экран и без часов читается
 * как одна безликая полоса. 3-часовой шаг внутри суток, 6-часовой на более
 * длинной оси — иначе метки наезжают друг на друга.
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
