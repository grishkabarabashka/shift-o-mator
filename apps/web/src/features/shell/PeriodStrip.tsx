/**
 * Полоса дней и шкала года — общие для Schedule (`DateRangeControl`) и
 * Overview (`OverviewPeriodControl`).
 *
 * Обе читают одно и то же: `range` — что подсветить как «текущее» (и вокруг
 * чего добавить контекст на полосе дней), `onPick` — куда переносит клик по
 * дате. Что значит «перенос» — своё у каждого экрана (Schedule выравнивает
 * на месяц, Overview просто переставляет якорь и центрируется), но сами эти
 * два виджета об этом не знают.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DateRange, IsoDate } from '../../domain/types.ts';
import { parseDate } from '../../engine/dates.ts';
import { dateAtFraction, formatRange, fractionOf, monthTicks, rangeLength, scrubberTrack } from '../../engine/period.ts';
import { TODAY } from '../../store/useUi.ts';

/** Минимальная ширина чипа плюс зазор между ними — из `.day-chip` в theme.css. */
const MIN_CHIP_W = 30;
const CHIP_GAP = 3;

/** Сколько чипов минимальной ширины помещается в измеренную ширину, без обрезки. */
export function chipSlotsFor(containerWidth: number): number {
  if (containerWidth <= 0) return 0;
  return Math.max(1, Math.floor((containerWidth + CHIP_GAP) / (MIN_CHIP_W + CHIP_GAP)));
}

/**
 * Дни периода плюс симметричный контекст по краям, ровно до `chipCount`.
 *
 * Контекст — не украшение: без дней соседнего периода по краям кликать было
 * бы некуда — период внутри и так уже целиком показан, а контекстные чипы —
 * единственный способ шагнуть за его границу одним кликом по полосе, а не
 * стрелкой.
 */
function stripDays(range: DateRange, chipCount: number): IsoDate[] {
  const context = Math.max(0, chipCount - rangeLength(range));
  const before = Math.ceil(context / 2);
  const after = context - before;
  const start = parseDate(range.from).minus({ days: before });
  const end = parseDate(range.to).plus({ days: after });
  const days: IsoDate[] = [];
  for (let cursor = start; cursor <= end; cursor = cursor.plus({ days: 1 })) {
    days.push(cursor.toISODate() ?? '');
  }
  return days;
}

export function DayStrip({
  range,
  chipCount,
  onPick,
}: {
  readonly range: DateRange;
  readonly chipCount: number;
  readonly onPick: (date: IsoDate) => void;
}) {
  const days = useMemo(() => stripDays(range, chipCount), [range, chipCount]);

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      <div className="flex gap-[3px] pb-1" role="group" aria-label="Day strip">
        {days.map((date) => {
          const dt = parseDate(date);
          const weekend = dt.weekday >= 6;
          return (
            <button
              key={date}
              type="button"
              className="day-chip"
              data-selected={date >= range.from && date <= range.to}
              data-weekend={weekend}
              data-today={date === TODAY}
              title={dt.toFormat('cccc, d LLLL yyyy')}
              onClick={() => onPick(date)}
            >
              <span className="day-chip__wd">{dt.toFormat('ccccc')}</span>
              <span className="day-chip__num">{dt.day}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Шкала года
// ---------------------------------------------------------------------------

export function Scrubber({
  range,
  onPick,
}: {
  readonly range: DateRange;
  readonly onPick: (date: IsoDate) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const track = useMemo(() => scrubberTrack(range.from), [range.from]);
  const ticks = useMemo(() => monthTicks(track), [track]);

  const [dragging, setDragging] = useState(false);

  const dateAtEvent = useCallback(
    (clientX: number): IsoDate => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return range.from;
      return dateAtFraction(track, (clientX - rect.left) / rect.width);
    },
    [track, range.from],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: MouseEvent) => onPick(dateAtEvent(event.clientX));
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, dateAtEvent, onPick]);

  const left = fractionOf(track, range.from) * 100;
  const right = fractionOf(track, range.to) * 100;
  const width = Math.max(right - left, 0.6);
  const todayLeft = fractionOf(track, TODAY) * 100;
  const todayVisible = TODAY >= track.from && TODAY <= track.to;

  return (
    <div className="mt-2">
      <div
        ref={trackRef}
        className="scrub"
        role="slider"
        tabIndex={0}
        aria-label="Jump to a date"
        aria-valuetext={formatRange(range)}
        onMouseDown={(event) => {
          onPick(dateAtEvent(event.clientX));
          setDragging(true);
        }}
      >
        {ticks.map((tick) => (
          <span
            key={tick.date}
            className="scrub__tick"
            style={{ left: `${fractionOf(track, tick.date) * 100}%` }}
          >
            {tick.label}
          </span>
        ))}

        {todayVisible ? (
          <span className="scrub__today" style={{ left: `${todayLeft}%` }} title="Today" />
        ) : null}

        <div className="scrub__window" style={{ left: `${left}%`, width: `${width}%` }} />
      </div>
    </div>
  );
}
