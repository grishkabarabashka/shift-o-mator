/**
 * Модель таймлайна: кто на смене в каждый момент суток.
 *
 * Это тот срез, ради которого продукт вообще перестаёт быть таблицей. Сетка
 * отвечает на вопрос «кто в какой день», и на него Excel отвечает не хуже.
 * Таймлайн отвечает на «а сейчас-то кто?» и «в какой час у нас дыра между
 * регионами» — и вот этого в таблице нет и быть не может: там нет времени,
 * только даты.
 *
 * Оси — абсолютное время (UTC), потому что смысл имеет только оно. Роль несёт
 * собственное окно в собственной таймзоне (ADR-0001), и `Crew` 09:00–18:00
 * America/Chicago — это одно и то же абсолютное окно независимо от того, в
 * какой зоне на него смотрят. Перевод в зону отображения делает слой вида.
 *
 * Передача смены (handover) не отдельная сущность: это пересечение окон двух
 * регионов. Хранить его отдельно значило бы дать ему разойтись с
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
  RegionId,
  RoleId,
  UtcInterval,
} from '../domain/types.ts';
import { resolveDayConfiguration } from './dayConfig.ts';
import { shiftInterval } from './dates.ts';

export interface TimelinePerson {
  readonly id: PersonId;
  readonly name: string;
}

export interface TimelineBlock {
  readonly roleId: RoleId;
  readonly code: string;
  readonly label: string;
  readonly color: string;
  readonly interval: UtcInterval;
  readonly people: readonly TimelinePerson[];
  readonly required: number;
  readonly filled: number;
  readonly level: CoverageLevel;
  /** Роль требуется, но не поставлен никто: показывается пунктирной дырой. */
  readonly empty: boolean;
  /**
   * Подстрока внутри дорожки региона.
   *
   * В AMER восемь ролей идут в одном и том же окне 09:00–18:00. Нарисованные
   * в одну строку, они кладутся друг на друга, и видна только последняя —
   * дорожка показывает одну роль вместо восьми. Блоки раскладываются жадно:
   * каждый занимает первую подстроку, где ни с чем не пересекается.
   */
  readonly row: number;
}

export interface TimelineLane {
  readonly regionId: RegionId;
  readonly regionName: string;
  readonly blocks: readonly TimelineBlock[];
  /** Объединённое окно присутствия региона; `undefined` — регион не работает. */
  readonly span: UtcInterval | undefined;
  readonly gaps: number;
  /** Сколько подстрок понадобилось, чтобы блоки не наехали друг на друга. */
  readonly rowCount: number;
}

export interface Handover {
  readonly fromRegionId: RegionId;
  readonly toRegionId: RegionId;
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
  readonly regionIds: readonly RegionId[];
  readonly assignments: readonly Assignment[];
  readonly coverageCells: readonly CoverageCell[];
  readonly index: DatasetIndex;
}

const HOUR_MS = 3_600_000;

export function buildTimelineDay({
  date,
  regionIds,
  assignments,
  coverageCells,
  index,
}: TimelineInput): TimelineDay {
  const onDate = assignments.filter((assignment) => assignment.date === date);

  const peopleByRole = new Map<RoleId, TimelinePerson[]>();
  for (const assignment of onDate) {
    if (assignment.content.kind !== 'ROLE') continue;
    const person = index.people.get(assignment.personId);
    const bucket = peopleByRole.get(assignment.content.roleId);
    const entry = { id: assignment.personId, name: person?.displayName ?? assignment.personId };
    if (bucket) bucket.push(entry);
    else peopleByRole.set(assignment.content.roleId, [entry]);
  }

  const coverageByRole = new Map<string, CoverageCell>();
  for (const cell of coverageCells) {
    if (cell.date === date) coverageByRole.set(`${cell.regionId}|${cell.roleId}`, cell);
  }

  const lanes: TimelineLane[] = [];

  for (const regionId of regionIds) {
    const region = index.regions.get(regionId);
    const config = resolveDayConfiguration(regionId, date, index);
    if (!region || !config) continue;

    const raw: Omit<TimelineBlock, 'row'>[] = [];

    for (const requirement of config.roleRequirements) {
      const role = index.roles.get(requirement.roleId);
      if (!role || !role.countsAsCoverage) continue;

      let interval: UtcInterval;
      try {
        interval = shiftInterval(role, date);
      } catch {
        // Некорректное окно роли — забота валидатора, не таймлайна.
        continue;
      }

      const people = peopleByRole.get(role.id) ?? [];
      const coverage = coverageByRole.get(`${regionId}|${role.id}`);

      const min = coverage?.min ?? requirement.min;
      raw.push({
        roleId: role.id,
        code: role.code,
        label: role.label,
        color: role.color,
        interval,
        people,
        required: min,
        filled: coverage?.actual ?? people.length,
        level: coverage?.level ?? (people.length < min ? 'GAP' : 'OK'),
        empty: people.length === 0,
      });
    }

    raw.sort((a, b) => a.interval.start.localeCompare(b.interval.start));
    const blocks = packRows(raw);

    lanes.push({
      regionId,
      regionName: region.name,
      blocks,
      span: unionOf(blocks.map((block) => block.interval)),
      gaps: blocks.filter((block) => block.level === 'GAP').length,
      rowCount: blocks.reduce((max, block) => Math.max(max, block.row + 1), 1),
    });
  }

  // Регионы выстраиваются по началу присутствия — так лента читается слева
  // направо как «сутки следуют за солнцем», а не в алфавитном порядке кодов.
  lanes.sort((a, b) => (a.span?.start ?? '~').localeCompare(b.span?.start ?? '~'));

  const axis = axisFor(lanes, date);

  return {
    date,
    axis,
    lanes,
    handovers: handoversOf(lanes),
    headcountByHour: headcountOf(lanes, axis),
  };
}

