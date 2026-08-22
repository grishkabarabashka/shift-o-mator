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
  IanaZone,
  IsoDate,
  IssueLevel,
  PersonId,
  RoleId,
} from '../domain/types.ts';
import type { CellRef } from './useSchedule.ts';

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
  activeRoleId: RoleId | undefined;
  selection: Selection;
  issueFilter: IssueLevel | 'ALL';
  /** Внутренний буфер обмена: строки людей × колонки дней. */
  clipboard: (RoleId | null)[][] | undefined;
  absenceDraft: AbsenceDraft | undefined;
  compDayDraft: CompDayEntry | undefined;

  setDisplayZone: (zone: DisplayZone) => void;
  setActiveRole: (roleId: RoleId | undefined) => void;
  select: (cell: CellRef, extend?: boolean) => void;
  clearSelection: () => void;
  focusDate: (date: IsoDate, personId?: PersonId) => void;
  setIssueFilter: (level: IssueLevel | 'ALL') => void;
  setClipboard: (rows: (RoleId | null)[][]) => void;
  openAbsenceCreate: (targets: readonly AbsenceRangeTarget[]) => void;
  openAbsenceEdit: (absence: Absence) => void;
  closeAbsenceDialog: () => void;
  openCompDayDialog: (entry: CompDayEntry) => void;
  closeCompDayDialog: () => void;
}

export const useUi = create<UiState>((set, get) => ({
  displayZone: 'role',
  activeRoleId: undefined,
  selection: { anchor: undefined, focus: undefined },
  issueFilter: 'ALL',
  clipboard: undefined,
  absenceDraft: undefined,
  compDayDraft: undefined,

  setDisplayZone: (displayZone) => set({ displayZone }),
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
    if (!person) return;
    const cell: CellRef = { personId: person, date };
    set({ selection: { anchor: cell, focus: cell } });
  },

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
