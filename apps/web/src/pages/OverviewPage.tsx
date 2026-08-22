/**
 * Overview — дашборд и таймлайн одним экраном.
 *
 * Отвечает на один вопрос: кто на смене сейчас и в ближайшие дни, и есть ли
 * дыры. Открывается отцентрованным на «сейчас» и остаётся там до тех пор,
 * пока планировщик сам не проскроллит — три фиксированных зума (1/3/7 суток
 * на всю измеренную ширину) и непрерывная горизонтальная промотка вместо
 * произвольного диапазона (ADR-0036, owner review).
 *
 * Один экран трёх слоёв, сверху вниз по убыванию срочности:
 *
 *   1. период + компактная строка цифр;
 *   2. **одна непрерывная лента времени**, единицы планирования друг под другом.
 *      Часовая ось — по строке на каждую затронутую локацию (owner review: время
 *      разное в каждом городе, и это должно быть видно сразу, без клика по
 *      шапке); шкала on-shift, наоборот, одна общая на все юниты сразу;
 *   3. ничего ниже: страница не скроллится вертикально, лента доедает всю
 *      оставшуюся высоту.
 *
 * Лента всегда развёрнута — полосы по людям, как в day-drilldown, а не суточная
 * клетка «занято/нужно»: владелец предпочёл читать «кем именно» с одного взгляда,
 * без клика внутрь.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Issue, Location, UtcInterval } from '../domain/types.ts';
import { eachDate, formatInZone, parseDate } from '../engine/dates.ts';
import { isCoverageGap } from '../engine/issues.ts';
import { dedupeLocationsByZone } from '../engine/locationClocks.ts';
import {
  buildDayDetailRange,
  hourTicks,
  positionOf,
  type DayCoverage,
  type DayDetailRange,
  type DayDetailRangeBar,
  type DayDetailRangeLane,
  type RangeDay,
} from '../engine/timeline.ts';
import { useSchedule } from '../store/useSchedule.ts';
import { TODAY, useUi } from '../store/useUi.ts';
import { useElementWidth } from '../ui/useElementWidth.ts';
import { OverviewPeriodControl } from '../features/shell/OverviewPeriodControl.tsx';
import type { PlanningView } from '../features/planning/usePlanningView.ts';

const ROW_H = 22;
const HEADCOUNT_H = 24;
/** Строка «filled/required» над лентой каждого юнита. */
const COVERAGE_ROW_H = 16;
/** Высота дня-заголовка + одной строки часовой оси. */
const DAY_HEADER_H = 26;
const ZONE_ROW_H = 22;
/** Пол ширины окна на первый кадр, пока ResizeObserver ещё не отчитался. */
const MIN_WINDOW_PX = 320;

interface Props {
  readonly view: PlanningView;
  readonly now: string;
}

