/**
 * Видимый период: масштаб, шаг навигации и человекочитаемая подпись.
 *
 * Выделено в чистый модуль намеренно. Период выбирают три разных элемента
 * управления — сегментированный переключатель, полоса дней и перетаскиваемая
 * шкала, — и все они должны согласиться, что такое «неделя». Если это знание
 * размазать по компонентам, «следующая неделя» из стрелки и «следующая неделя»
 * из шкалы разъедутся на день.
 *
 * Неделя всегда ISO: понедельник–воскресенье, и расходиться с этим нельзя.
 */

import { DateTime } from 'luxon';
import type { DateRange, IsoDate } from '../domain/types.ts';
import { addDays, daysBetween, parseDate, toIsoDate } from './dates.ts';

export type ScheduleZoom = 'month' | 'quarter' | 'half-year';

export interface ZoomSpec {
  readonly id: ScheduleZoom;
  /** Подпись на переключателе. */
  readonly label: string;
  /** Полная подпись для aria и тултипа. */
  readonly title: string;
  /**
   * Сетка редактируема только на месяце. Три и шесть месяцев —
   * тепловая карта только на чтение: 80 × 180 редактируемых ячеек не
   * помещаются ни на экран, ни в разумное время отрисовки.
   */
  readonly detail: boolean;
}

export const ZOOMS: readonly ZoomSpec[] = [
  { id: 'month', label: 'Month', title: 'Calendar month', detail: true },
  { id: 'quarter', label: '3 Months', title: 'Three months — read-only heatmap', detail: false },
  { id: 'half-year', label: '6 Months', title: 'Six months — read-only heatmap', detail: false },
];

const ZOOM_BY_ID = new Map(ZOOMS.map((zoom) => [zoom.id, zoom]));

export function zoomSpec(id: ScheduleZoom): ZoomSpec {
  const spec = ZOOM_BY_ID.get(id);
  if (!spec) throw new Error(`Unknown zoom ${id}`);
  return spec;
}

/**
 * Период выбранного масштаба, содержащий якорную дату. Только для Schedule —
 * минимальный масштаб там месяц (owner review: меньше месяца планировать
 * бессмысленно).
 *
 * Якорь — не «начало периода», а «день, который планировщик хочет видеть».
 * Поэтому месяц выравнивается на первое число: иначе стрелка «вперёд» от
 * 15 августа давала бы 15 сентября и заголовки колонок переставали бы
 * совпадать с календарём.
 */
export function rangeFor(zoom: ScheduleZoom, anchor: IsoDate): DateRange {
  const dt = parseDate(anchor);
  switch (zoom) {
    case 'month':
      return { from: toIsoDate(dt.startOf('month')), to: toIsoDate(dt.endOf('month')) };
    case 'quarter':
      return monthSpan(dt, 3);
    case 'half-year':
      return monthSpan(dt, 6);
  }
}

function monthSpan(dt: DateTime, months: number): DateRange {
  const start = dt.startOf('month');
  return {
    from: toIsoDate(start),
    to: toIsoDate(start.plus({ months }).minus({ days: 1 })),
  };
}

/**
 * Якорь после шага вперёд или назад.
 *
 * Шаг равен видимому периоду, а не фиксированному числу дней: «дальше» от
 * месяца — это месяц, а не 30 дней, иначе февраль сдвигал бы сетку.
 */
export function stepAnchor(zoom: ScheduleZoom, anchor: IsoDate, direction: 1 | -1): IsoDate {
  const dt = parseDate(anchor);
  switch (zoom) {
    case 'month':
      return toIsoDate(dt.startOf('month').plus({ months: direction }));
    case 'quarter':
      return toIsoDate(dt.startOf('month').plus({ months: 3 * direction }));
    case 'half-year':
      return toIsoDate(dt.startOf('month').plus({ months: 6 * direction }));
  }
}

/**
 * Ширина окна Overview в днях: 1, 3 или 7 суток на всю ширину экрана
 * (owner review — вместо семи зумов на одном таймлайне).
 */
export type OverviewSpan = 1 | 3 | 7;