/**
 * Жадная раскладка по подстрокам: блок занимает первую строку, где он ни с чем
 * не пересекается. Блоки должны прийти отсортированными по началу — тогда
 * результат минимален по числу строк для интервального графа.
 */
function packRows(blocks: readonly Omit<TimelineBlock, 'row'>[]): TimelineBlock[] {
  const rowEnds: string[] = [];
  return blocks.map((block) => {
    let row = rowEnds.findIndex((end) => end <= block.interval.start);
    if (row === -1) row = rowEnds.length;
    rowEnds[row] = block.interval.end;
    return { ...block, row };
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
 * один регион, рисовался бы во всю ширину и выглядел бы как круглосуточное
 * покрытие.
 */
function axisFor(lanes: readonly TimelineLane[], date: IsoDate): UtcInterval {
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
 * Передача смены — пересечение окон соседних по времени регионов.
 *
 * Соседних, а не всех пар: пересечение APAC и AMER (если оно есть) — это не
 * передача, а совпадение краёв суток, и подписывать его «handover» значило бы
 * врать про процесс.
 */
function handoversOf(lanes: readonly TimelineLane[]): Handover[] {
  const handovers: Handover[] = [];
  for (let i = 0; i < lanes.length - 1; i += 1) {
    const a = lanes[i]?.span;
    const b = lanes[i + 1]?.span;
    const fromId = lanes[i]?.regionId;
    const toId = lanes[i + 1]?.regionId;
    if (!a || !b || !fromId || !toId) continue;
    if (a.end <= b.start) continue;
    handovers.push({
      fromRegionId: fromId,
      toRegionId: toId,
      interval: { start: b.start, end: a.end < b.end ? a.end : b.end },
    });
  }
  return handovers;
}

/** Голов на смене в каждом часе оси. Считает людей, а не роли. */
function headcountOf(lanes: readonly TimelineLane[], axis: UtcInterval): number[] {
  const start = Date.parse(axis.start);
  const hours = Math.max(1, Math.round((Date.parse(axis.end) - start) / HOUR_MS));
  const counts = new Array<number>(hours).fill(0);

  for (const lane of lanes) {
    for (const block of lane.blocks) {
      if (block.people.length === 0) continue;
      const from = Math.floor((Date.parse(block.interval.start) - start) / HOUR_MS);
      const to = Math.ceil((Date.parse(block.interval.end) - start) / HOUR_MS);
      for (let hour = Math.max(0, from); hour < Math.min(hours, to); hour += 1) {
        counts[hour] = (counts[hour] ?? 0) + block.people.length;
      }
    }
  }
  return counts;
}

/** Доля момента на оси, 0…1 — для абсолютного позиционирования блоков. */
export function positionOf(axis: UtcInterval, instant: IsoInstant): number {
  const start = Date.parse(axis.start);
  const total = Date.parse(axis.end) - start;
  if (total <= 0) return 0;
  return Math.min(Math.max((Date.parse(instant) - start) / total, 0), 1);
}
