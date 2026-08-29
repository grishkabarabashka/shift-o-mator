/**
 * NOTE: Planning grid — rows are people, columns are days. Hand-built by design (ADR-0014):
 * rectangular selection, paint mode, clipboard, and full keyboard control all require it.
 *
 * Three ways to assign a shift, from obvious to fast:
 *
 *   right-click          picker with the roles for **this day** and **this person**
 *   palette + click      paint by dragging
 *   role hotkey          applies to the whole selection
 *
 * Additional keys:
 *   arrows               move focus; Shift extends the selection
 *   Home / End           start and end of the row
 *   Delete / Backspace   clear
 *   Ctrl+C / Ctrl+V      copy and paste a range
 *   Ctrl+Z / Ctrl+Y      undo and redo
 */

/**
 * WHY: There is one context menu for the whole grid, and `PersonRow` is memoized on selection
 * primitives. Never pass a `bounds` object down here — it changes identity on every mouse move
 * and defeats the memoization.
 */

import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { Link } from 'react-router';
import { ALL_UNITS, type CellValue, type IsoDate, type PersonId, type Shift, type ShiftId } from '../../domain/types.ts';
import { isBlocked } from '../../engine/cellValue.ts';
import { useSchedule, type CellRef } from '../../store/useSchedule.ts';
import { selectionBounds, useUi, type GridLayers } from '../../store/useUi.ts';
import { columnsTemplate } from '../../ui/gridTemplate.ts';
import { useCapabilities } from '../../auth/useCapabilities.ts';
import { pendingAt } from '../../engine/requests.ts';
import { useDecideRequest } from '../../api/requests.ts';
import { useStagedCells } from '../../api/stagedCells.ts';
import { AssignmentPicker, type PendingApproval, type PickerTarget } from './AssignmentPicker.tsx';
import { CellSelfServiceMenu } from './CellSelfServiceMenu.tsx';
import { DayMenu, type DayMenuTarget } from './DayMenu.tsx';
import { GridCell, cellDomId } from './GridCell.tsx';
import { cellKey, type DayColumn, type GridRow, type PlanningView } from './usePlanningView.ts';

interface Props {
  readonly view: PlanningView;
  /**
   * WHY: External scroller ref — the coverage strip follows it horizontally. Keeping the strip
   * inside this same container didn't work: its height can't be constrained without breaking
   * sticky positioning, and without that constraint sixteen role rows push the roster itself
   * off screen.
   */
  readonly scrollerRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * WHY a second ref: the column width is computed from how much room the grid actually
   * has, and that is this element's `clientWidth` — the card around it keeps its full
   * width whether or not a vertical scrollbar has eaten fifteen pixels in here.
   */
  readonly measureRef?: (node: HTMLDivElement | null) => void;
}

