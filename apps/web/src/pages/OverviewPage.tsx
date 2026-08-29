/**
 * NOTE: Overview — dashboard and timeline in one screen.
 *
 * Answers one question: who is on shift now and in the coming days, and are
 * there any gaps. Opens centered on "now" and stays there until the planner
 * scrolls it themselves — three fixed zooms (1/3/7 days across the full
 * measured width) and continuous horizontal panning instead of an arbitrary
 * range (ADR-0036, owner review).
 *
 * One screen, three layers, top to bottom in decreasing order of urgency:
 *
 *   1. period + a compact row of numbers;
 *   2. **one continuous timeline**, planning units stacked on top of each
 *      other. The hour axis gets one row per affected location (owner
 *      review: time differs in each city, and that must be visible at a
 *      glance, without clicking the header); the on-shift scale, by
 *      contrast, is one shared scale across all units at once;
 *   3. nothing below that: the page doesn't scroll vertically, the timeline
 *      eats all the remaining height.
 *
 * The timeline is always expanded — per-person bars, as in day-drilldown,
 * rather than a per-day "filled/required" cell: the owner preferred reading
 * "who exactly" at a glance, without clicking in.
 */

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Issue, Location, UtcInterval } from '../domain/types.ts';
import { eachDate, formatInZone, parseDate } from '../engine/dates.ts';
import { isCoverageGap } from '../engine/issues.ts';
import { dedupeLocationsByZone } from '../engine/locationClocks.ts';
import {
  buildDayDetailRange,
  hourTicks,
  nightBands,
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
/** NOTE: "filled/required" row above each unit's timeline. */
const COVERAGE_ROW_H = 16;
/** NOTE: Height of the day header plus one row of the hour axis. */
const DAY_HEADER_H = 26;
const ZONE_ROW_H = 22;
/** NOTE: Floor for the window width on the first frame, before ResizeObserver reports in. */
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

  // NOTE: Same trick as on Schedule — the period is set before paint,
  // otherwise the first frame arrives with the wrong (month) period.
  useLayoutEffect(() => enterOverview(), [enterOverview]);

  // One list open at a time, and it lives on the page rather than inside a tile: it is
  // read against the timeline below it.
  const [openList, setOpenList] = useState<'gaps' | 'conflicts' | undefined>(undefined);
  const [scrollNode, setScrollNode] = useState<HTMLDivElement | null>(null);
  const [fillRef, fillWidth] = useElementWidth<HTMLDivElement>();
  const mergedRef = (node: HTMLDivElement | null) => {
    fillRef(node);
    setScrollNode(node);
  };

  const dates = useMemo(() => eachDate(range), [range]);

  // NOTE: Every location behind the units shown on screen — "now" reads the
  // same regardless of which unit's coverage is currently being viewed, not
  // just the one globally selected in the header.
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
  // NOTE: The visible window is exactly `span` days across the full measured
  // width; the window around it (`overviewRange`) adds the same amount of
  // context on each edge for continuous panning, without stretching the
  // per-day width.
  const dayPx = Math.max(MIN_WINDOW_PX, fillWidth) / overviewSpan;
  const width = dates.length * dayPx;
  const axisTop = DAY_HEADER_H + nowClocks.length * ZONE_ROW_H;

  // NOTE: Center on "now" when it falls inside the window, otherwise on the
  // anchor's midday — mount, a period change, and an explicit "Today" all
  // re-decide this; the clock tick (once a minute) deliberately does not
  // trigger it, otherwise the timeline would crawl out from under the cursor.
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

  /** NOTE: a gap points only to a day — it has no person, that's the point. */
  const goToIssue = (issue: Issue) => {
    if (!issue.date) return;
    setOpenList(undefined);
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
        <IssueStat
          label="Gaps"
          issues={gaps}
          tone="bad"
          open={openList === 'gaps'}
          onToggle={() => setOpenList(openList === 'gaps' ? undefined : 'gaps')}
        />
        <IssueStat
          label="Conflicts"
          issues={conflicts}
          tone="warn"
          open={openList === 'conflicts'}
          onToggle={() => setOpenList(openList === 'conflicts' ? undefined : 'conflicts')}
        />
      </section>

      {openList ? (
        <IssueList
          issues={openList === 'gaps' ? gaps : conflicts}
          onPick={goToIssue}
          onClose={() => setOpenList(undefined)}
        />
      ) : null}

      <section className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-[13.5px] font-semibold">Coverage timeline</h2>
        </header>

        {!timeline || timeline.lanes.length === 0 ? (
          <p className="p-4 text-[13px] text-muted">Nothing scheduled in this period.</p>
        ) : (
          /* WHY: one vertical scroller for the gutter and the lane together —
             separate overflow-y on two adjacent blocks drifts out of sync while
             scrolling. Only the lane itself scrolls horizontally, not the names. */
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
 * NOTE: one axis per location, stacked — time differs across our cities, and
 * that must be visible at a glance, without clicking the header (owner review).
 * The location label was moved into the left gutter (owner review — it used to
 * float over the ticks in the scrollable part, which looked misaligned); only
 * the hour ticks remain here, aligned to the same rows.
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
          {/* Night, in this location. It falls at a different offset in every timezone —
              which is the whole reason these axes are stacked — so it is computed, not a
              repeating gradient. Behind the ticks and inert. */}
          {nightBands(axis, location.timeZone).map((band) => (
            <span
              key={band.left}
              className="axis__night"
              style={{ left: `${band.left}%`, width: `${band.width}%` }}
              aria-hidden
            />
          ))}
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
 * NOTE: "now" is a different time in each location. One badge above the lane,
 * on the `.lane__now` vertical line, showing the time for each affected location.
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
            // backgroundColor, not background: the shorthand would wipe the gradient
            // `.lane__block` paints over the shift's own colour.
            style={{ ...geometry, backgroundColor: bar.color }}
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
 * NOTE: per-day "filled/required" summary above the lane — brought back after
 * owner review: gaps/overfills must read as a number per unit at a glance, not
 * only via the color of the bars below. Same color grammar as `CoverageStrip`
 * on Schedule (`--ok`/`--warn`/`--bad`).
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

/** NOTE: one shared on-shift scale under all lanes, not one per unit — a lane
 * peaking at 2 and a lane peaking at 20 would otherwise render indistinguishably
 * (owner review). */
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

/** NOTE: Gaps/Conflicts used to be a separate "Attention required" block that
 * took up a full vertical strip; now a chip in the header with a popover list
 * (owner review: the page must not scroll vertically). */
/**
 * A count with a way in.
 *
 * WHY the list is not here: it used to be a popover hung off the number, so the only
 * clue that eighteen gaps could be *read* was that the figure happened to be clickable.
 * Nothing said so, and nobody finds an affordance they have no reason to look for. The
 * tile now carries a named control, and the list opens as a panel below the row where
 * there is room to read it.
 */
function IssueStat({
  label,
  issues,
  tone,
  open,
  onToggle,
}: {
  readonly label: string;
  readonly issues: readonly Issue[];
  readonly tone: 'bad' | 'warn';
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  if (issues.length === 0) {
    return (
      <div className="px-4 py-2.5">
        <div className="text-[20px] leading-none font-semibold tracking-tight text-ok">0</div>
        <div className="mt-1 text-[10px] font-medium tracking-wide text-faint uppercase">{label}</div>
      </div>
    );
  }

  return (
    <div className="px-4 py-2.5">
      <div className={`text-[20px] leading-none font-semibold tracking-tight ${tone === 'bad' ? 'text-bad' : 'text-warn'}`}>
        {issues.length}
      </div>
      <button
        type="button"
        className="stat-toggle mt-1"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="text-[10px] font-medium tracking-wide uppercase">{label}</span>
        <span aria-hidden className="stat-toggle__chevron" data-open={open || undefined}>
          &rsaquo;
        </span>
      </button>
    </div>
  );
}

/**
 * The list itself, between the counts and the timeline: the two things it sits between
 * are what it explains.
 */
function IssueList({
  issues,
  onPick,
  onClose,
}: {
  readonly issues: readonly Issue[];
  readonly onPick: (issue: Issue) => void;
  readonly onClose: () => void;
}) {
  return (
    <section className="card shrink-0 overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[12.5px] font-semibold">
          {issues.length} to look at
        </h2>
        <button type="button" className="btn btn--sm btn--ghost ml-auto" onClick={onClose}>
          Hide
        </button>
      </header>
      <div className="max-h-[220px] overflow-y-auto p-1">
        {issues.slice(0, 80).map((issue) => (
          <button
            key={issue.key}
            type="button"
            className="menu-item items-start"
            onClick={() => onPick(issue)}
          >
            {issue.date ? (
              <span className="shrink-0 font-mono text-[11px] text-muted">
                {parseDate(issue.date).toFormat('ccc d LLL')}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-[12px]">{issue.message}</span>
            <span className="shrink-0 text-[10.5px] text-accent">Fix &rarr;</span>
          </button>
        ))}
      </div>
    </section>
  );
}