export function OverviewPage({ view, now }: Props) {
  const navigate = useNavigate();
  const range = useUi((s) => s.range);
  const overviewAnchor = useUi((s) => s.overview.anchor);
  const overviewSpan = useUi((s) => s.overview.span);
  const displayZone = useUi((s) => s.displayZone);
  const select = useUi((s) => s.select);
  const focusDate = useUi((s) => s.focusDate);
  const setScheduleAnchor = useUi((s) => s.setScheduleAnchor);
  const enterOverview = useUi((s) => s.enterOverview);
  const plan = useSchedule((s) => s.plan);
  const index = useSchedule((s) => s.index);
  const reference = useSchedule((s) => s.reference);

  // Тот же приём, что на Schedule: период ставится до отрисовки, иначе первый
  // кадр приходит с чужим (месячным) периодом.
  useLayoutEffect(() => enterOverview(), [enterOverview]);

  const [scrollNode, setScrollNode] = useState<HTMLDivElement | null>(null);
  const [fillRef, fillWidth] = useElementWidth<HTMLDivElement>();
  const mergedRef = (node: HTMLDivElement | null) => {
    fillRef(node);
    setScrollNode(node);
  };

  const dates = useMemo(() => eachDate(range), [range]);

  // Каждая локация за юнитами, показанными на экране, — «сейчас» читается
  // одинаково независимо от того, покрытие какого юнита сейчас смотрят, а не
  // только глобально выбранного в шапке.
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
  // Видимое окно — ровно `span` суток на всю измеренную ширину; окно вокруг
  // него (`overviewRange`) добавляет столько же контекста по краям для
  // непрерывной промотки, не растягивая суточную ширину.
  const dayPx = Math.max(MIN_WINDOW_PX, fillWidth) / overviewSpan;
  const width = dates.length * dayPx;
  const axisTop = DAY_HEADER_H + nowClocks.length * ZONE_ROW_H;

  // Центрируем на «сейчас», когда оно попадает в окно, иначе на полдень
  // якоря — маунт, смена периода и явный «Today» решают заново; тик часов
  // (раз в минуту) намеренно не триггерит это, иначе лента уползала бы
  // из-под курсора.
  useEffect(() => {
    if (!scrollNode || !timeline || width === 0) return;
    const nowInside = now >= timeline.axis.start && now <= timeline.axis.end;
    const target = nowInside ? now : `${overviewAnchor}T12:00:00.000Z`;
    const left = positionOf(timeline.axis, target) * width;
    scrollNode.scrollLeft = Math.max(0, left - fillWidth / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollNode, timeline, width, overviewAnchor]);

  const gaps = view.issues.filter(isCoverageGap);
  const conflicts = view.issues.filter((issue) => issue.category === 'CONFLICT');

  const onShiftNow =
    timeline?.lanes.reduce(
      (sum, lane) =>
        sum +
        lane.bars.filter(
          (bar) => bar.kind === 'assigned' && bar.interval.start <= now && now < bar.interval.end,
        ).length,
      0,
    ) ?? 0;

  const people = view.rows.filter((row) => row.kind === 'person').length;

  /** Дыра указывает только на день — у неё нет человека, в этом её суть. */
  const goToIssue = (issue: Issue) => {
    if (!issue.date) return;
    setScheduleAnchor(issue.date);
    if (issue.personId) select({ personId: issue.personId, date: issue.date });
    focusDate(issue.date, issue.personId);
    void navigate('/schedule');
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-4">
      <OverviewPeriodControl />

      <section className="card grid shrink-0 grid-cols-2 divide-x divide-line sm:grid-cols-4">
        <Stat label="On shift now" value={onShiftNow} />
        <Stat label="People" value={people} />
        <IssueStat label="Gaps" issues={gaps} tone="bad" onPick={goToIssue} />
        <IssueStat label="Conflicts" issues={conflicts} tone="warn" onPick={goToIssue} />
      </section>

      <section className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-[13.5px] font-semibold">Coverage timeline</h2>
        </header>

        {!timeline || timeline.lanes.length === 0 ? (
          <p className="p-4 text-[13px] text-muted">Nothing scheduled in this period.</p>
        ) : (
          /* Один вертикальный скроллер на гуттер и ленту вместе — раздельные
             overflow-y на двух соседних блоках расходятся при прокрутке.
             Горизонтально скроллится только сама лента, не имена. */
          <div className="flex min-h-0 flex-1 overflow-y-auto">
            <div className="w-[170px] shrink-0 border-r border-line">
              <div style={{ height: DAY_HEADER_H }} className="border-b border-line" />
              {nowClocks.map((location) => (
                <div
                  key={location.timeZone}
                  className="flex items-center border-b border-line/60 px-1 text-[9.5px] font-semibold text-muted"
                  style={{ height: ZONE_ROW_H }}
                >
                  {location.name}
                </div>
              ))}
              {timeline.lanes.map((lane) => (
                <UnitHeader key={lane.unitId} lane={lane} />
              ))}
              <HeadcountLabel />
            </div>

            <div ref={mergedRef} className="min-w-0 flex-1 overflow-x-auto">
              <div style={{ width }} className="relative">
                <DayHeader timeline={timeline} />
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
                <HeadcountStrip headcountByHour={timeline.headcountByHour} />
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function UnitHeader({ lane }: { readonly lane: DayDetailRangeLane }) {
  return (
    <div
      className="flex w-full items-center gap-2 border-b border-line px-3 text-left"
      style={{ height: laneHeight(lane) }}
    >
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{lane.unitName}</span>
      {lane.gaps > 0 ? <span className="pill pill--bad">{lane.gaps}</span> : null}
    </div>
  );
}

function HeadcountLabel() {
  return (
    <div
      className="flex items-center border-t border-line/60 px-3 text-[10.5px] font-medium text-faint"
      style={{ height: HEADCOUNT_H }}
    >
      On shift
    </div>
  );
}

function DayHeader({ timeline }: { readonly timeline: DayDetailRange }) {
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
              {dt.toFormat('ccc d LLL')}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Одна ось на локацию, друг под другом — время разное в каждом из наших
 * городов, и это должно быть видно сразу, без клика по шапке (owner review).
 * Подпись локации сдвинута в левый гуттер (owner review — раньше висела
 * поверх делений в промативаемой части, что выглядело сбито); здесь только
 * часовые деления, выровненные по тем же строкам.
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
          style={{ height: ZONE_ROW_H }}
        >
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
 * "Сейчас" — разное время в каждой локации. Один бейдж над лентой, на
 * вертикальной линии `.lane__now`, со временем каждой затронутой локации.
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
  const barsTop = COVERAGE_ROW_H;

  return (
    <div className="relative border-b border-line" style={{ height: laneHeight(lane) }}>
      <DailyCoverageRow days={timeline.days} daily={lane.daily} />

      {timeline.days.map((day) => (
        <span
          key={day.date}
          className="absolute border-l border-line"
          style={{ left: `${day.left * 100}%`, top: 0, height: laneHeight(lane) }}
        />
      ))}

      {handovers.map((h) => (
        <span
          key={`${h.date}-${h.fromUnitId}-${h.toUnitId}`}
          className="lane__handover"
          style={{ ...spanStyle(timeline.axis, h.interval), top: barsTop, height: barsHeight }}
          title={`Handover ${h.fromUnitId} → ${h.toUnitId}`}
        />
      ))}

      {lane.bars.map((bar) => {
        const geometry = {
          ...spanStyle(timeline.axis, bar.interval),
          top: barsTop + 3 + bar.row * ROW_H,
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

      {nowInside ? (
        <span className="lane__now" style={{ left: `${nowLeft}%`, top: 0, height: laneHeight(lane) }} />
      ) : null}
    </div>
  );
}

/**
 * Сводка «filled/required» по дню над лентой — вернули после owner review:
 * дыры/переполнения должны читаться числом на юнит с одного взгляда, не
 * только цветом полос ниже. Та же цветовая грамматика, что у `CoverageStrip`
 * на Schedule (`--ok`/`--warn`/`--bad`).
 */
function DailyCoverageRow({
  days,
  daily,
}: {
  readonly days: readonly RangeDay[];
  readonly daily: readonly DayCoverage[];
}) {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  return (
    <div className="absolute inset-x-0 top-0 border-b border-line/60" style={{ height: COVERAGE_ROW_H }}>
      {days.map((day) => {
        const cov = byDate.get(day.date);
        if (!cov) return null;
        return (
          <div
            key={day.date}
            className="absolute inset-y-0 flex items-center justify-center overflow-hidden border-l border-line/50 font-mono text-[9.5px] font-semibold first:border-l-0"
            style={{
              left: `${day.left * 100}%`,
              width: `${day.width * 100}%`,
              ...coverageRowStyle(cov.level),
            }}
            title={`${day.date}: ${cov.filled} of ${cov.required} required`}
          >
            {cov.filled}/{cov.required}
          </div>
        );
      })}
    </div>
  );
}

function coverageRowStyle(level: DayCoverage['level']): React.CSSProperties {
  switch (level) {
    case 'GAP':
      return { background: 'var(--bad-soft)', color: 'var(--bad)' };
    case 'THIN':
      return { background: 'var(--warn-soft)', color: 'var(--warn)' };
    case 'OVER':
      return { color: 'var(--accent)' };
    default:
      return { color: 'var(--ok)' };
  }
}

/** Одна общая шкала on-shift под всеми лентами, а не одна на юнит — лейн с
 * пиком 2 и лейн с пиком 20 иначе рисовались бы неотличимо (owner review). */
function HeadcountStrip({ headcountByHour }: { readonly headcountByHour: readonly number[] }) {
  const peak = Math.max(1, ...headcountByHour);
  const hourWidth = 100 / Math.max(1, headcountByHour.length);
  return (
    <div className="relative border-t border-line/60" style={{ height: HEADCOUNT_H }}>
      <span className="absolute top-0.5 left-1 text-[9.5px] text-faint">peak {peak}</span>
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
  return COVERAGE_ROW_H + lane.rowCount * ROW_H + 6;
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

function Stat({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="px-4 py-2.5">
      <div className="text-[20px] leading-none font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-[10px] font-medium tracking-wide text-faint uppercase">{label}</div>
    </div>
  );
}

/** Gaps/Conflicts — было отдельным блоком "Attention required", занимавшим
 * вертикальную полосу целиком; теперь чип в шапке со всплывающим списком
 * (owner review: страница не должна скроллиться вертикально). */
function IssueStat({
  label,
  issues,
  tone,
  onPick,
}: {
  readonly label: string;
  readonly issues: readonly Issue[];
  readonly tone: 'bad' | 'warn';
  readonly onPick: (issue: Issue) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  if (issues.length === 0) {
    return (
      <div className="px-4 py-2.5">
        <div className="text-[20px] leading-none font-semibold tracking-tight text-ok">0</div>
        <div className="mt-1 text-[10px] font-medium tracking-wide text-faint uppercase">{label}</div>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative px-4 py-2.5">
      <button
        type="button"
        className={`text-[20px] leading-none font-semibold tracking-tight ${tone === 'bad' ? 'text-bad' : 'text-warn'}`}
        onClick={() => setOpen(!open)}
      >
        {issues.length}
      </button>
      <div className="mt-1 text-[10px] font-medium tracking-wide text-faint uppercase">{label}</div>

      {open ? (
        <div className="popover absolute top-full left-4 z-10 mt-1.5 max-h-[280px] w-[340px] overflow-y-auto">
          {issues.slice(0, 80).map((issue) => (
            <button
              key={issue.key}
              type="button"
              className="menu-item items-start"
              onClick={() => {
                setOpen(false);
                onPick(issue);
              }}
            >
              {issue.date ? (
                <span className="shrink-0 font-mono text-[11px] text-muted">
                  {parseDate(issue.date).toFormat('ccc d LLL')}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-[12px]">{issue.message}</span>
              <span className="shrink-0 text-[10.5px] text-accent">Fix →</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
