/**
 * Overview — дашборд и таймлайн одним экраном.
 *
 * Раньше это были две вкладки, и обе отвечали на один вопрос — «закрыты ли
 * мы» — только с разной детализацией. Пользователь читал сводку на одной,
 * потом шёл на другую смотреть, где именно дыра, и заново искал регион и день.
 * Разделение стоило перехода и не давало ничего.
 *
 * Теперь один экран трёх слоёв, сверху вниз по убыванию срочности:
 *
 *   1. цифры за период;
 *   2. что чинить — список, ведущий в конкретную ячейку сетки;
 *   3. **одна непрерывная лента времени**, регионы друг под другом.
 *
 * Регион свёрнут по умолчанию и показывает суточное покрытие полосой; развёрнут —
 * показывает роли на той же оси. Свёрнутый и развёрнутый вид делят геометрию,
 * поэтому «где дыра» читается одинаково в обоих.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Issue, IsoDate, UtcInterval } from '../domain/types.ts';
import { eachDate, formatInZone, parseDate } from '../engine/dates.ts';
import {
  buildDayDetailRange,
  positionOf,
  type DayDetailRange,
  type DayDetailRangeBar,
  type DayDetailRangeLane,
} from '../engine/timeline.ts';
import { useSchedule } from '../store/useSchedule.ts';
import { TODAY, useUi } from '../store/useUi.ts';
import { DateRangeControl } from '../features/shell/DateRangeControl.tsx';
import type { PlanningView } from '../features/planning/usePlanningView.ts';

/**
 * Пикселей на сутки. Одна плотность, не три — промотка по горизонтали и есть
 * промотка времени, а выбор между «сжато/нормально/широко» не отвечал ни на
 * один вопрос планировщика, только добавлял клик.
 */
const DAY_PX = 220;

const ROW_H = 22;

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

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const dates = useMemo(() => eachDate(range), [range]);

  const timeline = useMemo<DayDetailRange | undefined>(() => {
    if (!plan || !index) return undefined;
    return buildDayDetailRange({
      dates,
      regionIds: view.regionIds,
      assignments: plan.assignments,
      coverageCells: view.coverageCells,
      index,
    });
  }, [dates, plan, index, view.regionIds, view.coverageCells]);

  const zone = displayZone === 'role' ? 'UTC' : displayZone;
  const width = dates.length * DAY_PX;

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

  const toggle = (regionId: string) => {
    const next = new Set(expanded);
    if (next.has(regionId)) next.delete(regionId);
    else next.add(regionId);
    setExpanded(next);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <DateRangeControl />

      <section className="card grid shrink-0 grid-cols-2 divide-x divide-line md:grid-cols-3 lg:grid-cols-6">
        <Stat label="On shift now" value={onShiftNow} />
        <Stat label="Regions" value={view.regionIds.length} />
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
              <div className="h-[26px] border-b border-line" />
              {timeline.lanes.map((lane) => (
                <RegionHeader
                  key={lane.regionId}
                  lane={lane}
                  expanded={expanded.has(lane.regionId)}
                  onToggle={() => toggle(lane.regionId)}
                />
              ))}
            </div>

            <div className="min-w-0 flex-1 overflow-x-auto">
              <div style={{ width }}>
                <DayHeader timeline={timeline} dates={dates} />
                {timeline.lanes.map((lane) => (
                  <LaneBody
                    key={lane.regionId}
                    lane={lane}
                    timeline={timeline}
                    zone={zone}
                    now={now}
                    expanded={expanded.has(lane.regionId)}
                    onPickDate={(date) => void navigate(`/schedule/day/${date}`)}
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

function RegionHeader({
  lane,
  expanded,
  onToggle,
}: {
  readonly lane: DayDetailRangeLane;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 border-b border-line px-3 text-left hover:bg-hover"
      style={{ height: laneHeight(lane, expanded) }}
      onClick={onToggle}
      aria-expanded={expanded}
    >
      <span
        aria-hidden
        className="text-[9px] text-faint transition-transform"
        style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
      >
        ▶
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold">{lane.regionName}</span>
        <span className="block text-[10.5px] text-faint">
          {expanded ? `${lane.bars.length} bars` : 'daily coverage'}
        </span>
      </span>
      {lane.gaps > 0 ? <span className="pill pill--bad">{lane.gaps}</span> : null}
    </button>
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

function LaneBody({
  lane,
  timeline,
  zone,
  now,
  expanded,
  onPickDate,
  onPickBar,
}: {
  readonly lane: DayDetailRangeLane;
  readonly timeline: DayDetailRange;
  readonly zone: string;
  readonly now: string;
  readonly expanded: boolean;
  readonly onPickDate: (date: IsoDate) => void;
  readonly onPickBar: (bar: DayDetailRangeBar) => void;
}) {
  const nowInside = now >= timeline.axis.start && now <= timeline.axis.end;
  const nowLeft = positionOf(timeline.axis, now) * 100;
  const handovers = timeline.handovers.filter(
    (h) => h.fromRegionId === lane.regionId || h.toRegionId === lane.regionId,
  );

  return (
    <div
      className="relative border-b border-line"
      style={{ height: laneHeight(lane, expanded) }}
    >
      {timeline.days.map((day) => (
        <span
          key={day.date}
          className="absolute inset-y-0 border-l border-line"
          style={{ left: `${day.left * 100}%` }}
        />
      ))}

      {expanded ? (
        <>
          {handovers.map((h) => (
            <span
              key={`${h.date}-${h.fromRegionId}-${h.toRegionId}`}
              className="lane__handover"
              style={spanStyle(timeline.axis, h.interval)}
              title={`Handover ${h.fromRegionId} → ${h.toRegionId}`}
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
        </>
      ) : (
        // Свёрнутый вид: одна клетка на сутки — «сколько закрыто из скольких».
        timeline.days.map((day, dayIndex) => {
          const cover = lane.daily[dayIndex];
          if (!cover) return null;
          return (
            <button
              key={day.date}
              type="button"
              className="cover-cell"
              data-level={cover.level}
              style={{ left: `${day.left * 100}%`, width: `${day.width * 100}%` }}
              title={`${day.date}\n${cover.filled} assigned against ${cover.required} required`}
              onClick={() => onPickDate(day.date)}
            >
              {cover.filled}/{cover.required}
            </button>
          );
        })
      )}

      {nowInside ? <span className="lane__now" style={{ left: `${nowLeft}%` }} /> : null}
    </div>
  );
}

function laneHeight(lane: DayDetailRangeLane, expanded: boolean): number {
  return expanded ? lane.rowCount * ROW_H + 6 : 30;
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