export const OVERVIEW_SPANS: readonly { readonly id: OverviewSpan; readonly label: string }[] = [
  { id: 1, label: '1 Day' },
  { id: 3, label: '3 Days' },
  { id: 7, label: '7 Days' },
];

/**
 * Окно Overview вокруг якоря: `span` суток от якоря плюс столько же контекста
 * с каждой стороны, чтобы горизонтальный скролл был непрерывным в обе стороны
 * без дозагрузки данных при обычном протаскивании.
 */
export function overviewRange(anchor: IsoDate, span: OverviewSpan): DateRange {
  return { from: addDays(anchor, -span), to: addDays(anchor, 2 * span - 1) };
}

/** Якорь Overview после шага вперёд/назад — на ширину видимого окна. */
export function stepOverviewAnchor(anchor: IsoDate, span: OverviewSpan, direction: 1 | -1): IsoDate {
  return addDays(anchor, span * direction);
}

/**
 * Подпись периода. Общая часть не повторяется: «3 – 9 Aug 2026», а не
 * «3 Aug 2026 – 9 Aug 2026». На узкой шапке это разница в две строки.
 */
export function formatRange(range: DateRange): string {
  const from = parseDate(range.from);
  const to = parseDate(range.to);

  if (range.from === range.to) return from.toFormat('cccc, d LLLL yyyy');
  if (from.year === to.year && from.month === to.month) {
    return `${from.toFormat('d')} – ${to.toFormat('d LLLL yyyy')}`;
  }
  if (from.year === to.year) {
    return `${from.toFormat('d LLL')} – ${to.toFormat('d LLL yyyy')}`;
  }
  return `${from.toFormat('d LLL yyyy')} – ${to.toFormat('d LLL yyyy')}`;
}

/** Число дней в периоде включительно. */
export function rangeLength(range: DateRange): number {
  return daysBetween(range.from, range.to) + 1;
}

/**
 * Дорожка для перетаскиваемой шкалы: год вокруг якоря, выровненный по месяцам.
 *
 * Год, а не «весь диапазон данных»: планировщик двигает окно в пределах
 * сезона, и шкала на десять лет сделала бы шаг в месяц неприцельным.
 */
export function scrubberTrack(anchor: IsoDate): DateRange {
  const start = parseDate(anchor).startOf('month').minus({ months: 4 });
  return { from: toIsoDate(start), to: toIsoDate(start.plus({ months: 12 }).minus({ days: 1 })) };
}

/** Метки месяцев внутри дорожки — для подписей под шкалой. */
export function monthTicks(track: DateRange): { date: IsoDate; label: string }[] {
  const ticks: { date: IsoDate; label: string }[] = [];
  let cursor = parseDate(track.from).startOf('month');
  const end = parseDate(track.to);
  while (cursor <= end) {
    ticks.push({ date: toIsoDate(cursor), label: cursor.toFormat('LLL') });
    cursor = cursor.plus({ months: 1 });
  }
  return ticks;
}

/** Доля позиции даты внутри дорожки, 0…1. Для раскладки шкалы. */
export function fractionOf(track: DateRange, date: IsoDate): number {
  const total = rangeLength(track);
  const offset = daysBetween(track.from, date);
  return Math.min(Math.max(offset / total, 0), 1);
}

/**
 * Обратное к `fractionOf`: дата по доле дорожки.
 *
 * Тот же знаменатель `total`, что и у `fractionOf` — иначе пара не была
 * обратной друг другу и перетаскивание на правом краю промахивалось на день.
 * `floor`, а не `round`: доля 1.0 обязана остаться внутри дорожки, а не
 * перескочить на день за её пределы.
 */
export function dateAtFraction(track: DateRange, fraction: number): IsoDate {
  const total = rangeLength(track);
  const clamped = Math.min(Math.max(fraction, 0), 1);
  // Эпсилон перед `floor`: `fractionOf` — это чистое деление, и обратное
  // умножение на `total` не всегда возвращает ровно целое число дней —
  // 63/365*365 может дать 62.999999999999993, и без эпсилона такой день
  // округлился бы вниз мимо себя самого.
  const offset = Math.min(total - 1, Math.floor(clamped * total + 1e-9));
  return addDays(track.from, offset);
}
