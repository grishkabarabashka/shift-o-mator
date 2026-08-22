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
import type { IsoDate, PersonId, Shift, ShiftId } from '../../domain/types.ts';
import { isBlocked } from '../../engine/cellValue.ts';
import { useSchedule, type CellRef } from '../../store/useSchedule.ts';
import { selectionBounds, useUi } from '../../store/useUi.ts';
import { columnsTemplate } from '../../ui/gridTemplate.ts';
import { AssignmentPicker, type PickerTarget } from './AssignmentPicker.tsx';
import { GridCell } from './GridCell.tsx';
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
}

export function PlanningGrid({ view, scrollerRef }: Props) {
  const { rows, columns } = view;
  const setCells = useSchedule((s) => s.setCells);
  const setMarker = useSchedule((s) => s.setMarker);
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
  const toggleLock = useUi((s) => s.toggleLock);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [painting, setPainting] = useState(false);
  const [picker, setPicker] = useState<PickerTarget>();

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

  const applyMarker = useCallback(
    (cells: readonly CellRef[], marker: 'OFF' | 'NOT_SCHEDULED') => {
      if (cells.length > 0) void withDraft(() => setMarker(cells, marker));
    },
    [setMarker, withDraft],
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

  const onContextMenu = (event: React.MouseEvent) => {
    const cell = cellAtEvent(event);
    if (!cell) return;
    event.preventDefault();

    // NOTE: A click inside the selection acts on the whole selection; a click outside moves it.
    const inSelection = selectedCells.some(
      (selected) => selected.personId === cell.personId && selected.date === cell.date,
    );
    if (!inSelection) select(cell, false);

    const person = personRows.find((row) => row.person.id === cell.personId)?.person;
    const value = view.cellAt(cell.personId, cell.date);
    const status = value.kind === 'STATUS' ? value.status : undefined;
    const lockReason =
      status === 'VACATION'
        ? 'On leave'
        : status === 'SICK'
          ? 'Off sick'
          : status === 'OTHER'
            ? 'Absent'
            : status === 'COMP_OFF'
              ? 'On a confirmed comp day'
              : undefined;

    const assignmentId = value.kind === 'SHIFT' ? value.assignmentId : undefined;

    setPicker({
      personId: cell.personId,
      personName: person?.displayName ?? cell.personId,
      date: cell.date,
      value,
      shifts: view.shiftsFor(cell.personId, cell.date),
      otherShifts: view.otherShiftsFor(cell.personId, cell.date),
      locked: lockReason !== undefined,
      lockReason,
      assignmentId,
      generationLocked: assignmentId !== undefined && lockedAssignmentIds.has(assignmentId),
      x: event.clientX,
      y: event.clientY,
      affected: inSelection ? selectedCells.length : 1,
    });
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
      case 'Tab':
        event.preventDefault();
        return moveFocus(0, 1, shiftKey && key === 'ArrowRight');
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

  const template = columnsTemplate(columns.length);

  return (
    <div
      className="grid-wrap"
      ref={(node) => {
        wrapRef.current = node;
        if (scrollerRef) scrollerRef.current = node;
      }}
      tabIndex={0}
      role="grid"
      aria-label="Planning grid"
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      onMouseOver={onMouseOver}
      onContextMenu={onContextMenu}
    >
      <div className="sheet" style={{ gridTemplateColumns: template }}>
        <div className="sheet__corner">Team member</div>
        {columns.map((column) => (
          <ColumnHead
            key={column.date}
            column={column}
            highlighted={column.date === highlightDate}
          />
        ))}

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
            />
          ),
        )}
      </div>

      {picker ? (
        <AssignmentPicker
          target={picker}
          onClose={closePicker}
          onPickShift={(shiftId) => applyShift(pickerCells(), shiftId)}
          onPickMarker={(marker) => applyMarker(pickerCells(), marker)}
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
          onCompDay={
            compDayIdOf(picker) === undefined
              ? undefined
              : () => {
                  const entry = view.compDayById(compDayIdOf(picker) ?? '');
                  if (entry) openCompDayDialog(entry);
                }
          }
          onToggleLock={
            picker.assignmentId ? () => toggleLock(picker.assignmentId!) : undefined
          }
        />
      ) : null}
    </div>
  );
}

function compDayIdOf(picker: PickerTarget): string | undefined {
  const { value } = picker;
  if (value.kind === 'STATUS') return value.compDayId;
  return value.proposedCompDay;
}

function ColumnHead({
  column,
  highlighted,
}: {
  readonly column: DayColumn;
  readonly highlighted: boolean;
}) {
  return (
    <div
      className="sheet__head"
      data-date={column.date}
      data-highlight={highlighted || undefined}
      data-nonworking={column.isNonWorking || undefined}
      data-holiday={column.holidayName !== undefined || undefined}
      data-today={column.isToday || undefined}
      title={column.holidayName ? `${column.date} · ${column.holidayName}` : column.date}
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
    <>
      {/* NOTE: Level comes from the data, indentation is presentation only: a nested
          group shifts and loses saturation so the unit reads as a frame and the
          location inside it as part of that frame. */}
      <div className="sheet__group" data-level={level}>
        <span className="truncate">{label}</span>
        <span className="sheet__group-count">{count}</span>
      </div>
      <div className="sheet__group-fill" data-level={level} style={{ gridColumn: `span ${span}` }} />
    </>
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
}: PersonRowProps) {
  const { person, location } = row;
  const rowSelected = rowIndex >= selTop && rowIndex <= selBottom;

  return (
    <>
      <div className="sheet__name" title={`${person.displayName} · ${location.name}`}>
        <span className="truncate">{person.displayName}</span>
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
            value={value}
            shift={value.kind === 'SHIFT' ? view.shiftById(value.shiftId) : undefined}
            issues={view.issuesByCell.get(key) ?? EMPTY_ISSUES}
            nonWorking={view.projection.nonWorkingByCell.has(key)}
            today={column.isToday}
            selected={rowSelected && columnIndex >= selLeft && columnIndex <= selRight}
            focused={focusDate === column.date}
            generationLocked={value.kind === 'SHIFT' && lockedAssignmentIds.has(value.assignmentId)}
          />
        );
      })}
    </>
  );
});

/** WHY: Shared empty reference — otherwise every violation-free cell would break memo. */
const EMPTY_ISSUES: readonly never[] = [];
