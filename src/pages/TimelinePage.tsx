/**
 * Таймлайн: сутки по горизонтали, регион — дорожка.
 *
 * Отвечает на вопрос, которого нет в сетке: **кто на смене прямо сейчас и
 * когда следующая передача.** В таблице этого не увидеть — там нет часов,
 * только даты, и «есть ли у нас люди в 04:00 UTC» приходится считать в уме.
 *
 * Дни периода идут один под другим. Ось общая на все дни, поэтому окна
 * сравнимы взглядом: сдвиг смены или пропавший регион видны как ступенька, а
 * не как разница в двух подписях.
 */

import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import type { UtcInterval } from '../domain/types.ts';
import { eachDate, formatInZone, parseDate } from '../engine/dates.ts';
import { buildTimelineDay, positionOf, type TimelineBlock, type TimelineDay } from '../engine/timeline.ts';
import { useSchedule } from '../store/useSchedule.ts';
import { useUi } from '../store/useUi.ts';
import { DateRangeControl } from '../features/shell/DateRangeControl.tsx';
import type { PlanningView } from '../features/planning/usePlanningView.ts';

/** Больше двух недель дорожек не читаются — дальше это работа тепловой карты. */
const MAX_DAYS = 14;

/** Высота одной подстроки внутри дорожки региона. */
const ROW_H = 22;

interface Props {
  readonly view: PlanningView;
  readonly now: string;
}

export function TimelinePage({ view, now }: Props) {
  const range = useUi((s) => s.range);
  const displayZone = useUi((s) => s.displayZone);
  const plan = useSchedule((s) => s.plan);
  const index = useSchedule((s) => s.index);

  const [detail, setDetail] = useState<TimelineBlock>();

  const days = useMemo<TimelineDay[]>(() => {
    if (!plan || !index) return [];
    return eachDate(range)
      .slice(0, MAX_DAYS)
      .map((date) =>
        buildTimelineDay({
          date,
          regionIds: view.regionIds,
          assignments: plan.assignments,
          coverageCells: view.coverageCells,
          index,
        }),
      );
  }, [range, plan, index, view.regionIds, view.coverageCells]);

  const truncated = eachDate(range).length > MAX_DAYS;
  const zone = displayZone === 'role' ? 'UTC' : displayZone;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <DateRangeControl />

      <section className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight">Coverage timeline</h1>
            <p className="text-[11.5px] text-muted">
              Absolute time, shown in {zone === 'UTC' ? 'UTC' : zone}. Each role carries its own
              window in its own zone.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3 text-[11px] text-faint">
            <LegendItem swatch="var(--accent)">shift block</LegendItem>
            <LegendItem swatch="var(--bad)">unfilled requirement</LegendItem>
            <LegendItem swatch="var(--accent)" hatched>
              handover overlap
            </LegendItem>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          {days.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing scheduled in this period.</p>
          ) : (
            days.map((day) => (
              <DayTimeline
                key={day.date}
                day={day}
                zone={zone}
                now={now}
                onPick={setDetail}
              />
            ))
          )}
          {truncated ? (
            <p className="text-[11.5px] text-faint">
              Showing the first {MAX_DAYS} days of the period. Narrow the range to see the rest.
            </p>
          ) : null}
        </div>
      </section>

      {detail ? <BlockDetail block={detail} zone={zone} onClose={() => setDetail(undefined)} /> : null}
    </div>
  );
}

function LegendItem({
  swatch,
  hatched,
  children,
}: {
  readonly swatch: string;
  readonly hatched?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="h-2.5 w-4 rounded-[3px]"
        style={
          hatched
            ? {
                background: `repeating-linear-gradient(45deg, ${swatch}, ${swatch} 3px, transparent 3px, transparent 6px)`,
                border: `1px solid ${swatch}`,
              }
            : { background: swatch }
        }
      />
      {children}
    </span>
  );
}

