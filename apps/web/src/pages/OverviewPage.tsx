/**
 * Overview — дашборд и таймлайн одним экраном.
 *
 * Раньше это были две вкладки, и обе отвечали на один вопрос — «закрыты ли
 * мы» — только с разной детализацией. Пользователь читал сводку на одной,
 * потом шёл на другую смотреть, где именно дыра, и заново искал единицу и день.
 * Разделение стоило перехода и не давало ничего.
 *
 * Теперь один экран трёх слоёв, сверху вниз по убыванию срочности:
 *
 *   1. цифры за период;
 *   2. что чинить — список, ведущий в конкретную ячейку сетки;
 *   3. **одна непрерывная лента времени**, единицы планирования друг под другом.
 *
 * Лента всегда развёрнута — полосы по людям, как в day-drilldown, а не суточная
 * клетка «занято/нужно»: владелец предпочёл читать «кем именно» с одного взгляда,
 * без клика внутрь. Один день занимает примерно всю измеренную ширину контейнера
 * (не сжимается, чтобы влезло N дней) — несколько дней подряд промысливаются
 * горизонтальной промоткой, а не потерей читаемости.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import type { Issue, IsoDate, Location, UtcInterval } from '../domain/types.ts';
import { eachDate, formatInZone, parseDate } from '../engine/dates.ts';
import { dedupeLocationsByZone } from '../engine/locationClocks.ts';
import {
  buildDayDetailRange,
  hourTicks,
  positionOf,
  type DayDetailRange,
  type DayDetailRangeBar,
  type DayDetailRangeLane,
} from '../engine/timeline.ts';
import { useSchedule } from '../store/useSchedule.ts';
import { TODAY, useUi } from '../store/useUi.ts';
import { useElementWidth } from '../ui/useElementWidth.ts';
import { DateRangeControl } from '../features/shell/DateRangeControl.tsx';
import type { PlanningView } from '../features/planning/usePlanningView.ts';

/**
 * Пикселей на сутки — фиксировано на ширину измеренного контейнера, не сжимается
 * под число дней в диапазоне (owner review: сжатые 3 дня уже читались плохо).
 * Одни сутки = один разворот экрана; больше дней — горизонтальная промотка, а
 * не более узкие сутки. `MIN_DAY_PX` — только пол на первый кадр, пока ширина
 * ещё не измерена.
 */
const MIN_DAY_PX = 320;

const ROW_H = 22;
const HEADCOUNT_H = 20;

interface Props {
  readonly view: PlanningView;
  readonly now: string;
}

