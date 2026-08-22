/**
 * Выбор видимого периода — три способа выбрать одно и то же.
 *
 * Планировщики думают о времени по-разному, и спека прототипа (§4.2) прямо
 * перечисляет все три органа управления в одной карточке:
 *
 *   1. **Шаг и масштаб** — «следующая неделя», «покажи месяц». Дискретно и
 *      предсказуемо; основной путь.
 *   2. **Полоса дней** — «вот эти четыре дня». Клик ставит якорь, протаскивание
 *      выделяет произвольный диапазон.
 *   3. **Шкала года** — «примерно вот сюда». Окно тянется целиком, а за края
 *      растягивается.
 *
 * Все три пишут в одно состояние `useUi`, а арифметику периода целиком держит
 * `engine/period.ts` — иначе «следующая неделя» из стрелки и «следующая неделя»
 * с шкалы разъехались бы на день.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DateRange, IsoDate } from '../../domain/types.ts';
import { addDays, daysBetween, parseDate } from '../../engine/dates.ts';
import {
  ZOOMS,
  dateAtFraction,
  formatRange,
  fractionOf,
  monthTicks,
  rangeLength,
  scrubberTrack,
} from '../../engine/period.ts';
import { TODAY, useUi } from '../../store/useUi.ts';

/** Полоса дней теряет смысл, когда день уже неразличим — дальше только шкала. */
const DAY_STRIP_LIMIT = 45;