function DayTimeline({
  day,
  zone,
  now,
  onPick,
}: {
  readonly day: TimelineDay;
  readonly zone: string;
  readonly now: string;
  readonly onPick: (block: TimelineBlock) => void;
}) {
  const ticks = useMemo(() => hourTicks(day.axis, zone), [day.axis, zone]);
  const nowInside = now >= day.axis.start && now <= day.axis.end;
  const nowLeft = positionOf(day.axis, now) * 100;
  const peak = Math.max(1, ...day.headcountByHour);
  const totalGaps = day.lanes.reduce((sum, lane) => sum + lane.gaps, 0);

  return (
    <article>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h2 className="text-[13px] font-semibold">
          {parseDate(day.date).toFormat('cccc, d LLLL')}
        </h2>
        {totalGaps > 0 ? (
          <span className="pill pill--bad">
            {totalGaps} unfilled {totalGaps === 1 ? 'role' : 'roles'}
          </span>
        ) : (
          <span className="pill pill--ok">covered</span>
        )}
        {nowInside ? <span className="pill pill--accent">now</span> : null}
      </div>

      <div className="grid gap-1.5" style={{ gridTemplateColumns: '84px 1fr' }}>
        {day.lanes.map((lane) => (
          <Fragmentish key={lane.regionId}>
            <div className="flex items-start justify-end pt-1.5 pr-1 text-[11.5px] font-semibold text-muted">
              {lane.regionName}
            </div>
            <div className="lane" style={{ height: lane.rowCount * ROW_H + 6 }}>
              {ticks.map((tick) => (
                <span key={tick.at} className="lane__hour" style={{ left: `${tick.left}%` }} />
              ))}

              {day.handovers
                .filter(
                  (handover) =>
                    handover.fromRegionId === lane.regionId || handover.toRegionId === lane.regionId,
                )
                .map((handover) => (
                  <span
                    key={`${handover.fromRegionId}-${handover.toRegionId}`}
                    className="lane__handover"
                    style={spanStyle(day.axis, handover.interval)}
                    title={`Handover ${handover.fromRegionId} → ${handover.toRegionId}`}
                  />
                ))}

              {lane.blocks.map((block) => {
                const geometry = { ...spanStyle(day.axis, block.interval), ...rowStyle(block.row) };

                // Пустая, но и не требуемая роль — не дыра. Рисовать её красным
                // значило бы кричать о дне, в котором всё в порядке.
                if (block.level === 'GAP') {
                  return (
                    <button
                      key={block.roleId}
                      type="button"
                      className="lane__gap"
                      style={geometry}
                      title={`${block.code} — ${block.filled}/${block.required}, below minimum`}
                      onClick={() => onPick(block)}
                    >
                      {block.code} {block.filled}/{block.required}
                    </button>
                  );
                }
                if (block.empty) return null;

                return (
                  <button
                    key={block.roleId}
                    type="button"
                    className="lane__block"
                    style={{ ...geometry, background: block.color }}
                    title={blockTitle(block, zone)}
                    onClick={() => onPick(block)}
                  >
                    {block.code}
                    <span className="ml-1.5 font-normal opacity-85">
                      {block.filled}/{block.required}
                    </span>
                  </button>
                );
              })}

              {nowInside ? <span className="lane__now" style={{ left: `${nowLeft}%` }} /> : null}
            </div>
          </Fragmentish>
        ))}

        {/* Почасовая численность: одна полоска на час оси. */}
        <div className="flex items-center justify-end pr-1 text-[10.5px] text-faint">On shift</div>
        <div className="flex h-6 items-end gap-px">
          {day.headcountByHour.map((count, hour) => (
            <span
              key={hour}
              className="flex-1 rounded-t-[2px]"
              style={{
                height: `${Math.max(6, (count / peak) * 100)}%`,
                background:
                  count === 0 ? 'var(--bad-soft)' : 'color-mix(in srgb, var(--accent) 45%, transparent)',
              }}
              title={`${count} on shift`}
            />
          ))}
        </div>

        <div />
        <div className="axis">
          {ticks.map((tick) => (
            <span key={tick.at} className="axis__tick" style={{ left: `${tick.left}%` }}>
              {tick.label}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

/** Именованный фрагмент: `<>` не принимает `key` в разметке с двумя детьми. */
function Fragmentish({ children }: { readonly children: React.ReactNode }) {
  return <>{children}</>;
}

function spanStyle(axis: UtcInterval, interval: UtcInterval): React.CSSProperties {
  const left = positionOf(axis, interval.start) * 100;
  const right = positionOf(axis, interval.end) * 100;
  return { left: `${left}%`, width: `${Math.max(right - left, 0.4)}%` };
}

/** Вертикальная позиция блока внутри дорожки. */
function rowStyle(row: number): React.CSSProperties {
  return { top: 3 + row * ROW_H, height: ROW_H - 3, bottom: 'auto' };
}

function hourTicks(axis: UtcInterval, zone: string): { at: string; left: number; label: string }[] {
  const start = DateTime.fromISO(axis.start, { zone: 'utc' });
  const end = DateTime.fromISO(axis.end, { zone: 'utc' });
  const hours = Math.round(end.diff(start, 'hours').hours);
  // На сутках это каждые три часа; на растянутой оси — реже, чтобы подписи
  // не наезжали друг на друга.
  const step = hours <= 24 ? 3 : 6;

  const ticks: { at: string; left: number; label: string }[] = [];
  for (let hour = 0; hour <= hours; hour += step) {
    const at = start.plus({ hours: hour });
    const iso = at.toISO();
    if (!iso) continue;
    ticks.push({
      at: iso,
      left: positionOf(axis, iso) * 100,
      label: formatInZone(iso, zone, 'HH:mm'),
    });
  }
  return ticks;
}

function blockTitle(block: TimelineBlock, zone: string): string {
  return [
    `${block.code} — ${block.label}`,
    `${formatInZone(block.interval.start, zone)}–${formatInZone(block.interval.end, zone)} (${zone})`,
    `${block.filled} of ${block.required} required`,
    block.people.map((person) => person.name).join(', '),
  ].join('\n');
}

function BlockDetail({
  block,
  zone,
  onClose,
}: {
  readonly block: TimelineBlock;
  readonly zone: string;
  readonly onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70]" onClick={onClose}>
      <div className="absolute inset-0 bg-[rgb(16_24_40/0.35)]" />
      <div
        className="card absolute right-4 bottom-4 w-[320px] p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          <span
            aria-hidden
            className="mt-0.5 h-4 w-4 shrink-0 rounded"
            style={{ background: block.color }}
          />
          <div className="min-w-0">
            <h3 className="font-mono text-[14px] font-bold">{block.code}</h3>
            <p className="text-[12px] text-muted">{block.label}</p>
          </div>
          <button type="button" className="btn btn--sm btn--ghost ml-auto" onClick={onClose}>
            ✕
          </button>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          <div>
            <dt className="text-faint">Window ({zone})</dt>
            <dd className="font-mono">
              {formatInZone(block.interval.start, zone)}–{formatInZone(block.interval.end, zone)}
            </dd>
          </div>
          <div>
            <dt className="text-faint">Filled</dt>
            <dd className={block.level === 'GAP' ? 'font-semibold text-bad' : 'font-semibold'}>
              {block.filled} / {block.required}
            </dd>
          </div>
        </dl>

        <div className="mt-3">
          <div className="menu-label px-0">On this role</div>
          <ul className="space-y-1">
            {block.people.map((person) => (
              <li key={person.id} className="text-[12.5px]">
                {person.name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