export function OverviewPage({ view, now }: Props) {
  const navigate = useNavigate();
  const range = useUi((s) => s.range);
  const displayZone = useUi((s) => s.displayZone);
  const select = useUi((s) => s.select);
  const focusDate = useUi((s) => s.focusDate);
  const setAnchor = useUi((s) => s.setAnchor);
  const plan = useSchedule((s) => s.plan);
  const index = useSchedule((s) => s.index);
  const reference = useSchedule((s) => s.reference);

  const [fillRef, fillWidth] = useElementWidth<HTMLDivElement>();

  const dates = useMemo(() => eachDate(range), [range]);

  // Every location behind the units actually on screen — so "now" reads the
  // same regardless of which unit's coverage you're looking at, not just the
  // header's globally-selected unit.
  const nowClocks = useMemo(() => {
    if (!reference) return [];
    const locationIds = new Set<string>();
    for (const unitId of view.unitIds) {
      const unit = reference.units.find((u) => u.id === unitId);
      unit?.locationIds.forEach((id) => locationIds.add(id));
    }
    const primaryLocationIds = new Set(reference.units.map((u) => u.primaryLocationId));
    const locations = reference.locations.filter((l) => locationIds.has(l.id));
    return dedupeLocationsByZone(locations, primaryLocationIds);
  }, [reference, view.unitIds]);

  const timeline = useMemo<DayDetailRange | undefined>(() => {
    if (!plan || !index) return undefined;
    return buildDayDetailRange({
      dates,
      unitIds: view.unitIds,
      assignments: plan.assignments,
      coverageCells: view.coverageCells,
      index,
    });
  }, [dates, plan, index, view.unitIds, view.coverageCells]);

  const zone = displayZone === 'shift' ? 'UTC' : displayZone;
  const dayPx = Math.max(MIN_DAY_PX, fillWidth);
  const width = dates.length * dayPx;
  const axisTop = 26 + nowClocks.length * 22;

  const gaps = view.issues.filter(
    (issue) => issue.level === 'BLOCKING' && issue.category === 'GAP',
  );
  const conflicts = view.issues.filter((issue) => issue.category === 'CONFLICT');
  const attention = [...gaps, ...conflicts];

  const onShiftNow =
    timeline?.lanes.reduce(
      (sum, lane) =>
        sum +
        lane.bars.filter(
          (bar) => bar.kind === 'assigned' && bar.interval.start <= now && now < bar.interval.end,
        ).length,
      0,
    ) ?? 0;

  const gapDays = new Set(gaps.map((issue) => issue.date).filter(Boolean)).size;
  const people = view.rows.filter((row) => row.kind === 'person').length;

  /** Дыра указывает только на день — у неё нет человека, в этом её суть. */
  const goToIssue = (issue: Issue) => {
    if (!issue.date) return;
    setAnchor(issue.date);
    if (issue.personId) select({ personId: issue.personId, date: issue.date });
    focusDate(issue.date, issue.personId);
    void navigate('/schedule');
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <DateRangeControl />

      <section className="card grid shrink-0 grid-cols-2 divide-x divide-line md:grid-cols-3 lg:grid-cols-6">
        <Stat label="On shift now" value={onShiftNow} />
        <Stat label="Units" value={view.unitIds.length} />
        <Stat label="Gaps" value={gaps.length} tone={gaps.length > 0 ? 'bad' : 'ok'} />
        <Stat
          label="Conflicts"
          value={conflicts.length}
          tone={conflicts.length > 0 ? 'warn' : 'ok'}
        />
        <Stat label="Gap days" value={gapDays} tone={gapDays > 0 ? 'warn' : 'ok'} />
        <Stat label="People" value={people} />
      </section>

      {attention.length > 0 ? (
        <section className="card shrink-0 overflow-hidden">
          <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <h2 className="text-[13.5px] font-semibold">Attention required</h2>
            <span className="pill pill--bad">{attention.length}</span>
            <span className="ml-auto text-[11.5px] text-faint">
              {gaps.length > 0
                ? 'Gaps block publication; conflicts need a comment'
                : 'Conflicts need a comment before publishing'}
            </span>
          </header>
          <ul className="max-h-[200px] overflow-y-auto">
            {attention.slice(0, 80).map((issue) => (
              <li key={issue.key}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 border-b border-line px-4 py-2 text-left last:border-0 hover:bg-hover"
                  onClick={() => goToIssue(issue)}
                >
                  <span
                    className={`pill ${issue.category === 'GAP' ? 'pill--bad' : 'pill--warn'}`}
                  >
                    {issue.category}
                  </span>
                  {issue.date ? (
                    <span className="shrink-0 font-mono text-[11.5px] text-muted">
                      {parseDate(issue.date).toFormat('ccc d LLL')}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{issue.message}</span>
                  <span className="shrink-0 text-[11px] text-accent">Fix →</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="card flex shrink-0 items-center gap-3 px-4 py-2.5">
          <span className="pill pill--ok">All clear</span>
          <span className="text-[13px] text-muted">
            Every requirement in this period is met and nothing conflicts.
          </span>
        </section>
      )}

      <section className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-[13.5px] font-semibold">Coverage timeline</h2>
          <span className="text-[11.5px] text-muted">
            Absolute time in {zone === 'UTC' ? 'UTC' : zone} — scroll sideways
          </span>
        </header>

        {!timeline || timeline.lanes.length === 0 ? (
          <p className="p-4 text-[13px] text-muted">Nothing scheduled in this period.</p>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* Имена регионов не уезжают при промотке времени. */}
            <div className="w-[170px] shrink-0 border-r border-line">
              <div style={{ height: axisTop }} className="border-b border-line" />
              {timeline.lanes.map((lane) => (
                <UnitHeader key={lane.unitId} lane={lane} />
              ))}
            </div>

            <div ref={fillRef} className="min-w-0 flex-1 overflow-x-auto">
              <div style={{ width }} className="relative">
                <DayHeader timeline={timeline} dates={dates} />
                <MultiZoneAxis axis={timeline.axis} clocks={nowClocks} />
                <NowClocks axis={timeline.axis} now={now} clocks={nowClocks} top={axisTop} />
                {timeline.lanes.map((lane) => (
                  <LaneBody
                    key={lane.unitId}
                    lane={lane}
                    timeline={timeline}
                    zone={zone}
                    now={now}
                    onPickBar={(bar) => void navigate(`/schedule/day/${bar.date}`)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function UnitHeader({ lane }: { readonly lane: DayDetailRangeLane }) {
  const peak = lane.headcountByHour.reduce((max, count) => Math.max(max, count), 0);
  return (
    <div
      className="flex w-full items-center gap-2 border-b border-line px-3 text-left"
      style={{ height: laneHeight(lane) }}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold">{lane.unitName}</span>
        <span className="block text-[10.5px] text-faint">peak {peak} on shift</span>
      </span>
      {lane.gaps > 0 ? <span className="pill pill--bad">{lane.gaps}</span> : null}
    </div>
  );
}

function DayHeader({
  timeline,
  dates,
}: {
  readonly timeline: DayDetailRange;
  readonly dates: readonly IsoDate[];
}) {
  return (
    <div className="relative h-[26px] border-b border-line">
      {timeline.days.map((day) => {
        const dt = parseDate(day.date);
        return (
          <span
            key={day.date}
            className="absolute inset-y-0 flex items-center justify-center border-l border-line text-[10.5px] whitespace-nowrap"
            style={{ left: `${day.left * 100}%`, width: `${day.width * 100}%` }}
            data-today={day.date === TODAY || undefined}
          >
            <span className={day.date === TODAY ? 'font-bold text-accent' : 'text-muted'}>
              {dates.length > 21 ? dt.toFormat('d') : dt.toFormat('ccc d')}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Одна ось на локацию, друг под другом — не единственное общее время, а «сколько
 * там времени в каждом из наших городов прямо на этом участке ленты» (owner
 * review). Подпись локации приклеена к левому краю (`position: sticky`), чтобы
 * не потеряться при промотке — оси сами живут в промативаемом содержимом, ведь
 * это единственное место, где часовые деления совпадают с барами по X.
 */
function MultiZoneAxis({
  axis,
  clocks,
}: {
  readonly axis: UtcInterval;
  readonly clocks: readonly Location[];
}) {
  if (clocks.length === 0) return null;
  return (
    <div className="border-b border-line">
      {clocks.map((location) => (
        <div
          key={location.timeZone}
          className="axis border-b border-line/60 last:border-b-0"
          style={{ height: 22 }}
        >
          <span className="sticky left-0 z-[2] inline-block bg-surface px-1 text-[9.5px] font-semibold text-muted">
            {location.name}
          </span>
          {hourTicks(axis, location.timeZone).map((tick) => (
            <span key={tick.at} className="axis__tick" style={{ left: `${tick.left}%` }}>
              {tick.label}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * "Сейчас" не одно время — оно разное в каждой локации. Один бейдж над лентой,
 * на вертикальной линии `.lane__now`, со временем каждой затронутой локации —
 * так «сколько там времени в Нью-Йорке/Лондоне/Сингапуре прямо сейчас, и что
 * у них с покрытием» читается с одного взгляда, без клика по шапке.
 */
function NowClocks({
  axis,
  now,
  clocks,
  top,
}: {
  readonly axis: UtcInterval;
  readonly now: string;
  readonly clocks: readonly Location[];
  readonly top: number;
}) {
  const inside = now >= axis.start && now <= axis.end;
  if (!inside || clocks.length === 0) return null;
  const left = positionOf(axis, now) * 100;

  return (
    <div className="now-clocks" style={{ left: `${left}%`, top }}>
      {clocks.map((location) => (
        <span key={location.timeZone} className="now-clocks__row">
          <span className="now-clocks__name">{location.name}</span>
          <span className="font-mono">{formatInZone(now, location.timeZone)}</span>
        </span>
      ))}
    </div>
  );
}

function LaneBody({
  lane,
  timeline,
  zone,
  now,
  onPickBar,
}: {
  readonly lane: DayDetailRangeLane;
  readonly timeline: DayDetailRange;
  readonly zone: string;
  readonly now: string;
  readonly onPickBar: (bar: DayDetailRangeBar) => void;
}) {
  const nowInside = now >= timeline.axis.start && now <= timeline.axis.end;
  const nowLeft = positionOf(timeline.axis, now) * 100;
  const handovers = timeline.handovers.filter(
    (h) => h.fromUnitId === lane.unitId || h.toUnitId === lane.unitId,
  );
  const barsHeight = lane.rowCount * ROW_H + 6;

  return (
    <div className="relative border-b border-line" style={{ height: laneHeight(lane) }}>
      {timeline.days.map((day) => (
        <span
          key={day.date}
          className="absolute border-l border-line"
          style={{ left: `${day.left * 100}%`, top: 0, height: barsHeight }}
        />
      ))}

      {handovers.map((h) => (
        <span
          key={`${h.date}-${h.fromUnitId}-${h.toUnitId}`}
          className="lane__handover"
          style={{ ...spanStyle(timeline.axis, h.interval), top: 0, height: barsHeight }}
          title={`Handover ${h.fromUnitId} → ${h.toUnitId}`}
        />
      ))}

      {lane.bars.map((bar) => {
        const geometry = {
          ...spanStyle(timeline.axis, bar.interval),
          top: 3 + bar.row * ROW_H,
          height: ROW_H - 3,
        };
        if (bar.kind === 'gap') {
          return (
            <button
              key={bar.key}
              type="button"
              className="lane__gap"
              style={geometry}
              title={`${bar.date} · ${bar.code} — unfilled`}
              onClick={() => onPickBar(bar)}
            >
              {bar.code} — unfilled
            </button>
          );
        }
        return (
          <button
            key={bar.key}
            type="button"
            className="lane__block"
            style={{ ...geometry, background: bar.color }}
            title={barTitle(bar, zone)}
            onClick={() => onPickBar(bar)}
          >
            <span className="font-mono opacity-90">{bar.code}</span>
            <span className="ml-1.5 truncate font-normal opacity-85">{bar.personName}</span>
          </button>
        );
      })}

      {nowInside ? <span className="lane__now" style={{ left: `${nowLeft}%`, height: barsHeight }} /> : null}

      <HeadcountStrip headcountByHour={lane.headcountByHour} top={barsHeight} />
    </div>
  );
}

/** This unit's own on-shift headcount, hour by hour — the same chart shape as
 * day-drilldown's bottom graph, but per lane instead of one combined figure,
 * so a unit's own load reads on its own row (owner review). */
function HeadcountStrip({
  headcountByHour,
  top,
}: {
  readonly headcountByHour: readonly number[];
  readonly top: number;
}) {
  const peak = Math.max(1, ...headcountByHour);
  const hourWidth = 100 / Math.max(1, headcountByHour.length);
  return (
    <div
      className="absolute right-0 left-0 border-t border-line/60"
      style={{ top, height: HEADCOUNT_H }}
    >
      {headcountByHour.map((count, hour) => (
        <span
          key={hour}
          className="absolute bottom-0 rounded-t-[1px]"
          style={{
            left: `${hour * hourWidth}%`,
            width: `${hourWidth}%`,
            height: `${Math.max(8, (count / peak) * 100)}%`,
            background:
              count === 0 ? 'transparent' : 'color-mix(in srgb, var(--accent) 40%, transparent)',
          }}
          title={`${count} on shift`}
        />
      ))}
    </div>
  );
}

function laneHeight(lane: DayDetailRangeLane): number {
  return lane.rowCount * ROW_H + 6 + HEADCOUNT_H;
}

function spanStyle(axis: UtcInterval, interval: UtcInterval): React.CSSProperties {
  const left = positionOf(axis, interval.start) * 100;
  const right = positionOf(axis, interval.end) * 100;
  return { left: `${left}%`, width: `${Math.max(right - left, 0.05)}%` };
}

function barTitle(bar: DayDetailRangeBar, zone: string): string {
  return [
    bar.personName,
    `${bar.date} · ${bar.code}`,
    `${formatInZone(bar.interval.start, zone)}–${formatInZone(bar.interval.end, zone)} (${zone})`,
  ]
    .filter(Boolean)
    .join('\n');
}

function Stat({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: 'ok' | 'warn' | 'bad';
}) {
  const color =
    tone === 'bad' && value > 0
      ? 'text-bad'
      : tone === 'warn' && value > 0
        ? 'text-warn'
        : tone === 'ok'
          ? 'text-ok'
          : '';
  return (
    <div className="px-4 py-2.5">
      <div className={`text-[24px] leading-none font-semibold tracking-tight ${color}`}>
        {value}
      </div>
      <div className="mt-1 text-[10.5px] font-medium tracking-wide text-faint uppercase">
        {label}
      </div>
    </div>
  );
}
