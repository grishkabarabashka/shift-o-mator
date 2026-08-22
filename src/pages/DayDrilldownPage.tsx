/**
 * Day drill-down: один день, час за часом, каждый назначенный человек — своя
 * полоса.
 *
 * Overview отвечает «закрыта ли роль» и сворачивает всех исполнителей в
 * счётчик. Этот экран — детализация одного дня: закрыта чем именно, кем. Та
 * же визуальная грамматика — ось, дорожки по регионам, пунктирные дыры,
 * полосы передачи смены, маркер NOW, — но без агрегации.
 *
 * Вход — по заголовку колонки в сетке или из строки «Attention required» на
 * Overview. Сам экран не редактирует: правка остаётся в сетке, единственном
 * месте, где стоит логика пикера, — здесь только переход туда с уже выбранным
 * днём.
 */

import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { UtcInterval } from '../domain/types.ts';
import { formatInZone, parseDate } from '../engine/dates.ts';
import { buildDayDetail, hourTicks, positionOf, type DayDetailBar } from '../engine/timeline.ts';
import { useSchedule } from '../store/useSchedule.ts';
import { useUi } from '../store/useUi.ts';
import type { PlanningView } from '../features/planning/usePlanningView.ts';

const ROW_H = 24;

interface Props {
  readonly view: PlanningView;
  readonly now: string;
}

