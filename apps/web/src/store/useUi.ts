/**
 * Состояние интерфейса: то, что не является данными и не сохраняется.
 *
 * Живёт отдельно от `useSchedule` намеренно: смешивать «данные» и «что сейчас
 * выделено» — верный способ перерисовывать сетку на каждое движение курсора.
 */

import { create } from 'zustand';
import type {
  Absence,
  CompDayEntry,
  DateRange,
  IanaZone,
  IsoDate,
  IssueLevel,
  PersonId,
  ShiftId,
} from '../domain/types.ts';
import { ALL_UNITS } from '../domain/types.ts';
import { addDays, toIsoDate, parseDate } from '../engine/dates.ts';
import {
  overviewRange,
  rangeFor,
  rangeLength,
  stepAnchor,
  stepOverviewAnchor,
  type OverviewSpan,
  type ScheduleZoom,
} from '../engine/period.ts';
import type { CellRef } from './useSchedule.ts';

/**
 * Сегодня фиксируется на момент запуска. Движки принимают текущий момент
 * параметром, и `new Date()` из глубины компонента им передавать нельзя —
 * тогда два соседних вызова могли бы разойтись через полночь.
 */
export const TODAY: IsoDate = toIsoDate(parseDate(new Date().toISOString().slice(0, 10)));

/** Таймзона отображения: своя у смены либо явно выбранная. */
export type DisplayZone = 'shift' | IanaZone;

export interface Selection {
  readonly anchor: CellRef | undefined;
  readonly focus: CellRef | undefined;
}

/** Диапазон для одной будущей записи отсутствия: один человек, от–до. */
export interface AbsenceRangeTarget {
  readonly personId: PersonId;
  readonly from: IsoDate;
  readonly to: IsoDate;
}

/**
 * Черновик диалога отсутствия. `create` приходит из выделения в сетке
 * (по записи на каждого выделенного человека), `edit` — из двойного клика
 * по уже стоящей отметке.
 */
export type AbsenceDraft =
  | { readonly mode: 'create'; readonly targets: readonly AbsenceRangeTarget[] }
  | { readonly mode: 'edit'; readonly absence: Absence };

export interface UiState {
  displayZone: DisplayZone;
  /** Единица планирования — фильтр по умолчанию, а не граница (ADR-0020). */
  unitId: string;

  /**
   * Overview и Schedule хотят разное из одного и того же времени: Overview
   * листает сутки вокруг «сейчас», Schedule — месяцы (ADR-0036). Поэтому у
   * каждого экрана свой запоминаемый срез, а `range` — общий активный диапазон,
   * который переписывает та страница, что смонтирована (`enterOverview` /
   * `enterSchedule`). `range` хранится, а не вычисляется в селекторе: селектор
   * возвращал бы новый объект на каждый вызов и перерисовывал бы всю сетку.
   */
  overview: { readonly anchor: IsoDate; readonly span: OverviewSpan };
  schedule: { readonly anchor: IsoDate; readonly zoom: ScheduleZoom };
  range: DateRange;

  activeShiftId: ShiftId | undefined;
  selection: Selection;
  /**
   * Колонка, к которой надо прокрутить сетку.
   *
   * Нужна отдельно от выделения, потому что у дыры **нет человека**: никто не
   * назначен — в этом она и состоит. Переход «почини это» из дашборда может
   * указать только на дату, и делать вид, что он указывает на ячейку, значит
   * подсветить случайную строку.
   */
  highlightDate: IsoDate | undefined;
  issueFilter: IssueLevel | 'ALL';
  /** Внутренний буфер обмена: строки людей × колонки дней. */
  clipboard: (ShiftId | null)[][] | undefined;
  absenceDraft: AbsenceDraft | undefined;
  compDayDraft: CompDayEntry | undefined;
  /**
   * Назначения, закреплённые от автогенерации.
   *
   * Сессионное состояние, не часть плана: замок — рабочая пометка «это уже
   * решено, не трогай», а не факт расписания, который стоит публиковать или
   * держать в истории.
   */
  lockedAssignmentIds: ReadonlySet<string>;

  setDisplayZone: (zone: DisplayZone) => void;
  setUnit: (unitId: string) => void;

  /** Пересчитать активный `range` из своего среза при монтировании страницы. */
  enterOverview: () => void;
  enterSchedule: () => void;
  setOverviewSpan: (span: OverviewSpan) => void;
  setOverviewAnchor: (anchor: IsoDate) => void;
  stepOverview: (direction: 1 | -1) => void;
  overviewToday: () => void;
  setScheduleZoom: (zoom: ScheduleZoom) => void;
  setScheduleAnchor: (anchor: IsoDate) => void;
  /** Клик по дню в стрипе/шкале: делает эту дату началом периода той же
   * длины — не привязывает к 1-му числу месяца, как `setScheduleAnchor`. */
  jumpScheduleTo: (date: IsoDate) => void;
  stepSchedule: (direction: 1 | -1) => void;
  scheduleToday: () => void;

  setActiveShift: (shiftId: ShiftId | undefined) => void;
  select: (cell: CellRef, extend?: boolean) => void;
  clearSelection: () => void;
  focusDate: (date: IsoDate, personId?: PersonId) => void;
  highlight: (date: IsoDate) => void;
  setIssueFilter: (level: IssueLevel | 'ALL') => void;
  setClipboard: (rows: (ShiftId | null)[][]) => void;
  openAbsenceCreate: (targets: readonly AbsenceRangeTarget[]) => void;
  openAbsenceEdit: (absence: Absence) => void;
  closeAbsenceDialog: () => void;
  openCompDayDialog: (entry: CompDayEntry) => void;
  closeCompDayDialog: () => void;
  toggleLock: (assignmentId: string) => void;
}

