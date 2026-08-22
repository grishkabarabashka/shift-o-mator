/**
 * Выбор видимого периода на Schedule — три способа выбрать одно и то же.
 *
 * Schedule планирует не короче месяца (ADR-0036, owner review): дневной и
 * недельный зум там бессмысленны — сетка держит минимум 30×N ячеек, и три
 * органа управления живут в одной карточке:
 *
 *   1. **Шаг и масштаб** — «следующий месяц», «покажи квартал». Дискретно и
 *      предсказуемо; основной путь.
 *   2. **Полоса дней** — клик по дню делает его началом периода той же
 *      ширины (owner review: не обязательно 1-е число месяца — конец
 *      подстраивается под уже выбранную длину).
 *   3. **Шкала года** — то же самое, но «примерно вот сюда»: окно той же
 *      ширины двигается целиком, не привязываясь к границам месяцев.
 *
 * Все три пишут в `useUi.schedule`, а арифметику периода целиком держит
 * `engine/period.ts` — иначе «следующий месяц» из стрелки и «следующий
 * месяц» со шкалы разъехались бы на день. Сами полоса и шкала — общий
 * `PeriodStrip.tsx`, тот же, что использует Overview.
 *
 * Полоса дней и шкала года сворачиваемы (CLAUDE.md: панель периода занимает
 * слишком много вертикального места) — шаг/масштаб и текущий диапазон
 * остаются видны всегда, сворачивается только вспомогательный способ
 * перейти к произвольному месяцу.
 */

import { useState } from 'react';
import { ZOOMS, formatRange, rangeLength } from '../../engine/period.ts';
import { TODAY, useUi } from '../../store/useUi.ts';
import { useElementWidth } from '../../ui/useElementWidth.ts';
import { chipSlotsFor, DayStrip, Scrubber } from './PeriodStrip.tsx';

export function DateRangeControl() {
  const zoom = useUi((s) => s.schedule.zoom);
  const range = useUi((s) => s.range);
  const setZoom = useUi((s) => s.setScheduleZoom);
  const jumpTo = useUi((s) => s.jumpScheduleTo);
  const stepPeriod = useUi((s) => s.stepSchedule);
  const goToday = useUi((s) => s.scheduleToday);

  const length = rangeLength(range);
  const containsToday = TODAY >= range.from && TODAY <= range.to;

  // Сколько чипов помещается без обрезки — а не фиксированный лимит,
  // молчаливо прячущий хвост дат за правым краем. Пока ширина не измерена
  // (первый кадр), полоса не рисуется вовсе: лучше кадр пустоты, чем неверное
  // число чипов, тут же перерисованное.
  const [stripRef, stripWidth] = useElementWidth<HTMLDivElement>();
  const chipSlots = chipSlotsFor(stripWidth);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <section className="card px-3 py-2.5" aria-label="Visible period">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn--icon"
          onClick={() => setPickerOpen(!pickerOpen)}
          aria-expanded={pickerOpen}
          title={pickerOpen ? 'Hide the day strip and year scrubber' : 'Show the day strip and year scrubber'}
        >
          <span aria-hidden className="text-[9px]">
            {pickerOpen ? '▼' : '▶'}
          </span>
        </button>

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
            data-active={containsToday}
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
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="segmented" role="group" aria-label="Zoom">
            {ZOOMS.map((spec) => (
              <button
                key={spec.id}
                type="button"
                className="segmented__item"
                data-active={zoom === spec.id}
                title={spec.title}
                onClick={() => setZoom(spec.id)}
              >
                {spec.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The width-measured node stays mounted across collapse/expand — only
          its children toggle — so the ResizeObserver never has to re-attach
          to a freshly-mounted node and briefly report a stale/zero width. */}
      <div ref={stripRef}>
        {pickerOpen && chipSlots > 0 && length <= chipSlots ? (
          <DayStrip range={range} chipCount={chipSlots} onPick={jumpTo} />
        ) : null}
      </div>

      {pickerOpen ? <Scrubber range={range} onPick={jumpTo} /> : null}
    </section>
  );
}