export function DateRangeControl() {
  const zoom = useUi((s) => s.zoom);
  const range = useUi((s) => s.range);
  const custom = useUi((s) => s.custom);
  const setZoom = useUi((s) => s.setZoom);
  const stepPeriod = useUi((s) => s.stepPeriod);
  const goToday = useUi((s) => s.goToday);
  const setCustomRange = useUi((s) => s.setCustomRange);

  const length = rangeLength(range);
  const containsToday = TODAY >= range.from && TODAY <= range.to;

  return (
    <section className="card px-3 py-2.5" aria-label="Visible period">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => stepPeriod(-1)}
            aria-label="Previous period"
            title="Previous period"
          >
            ‹
          </button>
          <button
            type="button"
            className="btn"
            onClick={goToday}
            data-active={containsToday && !custom}
            title="Jump to the period containing today"
          >
            Today
          </button>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => stepPeriod(1)}
            aria-label="Next period"
            title="Next period"
          >
            ›
          </button>
        </div>

        <div className="min-w-0 px-1">
          <div className="truncate text-[15px] font-semibold tracking-tight">
            {formatRange(range)}
          </div>
          <div className="text-[11.5px] text-muted">
            {length} {length === 1 ? 'day' : 'days'}
            {custom ? ' · custom selection' : ''}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="segmented" role="group" aria-label="Zoom">
            {ZOOMS.map((spec) => (
              <button
                key={spec.id}
                type="button"
                className="segmented__item"
                data-active={!custom && zoom === spec.id}
                title={spec.title}
                onClick={() => setZoom(spec.id)}
              >
                {spec.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {length <= DAY_STRIP_LIMIT ? (
        <DayStrip range={range} onSelect={setCustomRange} />
      ) : null}

      <Scrubber range={range} onSelect={setCustomRange} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Полоса дней
// ---------------------------------------------------------------------------

/**
 * Дни периода плюс неделя контекста с каждой стороны.
 *
 * Ровно период показывать бессмысленно вдвойне: полоса нужна, чтобы выйти
 * **за** его границы одним движением, и без полей выделение занимает её
 * целиком — сплошная синяя лента, по которой не видно, что вообще выделено.
 */
function stripDays(range: DateRange): IsoDate[] {
  const start = parseDate(range.from).minus({ days: 7 });
  const end = parseDate(range.to).plus({ days: 7 });
  const days: IsoDate[] = [];
  for (let cursor = start; cursor <= end; cursor = cursor.plus({ days: 1 })) {
    days.push(cursor.toISODate() ?? '');
  }
  return days;
}

function DayStrip({
  range,
  onSelect,
}: {
  readonly range: DateRange;
  readonly onSelect: (range: DateRange) => void;
}) {
  const days = useMemo(() => stripDays(range), [range]);
  const [dragFrom, setDragFrom] = useState<IsoDate>();
  const [dragTo, setDragTo] = useState<IsoDate>();
  // Клик-клик — второй способ задать диапазон, без перетаскивания: первый
  // клик ставит якорь, второй (в том числе на ту же дату — это один день)
  // применяет диапазон. Перетаскивание работает как раньше и распознаётся
  // отдельно: оно завершается не там, где началось.
  const [pendingAnchor, setPendingAnchor] = useState<IsoDate>();
  const [hoverDate, setHoverDate] = useState<IsoDate>();

  useEffect(() => {
    if (!dragFrom) return;
    const finish = () => {
      setDragFrom(undefined);
      setDragTo(undefined);
    };
    window.addEventListener('mouseup', finish);
    return () => window.removeEventListener('mouseup', finish);
  }, [dragFrom]);

  // Диапазон сменился откуда-то ещё (зум, «Сегодня», шкала года, либо наш
  // же коммит) — незавершённый клик-клик больше не про то, что на экране.
  useEffect(() => {
    setPendingAnchor(undefined);
  }, [range.from, range.to]);

  // Пока тянут — показываем предполагаемое выделение, но не пишем в стор на
  // каждый пиксель: перезагрузка периода на каждое движение мыши убила бы UI.
  const dragPreview =
    dragFrom && dragTo && dragFrom !== dragTo
      ? { from: dragFrom < dragTo ? dragFrom : dragTo, to: dragFrom < dragTo ? dragTo : dragFrom }
      : undefined;

  // Якорь уже стоит — наведение до второго клика показывает, каким станет
  // диапазон, тем же способом: превью локально, коммит только на клик.
  const anchorPreview =
    !dragPreview && pendingAnchor && hoverDate
      ? {
          from: pendingAnchor < hoverDate ? pendingAnchor : hoverDate,
          to: pendingAnchor < hoverDate ? hoverDate : pendingAnchor,
        }
      : undefined;

  const preview = dragPreview ?? anchorPreview;
  const shown = preview ?? range;

  const commit = (from: IsoDate, to: IsoDate) => {
    onSelect(from <= to ? { from, to } : { from: to, to: from });
  };

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      <div className="flex gap-[3px] overflow-x-auto pb-1" role="group" aria-label="Day strip">
        {days.map((date) => {
          const dt = parseDate(date);
          const weekend = dt.weekday >= 6;
          const selected = date >= shown.from && date <= shown.to;
          return (
            <button
              key={date}
              type="button"
              className="day-chip"
              data-selected={selected}
              data-weekend={weekend}
              data-today={date === TODAY}
              data-anchor={pendingAnchor === date}
              title={
                pendingAnchor
                  ? `Click to set the other end: ${dt.toFormat('cccc, d LLLL yyyy')}`
                  : dt.toFormat('cccc, d LLLL yyyy')
              }
              onMouseDown={() => {
                setDragFrom(date);
                setDragTo(date);
              }}
              onMouseEnter={() => {
                if (dragFrom) setDragTo(date);
                setHoverDate(date);
              }}
              onMouseUp={() => {
                if (!dragFrom) return;
                if (date !== dragFrom) {
                  // Мышь ушла с клетки, где началось нажатие, — перетаскивание.
                  commit(dragFrom, date);
                  return;
                }
                // Отпустили там же, где нажали — это клик, не перетаскивание.
                // Первый клик ставит якорь; второй (та же дата — один день)
                // закрывает диапазон.
                if (pendingAnchor === undefined) setPendingAnchor(date);
                else commit(pendingAnchor, date);
              }}
            >
              <span className="day-chip__wd">{dt.toFormat('ccccc')}</span>
              <span className="day-chip__num">{dt.day}</span>
            </button>
          );
        })}
      </div>
      {pendingAnchor ? (
        <span className="text-[11px] text-faint">
          Click another date to set the range — the same date again for one day.
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Шкала года
// ---------------------------------------------------------------------------

type DragMode = 'move' | 'start' | 'end';

function Scrubber({
  range,
  onSelect,
}: {
  readonly range: DateRange;
  readonly onSelect: (range: DateRange) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const track = useMemo(() => scrubberTrack(range.from), [range.from]);
  const ticks = useMemo(() => monthTicks(track), [track]);

  const [drag, setDrag] = useState<{ mode: DragMode; span: number } | undefined>();

  const dateAtEvent = useCallback(
    (clientX: number): IsoDate => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return range.from;
      return dateAtFraction(track, (clientX - rect.left) / rect.width);
    },
    [track, range.from],
  );

  useEffect(() => {
    if (!drag) return;

    const onMove = (event: MouseEvent) => {
      const at = dateAtEvent(event.clientX);
      if (drag.mode === 'move') onSelect({ from: at, to: addDays(at, drag.span) });
      else if (drag.mode === 'start') onSelect({ from: at, to: range.to });
      else onSelect({ from: range.from, to: at });
    };
    const onUp = () => setDrag(undefined);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, dateAtEvent, onSelect, range.from, range.to]);

  const left = fractionOf(track, range.from) * 100;
  const right = fractionOf(track, addDays(range.to, 1)) * 100;
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
        aria-label="Drag to move the visible period"
        aria-valuetext={formatRange(range)}
        onMouseDown={(event) => {
          // Клик мимо окна переносит окно сюда, сохраняя его длину: это самый
          // частый жест, и требовать попадания в 40 пикселей окна нельзя.
          if ((event.target as HTMLElement).closest('.scrub__window')) return;
          const at = dateAtEvent(event.clientX);
          const span = daysBetween(range.from, range.to);
          onSelect({ from: at, to: addDays(at, span) });
          setDrag({ mode: 'move', span });
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

        <div
          className="scrub__window"
          style={{ left: `${left}%`, width: `${width}%` }}
          onMouseDown={(event) => {
            event.stopPropagation();
            setDrag({ mode: 'move', span: daysBetween(range.from, range.to) });
          }}
        >
          <span
            className="scrub__handle scrub__handle--start"
            onMouseDown={(event) => {
              event.stopPropagation();
              setDrag({ mode: 'start', span: 0 });
            }}
          />
          <span
            className="scrub__handle scrub__handle--end"
            onMouseDown={(event) => {
              event.stopPropagation();
              setDrag({ mode: 'end', span: 0 });
            }}
          />
        </div>
      </div>
    </div>
  );
}
