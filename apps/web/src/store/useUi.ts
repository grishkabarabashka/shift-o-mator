/**
 * NOTE: UI state: what isn't data and isn't persisted.
 *
 * Lives apart from `useSchedule` on purpose: mixing "data" with "what's
 * currently selected" is a sure way to repaint the grid on every cursor move.
 */

import { create } from 'zustand';
import type {
  Absence,
  CompDayEntry,
  DateRange,
  IanaZone,
  IsoDate,
  PersonId,
  ShiftId,
} from '../domain/types.ts';
import { ALL_UNITS } from '../domain/types.ts';
import { addDays, toIsoDate, parseDate } from '../engine/dates.ts';
import {
  overviewRange,
  rangeFor,
  rangeLength,
  jumpAnchorMonths,
  stepAnchor,
  stepOverviewAnchor,
  type OverviewSpan,
  type ScheduleZoom,
} from '../engine/period.ts';
import type { CellRef } from './useSchedule.ts';

/**
 * WHY: "Today" is fixed at startup. Engines take the current moment as a
 * parameter, and a `new Date()` from deep inside a component can't be passed
 * to them — two adjacent calls could otherwise disagree across midnight.
 */
export const TODAY: IsoDate = toIsoDate(parseDate(new Date().toISOString().slice(0, 10)));

/** NOTE: Display timezone: the shift's own, or explicitly chosen. */
export type DisplayZone = 'shift' | IanaZone;

export interface Selection {
  readonly anchor: CellRef | undefined;
  readonly focus: CellRef | undefined;
}

/** NOTE: Range for one future absence record: one person, from-to. */
export interface AbsenceRangeTarget {
  readonly personId: PersonId;
  readonly from: IsoDate;
  readonly to: IsoDate;
}

/**
 * NOTE: Draft for the absence dialog. `create` comes from a grid selection
 * (one record per selected person), `edit` comes from double-clicking an
 * already-placed marker.
 */
export type AbsenceDraft =
  | { readonly mode: 'create'; readonly targets: readonly AbsenceRangeTarget[] }
  | { readonly mode: 'edit'; readonly absence: Absence };

/**
 * NOTE: Draft for the presence dialog (ADR-0043). Same two shapes as the absence
 * dialog — presence is declared in blocks over a selection, or an existing block is
 * edited — because it is the same kind of statement about a range of days.
 */
/** NOTE: What the grid draws. All on by default. */
export interface GridLayers {
  readonly shifts: boolean;
  readonly timeOff: boolean;
  readonly presence: boolean;
  readonly requests: boolean;
}

export interface UiState {
  displayZone: DisplayZone;
  /** NOTE: Planning unit — a default filter, not a boundary (ADR-0020). */
  unitId: string;

  /**
   * NOTE: Overview and Schedule want different things from the same clock:
   * Overview pages through days around "now", Schedule pages through months
   * (ADR-0036). So each screen keeps its own remembered slice, and `range` is
   * the shared active range, overwritten by whichever page is mounted
   * (`enterOverview` / `enterSchedule`). `range` is stored, not computed in a
   * selector: a selector would return a new object on every call and repaint
   * the whole grid.
   */
  overview: { readonly anchor: IsoDate; readonly span: OverviewSpan };
  schedule: { readonly anchor: IsoDate; readonly zoom: ScheduleZoom };
  range: DateRange;

  activeShiftId: ShiftId | undefined;
  selection: Selection;
  /**
   * NOTE: The column the grid should scroll to.
   *
   * Needed separately from selection because a gap **has no person**: nobody
   * is assigned — that's what a gap is. A "fix this" link from the dashboard
   * can only point at a date, and pretending it points at a cell would
   * highlight a random row.
   */
  highlightDate: IsoDate | undefined;
  /** NOTE: Internal clipboard: person rows x day columns. */
  clipboard: (ShiftId | null)[][] | undefined;
  absenceDraft: AbsenceDraft | undefined;
  compDayDraft: CompDayEntry | undefined;
  /** NOTE: Which cell's audit timeline is open. Answering "was the request sent before
   * or after the schedule changed" needs one time axis per cell. */
  /** NOTE: `personId` absent means the whole day, everyone. */
  cellHistory: { readonly personId?: PersonId; readonly date: IsoDate } | undefined;
  /**
   * NOTE: Which facts the grid draws.
   *
   * A cell can carry a shift, an absence, where the person is, and something they have
   * asked for. All four at once is a lot in 62×32 pixels, and which of them you care
   * about depends on why you opened the screen — so they are layers you turn off rather
   * than a compromise nobody chose.
   */
  layers: GridLayers;
  /**
   * NOTE: Assignments locked from auto-populate.
   *
   * Session state, not part of the plan: a lock is a working note — "this is
   * already decided, don't touch it" — not a schedule fact worth publishing
   * or keeping in history.
   */
  lockedAssignmentIds: ReadonlySet<string>;