export function PlanningGrid({ view, scrollerRef, measureRef }: Props) {
  const { rows, columns } = view;
  const setCells = useSchedule((s) => s.setCells);
  const startDraft = useSchedule((s) => s.startDraft);
  const undo = useSchedule((s) => s.undo);
  const redo = useSchedule((s) => s.redo);

  const selection = useUi((s) => s.selection);
  const highlightDate = useUi((s) => s.highlightDate);
  const select = useUi((s) => s.select);
  const clearSelection = useUi((s) => s.clearSelection);
  const activeShiftId = useUi((s) => s.activeShiftId);
  const clipboard = useUi((s) => s.clipboard);
  const setClipboard = useUi((s) => s.setClipboard);
  const openAbsenceCreate = useUi((s) => s.openAbsenceCreate);
  const openAbsenceEdit = useUi((s) => s.openAbsenceEdit);
  const openCompDayDialog = useUi((s) => s.openCompDayDialog);
  const lockedAssignmentIds = useUi((s) => s.lockedAssignmentIds);
  const layers = useUi((s) => s.layers);
  const toggleLock = useUi((s) => s.toggleLock);
  const openCellHistory = useUi((s) => s.openCellHistory);
  const openDayHistory = useUi((s) => s.openDayHistory);
  const caps = useCapabilities();
  // Advisory only: which cells somebody else is holding an unpublished edit on. Nothing
  // is locked — concurrent drafts are the design (ADR-0015) — but the second planner
  // deserves to know before filling the same week twice.
  const unitId = useUi((s) => s.unitId);
  const range = useUi((s) => s.range);
  const stagedByOthers = useStagedCells(unitId === ALL_UNITS ? undefined : unitId, range);
  const decide = useDecideRequest();
  const decideRequest = useCallback(
    (requestId: string, approve: boolean) =>
      decide.mutate({ id: requestId, decision: approve ? 'APPROVE' : 'REJECT' }),
    [decide],
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const [painting, setPainting] = useState(false);
  const [picker, setPicker] = useState<PickerTarget>();
  const [dayMenu, setDayMenu] = useState<DayMenuTarget>();

  const personRows = useMemo(
    () => rows.filter((row): row is Extract<GridRow, { kind: 'person' }> => row.kind === 'person'),
    [rows],
  );

  const rowIndexOf = useCallback(
    (personId: PersonId) => personRows.findIndex((row) => row.person.id === personId),
    [personRows],
  );
  const columnIndexOf = useCallback(
    (date: IsoDate) => columns.findIndex((column) => column.date === date),
    [columns],
  );

  const bounds = useMemo(
    () => selectionBounds(selection, rowIndexOf, columnIndexOf),
    [selection, rowIndexOf, columnIndexOf],
  );

  const selectedCells = useMemo<CellRef[]>(() => {
    if (!bounds) return [];
    const cells: CellRef[] = [];
    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      const person = personRows[row]?.person;
      if (!person) continue;
      for (let col = bounds.left; col <= bounds.right; col += 1) {
        const date = columns[col]?.date;
        if (date) cells.push({ personId: person.id, date });
      }
    }
    return cells;
  }, [bounds, personRows, columns]);

  /**
   * NOTE: Any edit opens the draft by itself (ADR-0023). An explicit Edit mode would be exactly
   * the wall a new user hits: they click a cell, nothing happens, and there's no way to tell
   * why. The draft still exists — visible via the Draft badge and the action panel — there's
   * just no need to enter it manually.
   */
  const withDraft = useCallback(
    async (apply: () => void) => {
      if (!useSchedule.getState().session) await startDraft();
      apply();
    },
    [startDraft],
  );

  /**
   * NOTE: An edit always goes through (ADR-0024). This used to silently drop cells covered by
   * an absence or a confirmed comp day — the planner clicked and nothing happened, the same
   * defect as a disabled right-click. Yet "someone comes in during their own leave" happens
   * constantly in practice. Now the assignment is recorded, the validator raises a CONFLICT,
   * the cell turns red, and publishing requires a confirmation with a comment.
   *
   * The one filter that remains is paint-by-dragging: nobody intends to bulk-fill a role over
   * other people's absences — that would be a twenty-cell mouse slip, not an edit.
   */
  const applyShift = useCallback(
    (cells: readonly CellRef[], shiftId: ShiftId | null, respectBlocks = false) => {
      const allowed = respectBlocks
        ? cells.filter((cell) => !isBlocked(view.cellAt(cell.personId, cell.date)))
        : cells;
      if (allowed.length > 0) void withDraft(() => setCells(allowed, shiftId));
    },
    [view, setCells, withDraft],
  );

  // -------------------------------------------------------------------------
  // NOTE: Mouse handling.
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!painting) return;
    const stop = () => setPainting(false);
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, [painting]);

  /** WHY: Cell under the cursor resolved via DOM lookup — one handler for the whole grid instead of 2480. */
  const cellAtEvent = useCallback((event: React.MouseEvent): CellRef | undefined => {
    const node = (event.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    const personId = node?.dataset['person'];
    const date = node?.dataset['date'];
    return personId && date ? { personId, date } : undefined;
  }, []);

  const onMouseDown = (event: React.MouseEvent) => {
    // NOTE: The right button must neither paint nor clear the selection — its job is to open
    // the picker, handled separately by the contextmenu listener.
    if (event.button !== 0) return;
    const cell = cellAtEvent(event);
    if (!cell) return;
    event.preventDefault();
    select(cell, event.shiftKey);
    setPainting(true);
    if (activeShiftId && !event.shiftKey) applyShift([cell], activeShiftId, true);
    wrapRef.current?.focus();
  };

  const onMouseOver = (event: React.MouseEvent) => {
    if (!painting) return;
    const cell = cellAtEvent(event);
    if (!cell) return;
    select(cell, true);
    if (activeShiftId) applyShift([cell], activeShiftId, true);
  };

  /**
   * Opens the one shared picker for `cell`, anchored at (`x`, `y`).
   *
   * WHY extracted: this used to live inside the right-click handler, which meant the
   * picker could only be reached with a pointer. The keyboard route (Shift+F10 / Menu)
   * needs the identical behaviour anchored at the focused cell instead of the cursor.
   */
  const openPickerFor = (cell: CellRef, x: number, y: number) => {
    // NOTE: Acting inside the selection acts on the whole selection; outside it moves it.
    const inSelection = selectedCells.some(
      (selected) => selected.personId === cell.personId && selected.date === cell.date,
    );
    if (!inSelection) select(cell, false);

    const person = personRows.find((row) => row.person.id === cell.personId)?.person;
    const value = view.cellAt(cell.personId, cell.date);
    const status = value.kind === 'STATUS' ? value.status : undefined;
    // The absence names itself now (ADR-0049); only the comp day needs wording here.
    const event = value.kind === 'STATUS' ? value.event : undefined;
    const lockReason =
      status === 'ABSENT'
        ? `On ${(event?.shortLabel ?? 'leave').toLowerCase()}`
        : status === 'COMP_OFF'
          ? 'On a confirmed comp day'
          : undefined;

    const assignmentId = value.kind === 'SHIFT' ? value.assignmentId : undefined;

    setPicker({
      personId: cell.personId,
      personName: person?.displayName ?? cell.personId,
      unitId: person?.unitId,
      date: cell.date,
      value,
      shifts: view.shiftsFor(cell.personId, cell.date),
      otherShifts: view.otherShiftsFor(cell.personId, cell.date),
      locked: lockReason !== undefined,
      lockReason,
      assignmentId,
      generationLocked: assignmentId !== undefined && lockedAssignmentIds.has(assignmentId),
      x,
      y,
      affected: inSelection ? selectedCells.length : 1,
    });
  };

  const onContextMenu = (event: React.MouseEvent) => {
    const cell = cellAtEvent(event);
    if (!cell) return;
    event.preventDefault();
    openPickerFor(cell, event.clientX, event.clientY);
  };

  /** Keyboard equivalent of a right-click: anchor the picker on the focused cell. */
  const openPickerAtFocus = () => {
    const focus = selection.focus;
    if (!focus) return;
    const node = wrapRef.current?.querySelector<HTMLElement>(
      `[data-cell][data-person="${focus.personId}"][data-date="${focus.date}"]`,
    );
    const rect = node?.getBoundingClientRect();
    openPickerFor(focus, rect ? rect.left : 0, rect ? rect.bottom : 0);
  };

  const closePicker = useCallback(() => setPicker(undefined), []);

  /** NOTE: Picker items act on the selection when the click landed inside it. */
  const pickerCells = useCallback((): CellRef[] => {
    if (!picker) return [];
    return picker.affected > 1
      ? selectedCells
      : [{ personId: picker.personId, date: picker.date }];
  }, [picker, selectedCells]);

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  const moveFocus = useCallback(
    (deltaRow: number, deltaColumn: number, extend: boolean) => {
      const focus = selection.focus;
      const row = focus ? rowIndexOf(focus.personId) : 0;
      const col = focus ? columnIndexOf(focus.date) : 0;
      const nextRow = Math.min(Math.max(row + deltaRow, 0), personRows.length - 1);
      const nextCol = Math.min(Math.max(col + deltaColumn, 0), columns.length - 1);
      const person = personRows[nextRow]?.person;
      const date = columns[nextCol]?.date;
      if (person && date) select({ personId: person.id, date }, extend);
    },
    [selection.focus, rowIndexOf, columnIndexOf, personRows, columns, select],
  );

  const copySelection = useCallback(() => {
    if (!bounds) return;
    const grid: (ShiftId | null)[][] = [];
    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      const person = personRows[row]?.person;
      const line: (ShiftId | null)[] = [];
      for (let col = bounds.left; col <= bounds.right; col += 1) {
        const date = columns[col]?.date;
        const value = person && date ? view.cellAt(person.id, date) : undefined;
        line.push(value?.kind === 'SHIFT' ? value.shiftId : null);
      }
      grid.push(line);
    }
    setClipboard(grid);
  }, [bounds, personRows, columns, view, setClipboard]);

  /** NOTE: Paste tiles from the top-left corner of the selection. */
  const pasteClipboard = useCallback(() => {
    if (!clipboard || !bounds) return;
    const byShift = new Map<ShiftId | null, CellRef[]>();

    for (let row = 0; row < clipboard.length; row += 1) {
      const line = clipboard[row];
      if (!line) continue;
      const person = personRows[bounds.top + row]?.person;
      if (!person) continue;
      for (let col = 0; col < line.length; col += 1) {
        const date = columns[bounds.left + col]?.date;
        if (!date) continue;
        const shiftId = line[col] ?? null;
        const bucket = byShift.get(shiftId);
        if (bucket) bucket.push({ personId: person.id, date });
        else byShift.set(shiftId, [{ personId: person.id, date }]);
      }
    }

    for (const [shiftId, cells] of byShift) applyShift(cells, shiftId);
  }, [clipboard, bounds, personRows, columns, applyShift]);

  const shiftByHotkey = useMemo(() => {
    const map = new Map<string, Shift>();
    for (const shift of view.coverageShifts) {
      if (shift.hotkey && !map.has(shift.hotkey.toLowerCase())) {
        map.set(shift.hotkey.toLowerCase(), shift);
      }
    }
    return map;
  }, [view.coverageShifts]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const { key, shiftKey, ctrlKey, metaKey } = event;

    if (ctrlKey || metaKey) {
      const lower = key.toLowerCase();
      if (lower === 'z') {
        event.preventDefault();
        if (shiftKey) redo();
        else undo();
      } else if (lower === 'y') {
        event.preventDefault();
        redo();
      } else if (lower === 'c') {
        event.preventDefault();
        copySelection();
      } else if (lower === 'v') {
        event.preventDefault();
        pasteClipboard();
      }
      return;
    }

    switch (key) {
      case 'ArrowUp':
        event.preventDefault();
        return moveFocus(-1, 0, shiftKey);
      case 'ArrowDown':
        event.preventDefault();
        return moveFocus(1, 0, shiftKey);
      case 'ArrowLeft':
        event.preventDefault();
        return moveFocus(0, -1, shiftKey);
      case 'ArrowRight':
        event.preventDefault();
        return moveFocus(0, 1, shiftKey);
      // NOTE: Tab is deliberately NOT handled. It used to move the cursor one cell right,
      // which made the grid a keyboard trap: once focus landed here there was no way out
      // of it without a pointer. Arrow keys move within the grid; Tab leaves it, as it
      // does everywhere else.
      case 'F10':
        // Shift+F10 and the Menu key are the standard keyboard route to a context menu.
        // Without them the assignment picker — the only way to reach half the cell
        // actions — was reachable by right-click alone.
        if (!shiftKey) break;
        event.preventDefault();
        return openPickerAtFocus();
      case 'ContextMenu':
        event.preventDefault();
        return openPickerAtFocus();
      case 'Home':
        event.preventDefault();
        return moveFocus(0, -columns.length, shiftKey);
      case 'End':
        event.preventDefault();
        return moveFocus(0, columns.length, shiftKey);
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        return applyShift(selectedCells, null);
      case 'Escape':
        event.preventDefault();
        return clearSelection();
      default:
        break;
    }

    const shift = shiftByHotkey.get(key.toLowerCase());
    if (shift) {
      event.preventDefault();
      applyShift(selectedCells, shift.id);
    }
  };

  useEffect(() => {
    wrapRef.current?.querySelector('[data-focused]')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [selection.focus]);

  // NOTE: Arriving from the dashboard via a gap only carries a date, so we scroll
  // to the column, not to a cell.
  useEffect(() => {
    if (!highlightDate) return;
    wrapRef.current
      ?.querySelector(`.sheet__head[data-date="${highlightDate}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [highlightDate]);

  /**
   * Requests covering the *selection* that this caller can act on, de-duplicated: one
   * request spanning five painted cells is one decision, not five.
   *
   * WHY the whole selection and not the clicked cell: painting a week and right-clicking
   * it is how the approvals actually get done, and reading only the anchor meant no
   * Approve button whenever the click landed on a day the request did not cover.
   *
   * A request the caller cannot decide is still drawn in the cell; offering buttons that
   * would 403 is worse than offering nothing.
   */
  const pendingFor = (cells: readonly CellRef[]): PendingApproval[] => {
    const seen = new Map<string, PendingApproval>();
    for (const cell of cells) {
      const request = pendingAt(view.requests, cell.personId, cell.date);
      // `callerCanDecide` comes from the server, which resolved the approvers of the
      // subject's unit — the client has no business recomputing that.
      if (!request || !request.callerCanDecide || seen.has(request.id)) continue;
      seen.set(request.id, {
        requestId: request.id,
        label: request.typeLabel,
        subjectName: request.subjectDisplayName,
        from: request.from,
        to: request.to,
      });
    }
    return [...seen.values()];
  };

  const template = columnsTemplate(columns.length);

  return (
    <div
      className="grid-wrap"
      ref={(node) => {
        wrapRef.current = node;
        if (scrollerRef) scrollerRef.current = node;
        measureRef?.(node);
      }}
      tabIndex={0}
      role="grid"
      aria-label="Planning grid"
      // NOTE: `aria-colcount` only. Row indices are deliberately omitted: group headers
      // are rows in the DOM but not in the selection model, so any number published here
      // would disagree with one of the two. A wrong index is worse than none.
      aria-colcount={columns.length + 1}
      // The virtual cursor: DOM focus stays on this scroller (2500 focusable cells would
      // be unusable), so this is what tells assistive tech which cell is current.
      aria-activedescendant={
        selection.focus ? cellDomId(selection.focus.personId, selection.focus.date) : undefined
      }
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      onMouseOver={onMouseOver}
      onContextMenu={onContextMenu}
    >
      <div
        className="sheet"
        // Drives the layout swap below: with shifts hidden there is no chip to leave room
        // for, so presence takes the whole cell instead of staying a 9px strip.
        data-shifts={layers.shifts ? undefined : 'off'}
        // Two months is ~60 columns, which is ~3700px at the normal width — a horizontal
        // scroll on any screen, and the shift codes stopped fitting. Narrower columns and
        // smaller type here only; the month view is unchanged.
        data-dense={columns.length > 45 || undefined}
        style={{ gridTemplateColumns: template }}
      >
        {/* WHY the wrappers: `role="grid"` with `gridcell` children and no `row` between
            them is an invalid ARIA tree — a screen reader announces no rows and no
            position. The grid is laid out with CSS Grid, so a real wrapper element would
            break the layout; `.sheet__row { display: contents }` gives the accessibility
            tree a row without giving the layout a box. */}
        <div className="sheet__row" role="row">
          <div className="sheet__corner" role="columnheader" aria-colindex={1}>
            Team member
          </div>
          {columns.map((column, columnIndex) => (
            <ColumnHead
              key={column.date}
              column={column}
              colIndex={columnIndex + 2}
              highlighted={column.date === highlightDate}
              onOpenMenu={setDayMenu}
            />
          ))}
        </div>

        {rows.map((row) =>
          row.kind === 'group' ? (
            <GroupRow
              key={row.key}
              label={row.label}
              count={row.count}
              level={row.level}
              span={columns.length}
            />
          ) : (
            <PersonRow
              key={row.key}
              row={row}
              view={view}
              columns={columns}
              rowIndex={rowIndexOf(row.person.id)}
              selTop={bounds?.top ?? -1}
              selBottom={bounds?.bottom ?? -1}
              selLeft={bounds?.left ?? -1}
              selRight={bounds?.right ?? -1}
              focusDate={
                selection.focus?.personId === row.person.id ? selection.focus.date : undefined
              }
              lockedAssignmentIds={lockedAssignmentIds}
              layers={layers}
              isSelf={row.person.id === view.selfId}
              stagedByOthers={stagedByOthers}
              banded={rowIndexOf(row.person.id) % 2 === 1}
              roomy={columns.length <= 12}
            />
          ),
        )}
      </div>

      {picker ? (
        <AssignmentPicker
          target={picker}
          onClose={closePicker}
          onPickShift={(shiftId) => applyShift(pickerCells(), shiftId)}
          onAbsence={() => {
            const existing = picker.value.kind === 'STATUS' ? picker.value.absenceId : undefined;
            const absence = existing ? view.absenceById(existing) : undefined;
            if (absence) openAbsenceEdit(absence);
            else {
              openAbsenceCreate(
                pickerCells().map((cell) => ({
                  personId: cell.personId,
                  from: cell.date,
                  to: cell.date,
                })),
              );
            }
          }}
          // A comp day is placed by the person taking it, or by a planner of their unit
          // on their behalf (ADR-0052). It used to be offered on everybody's row to
          // everybody, which is how a viewer ended up looking at a dialog full of actions
          // they could not take.
          onCompDay={
            compDayIdOf(picker) === undefined ||
            !(caps.isSelf(picker.personId) || caps.canPlan(picker.unitId))
              ? undefined
              : () => {
                  const entry = view.compDayById(compDayIdOf(picker) ?? '');
                  if (entry) openCompDayDialog(entry);
                }
          }
          onToggleLock={
            picker.assignmentId ? () => toggleLock(picker.assignmentId!) : undefined
          }
          // Scoped to the row's own unit: planning AMER grants nothing over an EMEA
          // engineer's row (ADR-0051).
          canEditPlan={caps.canPlan(picker.unitId)}
          // Self-service on your own row; a planner of that unit may also act for others.
          canRequest={caps.canPlan(picker.unitId) || caps.isSelf(picker.personId)}
          selfService={
            <CellSelfServiceMenu
              cells={pickerCells()}
              subjectPersonId={picker.personId}
              subjectUnitId={picker.unitId}
              closedOut={
                picker.value.kind === 'STATUS' && picker.value.status === 'ABSENT'
              }
              locations={view.locations}
              // Recorded presence over the selected cells. A day can be overwritten but
              // could not be taken back — half a Saturday marked by accident stayed there
              // — and the shifts on the same cells have always had a Clear.
              presenceIds={[
                ...new Set(
                  pickerCells()
                    .map((cell) => view.presence.byCell.get(cellKey(cell.personId, cell.date))?.recordId)
                    .filter((id): id is string => id !== undefined),
                ),
              ]}
              onMore={() =>
                openAbsenceCreate(
                  pickerCells().map((cell) => ({
                    personId: cell.personId,
                    from: cell.date,
                    to: cell.date,
                  })),
                )
              }
              onDone={closePicker}
            />
          }
          onShowHistory={() => openCellHistory(picker.personId, picker.date)}
          pending={pendingFor(pickerCells())}
          onDecide={caps.approvesSomewhere ? decideRequest : undefined}
        />
      ) : null}

      {dayMenu ? (
        <DayMenu
          target={dayMenu}
          onClose={() => setDayMenu(undefined)}
          onShowHistory={() => openDayHistory(dayMenu.date)}
        />
      ) : null}
    </div>
  );
}

/** NOTE: A boolean, not the id: `GridCell` is memoized on primitives (CLAUDE.md). */
function proposedCompDayAt(value: CellValue): boolean {
  return (value.kind === 'EMPTY' || value.kind === 'SHIFT') && value.proposedCompDay !== undefined;
}

function compDayIdOf(picker: PickerTarget): string | undefined {
  const { value } = picker;
  if (value.kind === 'STATUS') return value.compDayId;
  return value.proposedCompDay;
}

function ColumnHead({
  column,
  colIndex,
  highlighted,
  onOpenMenu,
}: {
  readonly column: DayColumn;
  readonly colIndex: number;
  readonly highlighted: boolean;
  readonly onOpenMenu: (target: DayMenuTarget) => void;
}) {
  return (
    <div
      className="sheet__head"
      role="columnheader"
      aria-colindex={colIndex}
      // Right-click opens a menu, the same as it does on a cell. It used to open the
      // history dialog outright -- the one right-click in the grid that produced no menu.
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenMenu({ date: column.date, x: event.clientX, y: event.clientY });
      }}
      data-date={column.date}
      data-highlight={highlighted || undefined}
      data-nonworking={column.isNonWorking || undefined}
      data-holiday={column.holidayName !== undefined || undefined}
      data-today={column.isToday || undefined}
      title={`${column.holidayName ? `${column.date} · ${column.holidayName}` : column.date}
Right-click for this day’s actions`}
    >
      <span className="sheet__head-wd">{column.weekdayLabel}</span>
      {/* NOTE: Entry point to the day drill-down via the column header.
          Not data-cell, so the grid's delegated mouse handler leaves it alone. */}
      <Link
        to={`/schedule/day/${column.date}`}
        className="sheet__head-num sheet__head-num--link"
        title="Open the hourly view for this day"
      >
        {column.dayLabel}
      </Link>
    </div>
  );
}

function GroupRow({
  label,
  count,
  level,
  span,
}: {
  readonly label: string;
  readonly count: number;
  readonly level: 1 | 2;
  readonly span: number;
}) {
  return (
    <div className="sheet__row" role="row">
      {/* NOTE: Level comes from the data, indentation is presentation only: a nested
          group shifts and loses saturation so the unit reads as a frame and the
          location inside it as part of that frame. */}
      <div className="sheet__group" role="rowheader" aria-colindex={1} data-level={level}>
        <span className="truncate">{label}</span>
        <span className="sheet__group-count">{count}</span>
      </div>
      {/* Presentational: one wide box standing in for the rest of the row. It carries
          nothing the group header has not already announced, and marking it a gridcell
          would put a cell in the tree that holds no cell. */}
      <div
        className="sheet__group-fill"
        role="presentation"
        data-level={level}
        style={{ gridColumn: `span ${span}` }}
      />
    </div>
  );
}

interface PersonRowProps {
  readonly row: Extract<GridRow, { kind: 'person' }>;
  readonly view: PlanningView;
  readonly columns: readonly DayColumn[];
  readonly rowIndex: number;
  readonly selTop: number;
  readonly selBottom: number;
  readonly selLeft: number;
  readonly selRight: number;
  readonly focusDate: IsoDate | undefined;
  readonly lockedAssignmentIds: ReadonlySet<string>;
  readonly layers: GridLayers;
  /** NOTE: Your own line. Marked so you can find yourself in eighty rows. */
  readonly isSelf: boolean;
  /** NOTE: Cells another planner is holding an unpublished edit on, keyed the same way
   * every other projection is. Advisory only — nothing here is locked (ADR-0015). */
  readonly stagedByOthers: ReadonlyMap<string, string>;
  /** NOTE: Every other person row is tinted. Twenty-seven rows of 32px with nothing
   * between them is a place to lose your line in, and the grid has no vertical rules. */
  readonly banded: boolean;
  /** NOTE: Wide columns — the week zoom. Passed down rather than measured per cell. */
  readonly roomy: boolean;
}

const PersonRow = memo(function PersonRow({
  row,
  view,
  columns,
  rowIndex,
  selTop,
  selBottom,
  selLeft,
  selRight,
  focusDate,
  lockedAssignmentIds,
  layers,
  isSelf,
  stagedByOthers,
  banded,
  roomy,
}: PersonRowProps) {
  const { person, location } = row;
  const rowSelected = rowIndex >= selTop && rowIndex <= selBottom;

  return (
    <div className="sheet__row" role="row" data-self={isSelf || undefined}>
      <div
        className="sheet__name"
        role="rowheader"
        aria-colindex={1}
        data-self={isSelf || undefined}
        data-band={banded || undefined}
        title={`${person.displayName} · ${location.name}`}
      >
        <span className="truncate">{person.displayName}</span>
        {isSelf ? <span className="sheet__name-you">you</span> : null}
      </div>
      {columns.map((column, columnIndex) => {
        const key = cellKey(person.id, column.date);
        const value = view.cellAt(person.id, column.date);
        return (
          <GridCell
            key={key}
            personId={person.id}
            personName={person.displayName}
            date={column.date}
            value={layers.shifts && layers.timeOff ? value : maskLayers(value, layers)}
            shift={value.kind === 'SHIFT' ? view.shiftById(value.shiftId) : undefined}
            issues={view.issuesByCell.get(key) ?? EMPTY_ISSUES}
            nonWorking={view.projection.nonWorkingByCell.has(key)}
            today={column.isToday}
            selected={rowSelected && columnIndex >= selLeft && columnIndex <= selRight}
            focused={focusDate === column.date}
            generationLocked={value.kind === 'SHIFT' && lockedAssignmentIds.has(value.assignmentId)}
            colIndex={columnIndex + 2}
            isSelf={isSelf}
            presenceGlyph={layers.presence ? view.presence.byCell.get(key)?.glyph : undefined}
            presenceLabel={view.presence.byCell.get(key)?.label}
            presencePortion={view.presence.byCell.get(key)?.portion}
            presenceColor={view.presence.byCell.get(key)?.color}
            proposedCompDay={proposedCompDayAt(value)}
            presenceAtBaseline={view.presence.byCell.get(key)?.atBaseline}
            pendingGlyph={layers.requests ? view.requests.byCell.get(key)?.glyph : undefined}
            pendingLabel={view.requests.byCell.get(key)?.label}
            pendingPortion={view.requests.byCell.get(key)?.portion}
            stagedBy={stagedByOthers.get(key)}
            banded={banded}
            roomy={roomy}
          />
        );
      })}
    </div>
  );
});

/** WHY: Shared empty reference — otherwise every violation-free cell would break memo. */
const EMPTY_ISSUES: readonly never[] = [];

/**
 * Hides the parts of a cell whose layer is switched off.
 *
 * Applied at the last moment rather than in the projection, so turning a layer back on
 * costs a render and not a recompute of the whole month.
 */
function maskLayers(value: CellValue, layers: GridLayers): CellValue {
  if (value.kind === 'SHIFT') {
    if (!layers.shifts) {
      // The shift is hidden, but an absence underneath it is not the shift — it becomes
      // the cell's own content rather than disappearing with it.
      if (!layers.timeOff || !value.event) return { kind: 'EMPTY' };
      return value.absenceId
        ? { kind: 'STATUS', status: 'ABSENT', event: value.event, absenceId: value.absenceId }
        : { kind: 'STATUS', status: 'ABSENT', event: value.event };
    }
    if (layers.timeOff) return value;
    const { event: _event, absenceId: _absenceId, ...withoutAbsence } = value;
    return withoutAbsence;
  }

  if (value.kind === 'STATUS' && value.status === 'ABSENT' && !layers.timeOff) {
    return { kind: 'EMPTY' };
  }

  return value;
}