export function DayDrilldownPage({ view, now }: Props) {
  const { date } = useParams<{ date: string }>();
  const navigate = useNavigate();
  const displayZone = useUi((s) => s.displayZone);
  const setZoom = useUi((s) => s.setZoom);
  const setAnchor = useUi((s) => s.setAnchor);
  const select = useUi((s) => s.select);
  const plan = useSchedule((s) => s.plan);
  const index = useSchedule((s) => s.index);

  const detail = useMemo(() => {
    if (!date || !plan || !index) return undefined;
    return buildDayDetail({
      date,
      regionIds: view.regionIds,
      assignments: plan.assignments,
      coverageCells: view.coverageCells,
      index,
    });
  }, [date, plan, index, view.regionIds, view.coverageCells]);

  const zone = displayZone === 'role' ? 'UTC' : displayZone;

  if (!date) return null;

  const editInSchedule = () => {
    setZoom('day');
    setAnchor(date);
    void navigate('/schedule');
  };

  const editBar = (bar: DayDetailBar) => {
    setZoom('day');
    setAnchor(date);
    if (bar.personId) select({ personId: bar.personId, date });
    void navigate('/schedule');
  };

  const totalGaps = detail?.lanes.reduce((sum, lane) => sum + lane.gaps, 0) ?? 0;
  const peak = Math.max(1, ...(detail?.headcountByHour ?? [1]));
  const nowInside = detail && now >= detail.axis.start && now <= detail.axis.end;
  const nowLeft = detail ? positionOf(detail.axis, now) * 100 : 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center gap-2 text-[12px] text-faint">
        <Link to="/overview" className="hover:text-accent hover:underline">
          Overview
        </Link>
        <span aria-hidden>/</span>
        <span className="text-ink">{parseDate(date).toFormat('d LLLL yyyy')}</span>
      </div>

      <section className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div>
            <h1 className="text-[18px] font-semibold tracking-tight">
              {parseDate(date).toFormat('cccc, d LLLL yyyy')}
            </h1>
            <p className="text-[11.5px] text-muted">
              Every assignment as its own bar, in {zone === 'UTC' ? 'UTC' : zone}.
            </p>
          </div>

          {totalGaps > 0 ? (
            <span className="pill pill--bad">
              {totalGaps} unfilled {totalGaps === 1 ? 'role' : 'roles'}
            </span>
          ) : (
            <span className="pill pill--ok">covered</span>
          )}
          {nowInside ? <span className="pill pill--accent">now</span> : null}

          <button type="button" className="btn btn--sm btn--primary ml-auto" onClick={editInSchedule}>
            Edit in Schedule →
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!detail || detail.lanes.length === 0 ? (
            <p className="text-[13px] text-muted">No configuration applies to this day.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-1.5" style={{ gridTemplateColumns: '96px 1fr' }}>
                {detail.lanes.map((lane) => (
                  <LaneRow
                    key={lane.regionId}
                    lane={lane}
                    axis={detail.axis}
                    zone={zone}
                    nowInside={!!nowInside}
                    nowLeft={nowLeft}
                    handovers={detail.handovers}
                    onEditBar={editBar}
                  />
                ))}

                <div className="flex items-center justify-end pr-1 text-[10.5px] text-faint">
                  On shift
                </div>
                <div className="flex h-6 items-end gap-px">
                  {detail.headcountByHour.map((count, hour) => (
                    <span
                      key={hour}
                      className="flex-1 rounded-t-[2px]"
                      style={{
                        height: `${Math.max(6, (count / peak) * 100)}%`,
                        background:
                          count === 0
                            ? 'var(--bad-soft)'
                            : 'color-mix(in srgb, var(--accent) 45%, transparent)',
                      }}
                      title={`${count} on shift`}
                    />
                  ))}
                </div>

                <div />
                <Ticks axis={detail.axis} zone={zone} />
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function LaneRow({
  lane,
  axis,
  zone,
  nowInside,
  nowLeft,
  handovers,
  onEditBar,
}: {
  readonly lane: ReturnType<typeof buildDayDetail>['lanes'][number];
  readonly axis: UtcInterval;
  readonly zone: string;
  readonly nowInside: boolean;
  readonly nowLeft: number;
  readonly handovers: ReturnType<typeof buildDayDetail>['handovers'];
  readonly onEditBar: (bar: DayDetailBar) => void;
}) {
  return (
    <>
      <div className="flex items-start justify-end pt-1.5 pr-1 text-[11.5px] font-semibold text-muted">
        {lane.regionName}
      </div>
      <div className="lane" style={{ height: lane.rowCount * ROW_H + 6 }}>
        {handovers
          .filter((h) => h.fromRegionId === lane.regionId || h.toRegionId === lane.regionId)
          .map((h) => (
            <span
              key={`${h.fromRegionId}-${h.toRegionId}`}
              className="lane__handover"
              style={spanStyle(axis, h.interval)}
              title={`Handover ${h.fromRegionId} → ${h.toRegionId}`}
            />
          ))}

        {lane.bars.map((bar) => {
          const geometry = { ...spanStyle(axis, bar.interval), ...rowStyle(bar.row) };
          if (bar.kind === 'gap') {
            return (
              <button
                key={bar.key}
                type="button"
                className="lane__gap"
                style={geometry}
                title={`${bar.code} — unfilled`}
                onClick={() => onEditBar(bar)}
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
              onClick={() => onEditBar(bar)}
            >
              <span className="font-mono opacity-90">{bar.code}</span>
              <span className="ml-1.5 truncate">{bar.personName}</span>
            </button>
          );
        })}

        {nowInside ? <span className="lane__now" style={{ left: `${nowLeft}%` }} /> : null}
      </div>
    </>
  );
}

function Ticks({ axis, zone }: { readonly axis: UtcInterval; readonly zone: string }) {
  const ticks = hourTicks(axis, zone);
  return (
    <div className="axis">
      {ticks.map((tick) => (
        <span key={tick.at} className="axis__tick" style={{ left: `${tick.left}%` }}>
          {tick.label}
        </span>
      ))}
    </div>
  );
}

function spanStyle(axis: UtcInterval, interval: UtcInterval): React.CSSProperties {
  const left = positionOf(axis, interval.start) * 100;
  const right = positionOf(axis, interval.end) * 100;
  return { left: `${left}%`, width: `${Math.max(right - left, 0.4)}%` };
}

function rowStyle(row: number): React.CSSProperties {
  return { top: 3 + row * ROW_H, height: ROW_H - 3, bottom: 'auto' };
}

function barTitle(bar: DayDetailBar, zone: string): string {
  return [
    bar.personName,
    `${bar.code} — ${formatInZone(bar.interval.start, zone)}–${formatInZone(bar.interval.end, zone)} (${zone})`,
  ].join('\n');
}