  /**
   * NOTE: How many Settings rows are edited and unsaved.
   *
   * Here rather than inside `useAdminEdits` because the only consumer is the masthead,
   * which has to ask before navigating away: admin edits live in component state, so
   * leaving the screen silently discarded every one of them.
   */
  unsavedAdminChanges: number;

  setDisplayZone: (zone: DisplayZone) => void;
  setUnsavedAdminChanges: (count: number) => void;
  setUnit: (unitId: string) => void;

  /** NOTE: Recompute the active `range` from this page's own slice on mount. */
  enterOverview: () => void;
  enterSchedule: () => void;
  setOverviewSpan: (span: OverviewSpan) => void;
  setOverviewAnchor: (anchor: IsoDate) => void;
  stepOverview: (direction: 1 | -1) => void;
  overviewToday: () => void;
  setScheduleZoom: (zoom: ScheduleZoom) => void;
  setScheduleAnchor: (anchor: IsoDate) => void;
  /** NOTE: A click on a day in the strip/scrubber: makes that date the start
   * of the period at the same length — unlike `setScheduleAnchor`, it doesn't
   * snap to the 1st of the month. */
  jumpScheduleTo: (date: IsoDate) => void;
  /** One day. The rota is walked along, not jumped through (ADR-0036 as amended). */
  stepSchedule: (direction: 1 | -1) => void;
  /** A whole month — the coarse companion to `stepSchedule`. */
  jumpScheduleMonths: (direction: 1 | -1) => void;
  scheduleToday: () => void;

  setActiveShift: (shiftId: ShiftId | undefined) => void;
  select: (cell: CellRef, extend?: boolean) => void;
  clearSelection: () => void;
  focusDate: (date: IsoDate, personId?: PersonId) => void;
  highlight: (date: IsoDate) => void;
  setClipboard: (rows: (ShiftId | null)[][]) => void;
  openAbsenceCreate: (targets: readonly AbsenceRangeTarget[]) => void;
  openAbsenceEdit: (absence: Absence) => void;
  closeAbsenceDialog: () => void;
  toggleLayer: (layer: keyof GridLayers) => void;
  openCellHistory: (personId: PersonId, date: IsoDate) => void;
  openDayHistory: (date: IsoDate) => void;
  closeCellHistory: () => void;
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
  clipboard: undefined,
  absenceDraft: undefined,
  cellHistory: undefined,
  layers: { shifts: true, timeOff: true, presence: true, requests: true },
  compDayDraft: undefined,
  lockedAssignmentIds: new Set(),
  unsavedAdminChanges: 0,

  setDisplayZone: (displayZone) => set({ displayZone }),
  setUnsavedAdminChanges: (unsavedAdminChanges) => set({ unsavedAdminChanges }),
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
    const next = stepAnchor(anchor, direction);
    set({ schedule: { anchor: next, zoom }, range: rangeFor(zoom, next) });
  },
  jumpScheduleMonths: (direction) => {
    const { anchor, zoom } = get().schedule;
    const next = jumpAnchorMonths(anchor, direction);
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
    // NOTE: Without a person there's nothing to select — but the column still needs scrolling to.
    if (!person) {
      set({ highlightDate: date });
      return;
    }
    const cell: CellRef = { personId: person, date };
    set({ selection: { anchor: cell, focus: cell }, highlightDate: date });
  },

  highlight: (highlightDate) => set({ highlightDate }),

  setClipboard: (clipboard) => set({ clipboard }),

  openAbsenceCreate: (targets) => {
    if (targets.length === 0) return;
    set({ absenceDraft: { mode: 'create', targets } });
  },
  openAbsenceEdit: (absence) => set({ absenceDraft: { mode: 'edit', absence } }),
  closeAbsenceDialog: () => set({ absenceDraft: undefined }),

  toggleLayer: (layer) =>
    set((state) => ({ layers: { ...state.layers, [layer]: !state.layers[layer] } })),

  openCellHistory: (personId, date) => set({ cellHistory: { personId, date } }),
  // NOTE: The whole day, everyone. A conflict is rarely one person's story.
  openDayHistory: (date) => set({ cellHistory: { date } }),
  closeCellHistory: () => set({ cellHistory: undefined }),

  openCompDayDialog: (entry) => set({ compDayDraft: entry }),
  closeCompDayDialog: () => set({ compDayDraft: undefined }),

  toggleLock: (assignmentId) => {
    const next = new Set(get().lockedAssignmentIds);
    if (next.has(assignmentId)) next.delete(assignmentId);
    else next.add(assignmentId);
    set({ lockedAssignmentIds: next });
  },
}));

/** NOTE: Selection rectangle in (row index, column index) coordinates. */
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