export const useUi = create<UiState>((set, get) => ({
  displayZone: 'shift',
  unitId: ALL_UNITS,
  overview: { anchor: TODAY, span: 1 },
  schedule: { anchor: TODAY, zoom: 'month' },
  range: rangeFor('month', TODAY),
  activeShiftId: undefined,
  selection: { anchor: undefined, focus: undefined },
  highlightDate: undefined,
  issueFilter: 'ALL',
  clipboard: undefined,
  absenceDraft: undefined,
  compDayDraft: undefined,
  lockedAssignmentIds: new Set(),

  setDisplayZone: (displayZone) => set({ displayZone }),
  setUnit: (unitId) => set({ unitId }),

  enterOverview: () => {
    const { anchor, span } = get().overview;
    set({ range: overviewRange(anchor, span) });
  },
  enterSchedule: () => {
    const { anchor, zoom } = get().schedule;
    set({ range: rangeFor(zoom, anchor) });
  },

  setOverviewSpan: (span) => {
    const anchor = get().overview.anchor;
    set({ overview: { anchor, span }, range: overviewRange(anchor, span) });
  },
  setOverviewAnchor: (anchor) => {
    const span = get().overview.span;
    set({ overview: { anchor, span }, range: overviewRange(anchor, span) });
  },
  stepOverview: (direction) => {
    const { anchor, span } = get().overview;
    const next = stepOverviewAnchor(anchor, span, direction);
    set({ overview: { anchor: next, span }, range: overviewRange(next, span) });
  },
  overviewToday: () => {
    const span = get().overview.span;
    set({ overview: { anchor: TODAY, span }, range: overviewRange(TODAY, span) });
  },

  setScheduleZoom: (zoom) => {
    const anchor = get().schedule.anchor;
    set({ schedule: { anchor, zoom }, range: rangeFor(zoom, anchor) });
  },
  setScheduleAnchor: (anchor) => {
    const zoom = get().schedule.zoom;
    set({ schedule: { anchor, zoom }, range: rangeFor(zoom, anchor) });
  },
  // Owner review: clicking a date in the strip/scrubber shouldn't snap to the
  // 1st of that date's calendar month — it should make the clicked date the
  // start of the period, keeping whatever width was already on screen.
  jumpScheduleTo: (date) => {
    const { zoom } = get().schedule;
    const length = rangeLength(get().range);
    set({ schedule: { anchor: date, zoom }, range: { from: date, to: addDays(date, length - 1) } });
  },
  stepSchedule: (direction) => {
    const { anchor, zoom } = get().schedule;
    const next = stepAnchor(zoom, anchor, direction);
    set({ schedule: { anchor: next, zoom }, range: rangeFor(zoom, next) });
  },
  scheduleToday: () => {
    const zoom = get().schedule.zoom;
    set({ schedule: { anchor: TODAY, zoom }, range: rangeFor(zoom, TODAY) });
  },

  setActiveShift: (activeShiftId) => set({ activeShiftId }),

  select: (cell, extend = false) => {
    const { selection } = get();
    set({
      selection: extend && selection.anchor
        ? { anchor: selection.anchor, focus: cell }
        : { anchor: cell, focus: cell },
    });
  },

  clearSelection: () => set({ selection: { anchor: undefined, focus: undefined } }),

  focusDate: (date, personId) => {
    const { selection } = get();
    const person = personId ?? selection.focus?.personId;
    // Без человека выделять нечего — но прокрутить к колонке всё равно надо.
    if (!person) {
      set({ highlightDate: date });
      return;
    }
    const cell: CellRef = { personId: person, date };
    set({ selection: { anchor: cell, focus: cell }, highlightDate: date });
  },

  highlight: (highlightDate) => set({ highlightDate }),

  setIssueFilter: (issueFilter) => set({ issueFilter }),
  setClipboard: (clipboard) => set({ clipboard }),

  openAbsenceCreate: (targets) => {
    if (targets.length === 0) return;
    set({ absenceDraft: { mode: 'create', targets } });
  },
  openAbsenceEdit: (absence) => set({ absenceDraft: { mode: 'edit', absence } }),
  closeAbsenceDialog: () => set({ absenceDraft: undefined }),
  openCompDayDialog: (entry) => set({ compDayDraft: entry }),
  closeCompDayDialog: () => set({ compDayDraft: undefined }),

  toggleLock: (assignmentId) => {
    const next = new Set(get().lockedAssignmentIds);
    if (next.has(assignmentId)) next.delete(assignmentId);
    else next.add(assignmentId);
    set({ lockedAssignmentIds: next });
  },
}));

/** Прямоугольник выделения в координатах (индекс строки, индекс колонки). */
export function selectionBounds(
  selection: Selection,
  rowIndex: (personId: PersonId) => number,
  columnIndex: (date: IsoDate) => number,
): { top: number; bottom: number; left: number; right: number } | undefined {
  const { anchor, focus } = selection;
  if (!anchor || !focus) return undefined;
  const a = { row: rowIndex(anchor.personId), col: columnIndex(anchor.date) };
  const b = { row: rowIndex(focus.personId), col: columnIndex(focus.date) };
  if (a.row < 0 || b.row < 0 || a.col < 0 || b.col < 0) return undefined;
  return {
    top: Math.min(a.row, b.row),
    bottom: Math.max(a.row, b.row),
    left: Math.min(a.col, b.col),
    right: Math.max(a.col, b.col),
  };
}
