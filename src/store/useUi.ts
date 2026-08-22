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
  RoleId,
} from '../domain/types.ts';
import { DEFAULT_UNIT } from '../domain/fixtures.ts';
import { toIsoDate, parseDate } from '../engine/dates.ts';
import { rangeFor, stepAnchor, type ZoomId } from '../engine/period.ts';
import type { CellRef } from './useSchedule.ts';

/**
 * Сегодня фиксируется на момент запуска. Движки принимают текущий момент
 * параметром, и `new Date()` из глубины компонента им передавать нельзя —
 * тогда два соседних вызова могли бы разойтись через полночь.
 */
export const TODAY: IsoDate = toIsoDate(parseDate(new Date().toISOString().slice(0, 10)));

/** Таймзона отображения: своя у роли либо явно выбранная. */
export type DisplayZone = 'role' | IanaZone;

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
   * Видимый период. `range` хранится, а не вычисляется в селекторе: селектор
   * возвращал бы новый объект на каждый вызов и перерисовывал бы всю сетку.
   */
  zoom: ZoomId;
  anchor: IsoDate;
  range: DateRange;
  /** Диапазон, выбранный вручную по полосе дней или шкале. */
  custom: boolean;

  activeRoleId: RoleId | undefined;
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
  /**
   * Показывать всех людей региона, а не только выбранной единицы.
   * Единица — фильтр по умолчанию, а не граница (ADR-0020).
   */
  wholeRegion: boolean;
  /** Внутренний буфер обмена: строки людей × колонки дней. */
  clipboard: (RoleId | null)[][] | undefined;
  absenceDraft: AbsenceDraft | undefined;
  compDayDraft: CompDayEntry | undefined;

  setDisplayZone: (zone: DisplayZone) => void;
  setUnit: (unitId: string) => void;
  setZoom: (zoom: ZoomId) => void;
  setAnchor: (anchor: IsoDate) => void;
  stepPeriod: (direction: 1 | -1) => void;
  goToday: () => void;
  setCustomRange: (range: DateRange) => void;
  setActiveRole: (roleId: RoleId | undefined) => void;
  select: (cell: CellRef, extend?: boolean) => void;
  clearSelection: () => void;
  focusDate: (date: IsoDate, personId?: PersonId) => void;
  highlight: (date: IsoDate) => void;
  setIssueFilter: (level: IssueLevel | 'ALL') => void;
  setWholeRegion: (value: boolean) => void;
  setClipboard: (rows: (RoleId | null)[][]) => void;
  openAbsenceCreate: (targets: readonly AbsenceRangeTarget[]) => void;
  openAbsenceEdit: (absence: Absence) => void;
  closeAbsenceDialog: () => void;
  openCompDayDialog: (entry: CompDayEntry) => void;
  closeCompDayDialog: () => void;
}

export const useUi = create<UiState>((set, get) => ({
  displayZone: 'role',
  unitId: DEFAULT_UNIT,
  zoom: 'month',
  anchor: TODAY,
  range: rangeFor('month', TODAY),
  custom: false,
  activeRoleId: undefined,
  selection: { anchor: undefined, focus: undefined },
  highlightDate: undefined,
  issueFilter: 'ALL',
  wholeRegion: false,
  clipboard: undefined,
  absenceDraft: undefined,
  compDayDraft: undefined,

  setDisplayZone: (displayZone) => set({ displayZone }),
  setUnit: (unitId) => set({ unitId }),

  setZoom: (zoom) => set({ zoom, custom: false, range: rangeFor(zoom, get().anchor) }),
  setAnchor: (anchor) => set({ anchor, custom: false, range: rangeFor(get().zoom, anchor) }),

  stepPeriod: (direction) => {
    const { zoom, anchor } = get();
    const next = stepAnchor(zoom, anchor, direction);
    set({ anchor: next, custom: false, range: rangeFor(zoom, next) });
  },

  goToday: () => set({ anchor: TODAY, custom: false, range: rangeFor(get().zoom, TODAY) }),

  // Ручной диапазон не меняет `zoom`: переключатель остаётся подсвеченным как
  // «откуда пришли», и один клик по нему возвращает регулярный период.
  setCustomRange: (range) => set({ range, anchor: range.from, custom: true }),

  setActiveRole: (activeRoleId) => set({ activeRoleId }),

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
  setWholeRegion: (wholeRegion) => set({ wholeRegion }),
  setClipboard: (clipboard) => set({ clipboard }),

  openAbsenceCreate: (targets) => {
    if (targets.length === 0) return;
    set({ absenceDraft: { mode: 'create', targets } });
  },
  openAbsenceEdit: (absence) => set({ absenceDraft: { mode: 'edit', absence } }),
  closeAbsenceDialog: () => set({ absenceDraft: undefined }),
  openCompDayDialog: (entry) => set({ compDayDraft: entry }),
  closeCompDayDialog: () => set({ compDayDraft: undefined }),
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
