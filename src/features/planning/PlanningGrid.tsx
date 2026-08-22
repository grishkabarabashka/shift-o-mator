/**
 * Сетка планирования: строки — люди, колонки — дни.
 *
 * Написана руками намеренно (ADR-0014): нужны выделение прямоугольником,
 * paint-режим, буфер обмена и полный контроль над клавиатурой.
 *
 * Три пути назначения, от очевидного к быстрому:
 *
 *   правый клик       пикер с ролями **этого дня** для **этого человека**
 *   палитра + клик    раскраска протаскиванием
 *   хоткей роли       на всё выделение
 *
 * Дополнительно:
 *   стрелки            перемещение, с Shift — расширение выделения
 *   Home / End         начало и конец строки
 *   Delete / Backspace очистить
 *   Ctrl+C / Ctrl+V    копировать и вставить диапазон
 *   Ctrl+Z / Ctrl+Y    отмена и повтор
 *
 * Производительность: контекстное меню одно на всю сетку, а `PersonRow`
 * мемоизирован по примитивам выделения. Передавать сюда объект `bounds` нельзя —
 * он меняет идентичность на каждое движение мыши и обнуляет мемоизацию.
 */

import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { Link } from 'react-router';
import type { IsoDate, PersonId, RoleId, ShiftRole } from '../../domain/types.ts';
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
   * Скроллер сетки наружу: за ним по горизонтали следует полоса покрытия.
   * Держать её в этом же контейнере не вышло — ограничить её высоту, не сломав
   * прилипание, там невозможно, а без ограничения шестнадцать ролевых строк
   * вытесняют сам ростер.
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
  const activeRoleId = useUi((s) => s.activeRoleId);
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
   * Любая правка сама открывает черновик (ADR-0023).
   *
   * Явный режим Edit был бы ровно той стеной, о которую бьётся новый
   * пользователь: он кликает по ячейке, ничего не происходит, и понять почему
   * неоткуда. Черновик остаётся — он виден по бейджу Draft и панели действий,
   * — но входить в него вручную не нужно.
   */
  const withDraft = useCallback(
    async (apply: () => void) => {
      if (!useSchedule.getState().session) await startDraft();
      apply();
    },
    [startDraft],
  );

  /**
   * Правка проходит всегда (ADR-0024).
   *
   * Раньше здесь отбрасывались ячейки, закрытые отпуском или подтверждённым
   * отгулом. Отбрасывались молча — планировщик кликал, и не происходило
   * ничего: тот же дефект, что и с выключенным правым кликом. При этом сама
   * ситуация «человек вышел в свой отпуск» встречается в жизни постоянно.
   * Теперь назначение записывается, валидатор поднимает CONFLICT, ячейка
   * краснеет, а публикация требует подтверждения с комментарием.
   *
   * Единственный оставшийся фильтр — раскраска протаскиванием: массово
   * заливать роль поверх чужих отпусков никто не собирался, это была бы не
   * правка, а промах мыши на двадцать ячеек.
   */
  const applyRole = useCallback(
    (cells: readonly CellRef[], roleId: RoleId | null, respectBlocks = false) => {
      const allowed = respectBlocks
        ? cells.filter((cell) => !isBlocked(view.cellAt(cell.personId, cell.date)))
        : cells;
      if (allowed.length > 0) void withDraft(() => setCells(allowed, roleId));
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
  // Мышь
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!painting) return;
    const stop = () => setPainting(false);
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, [painting]);

  /** Ячейка под курсором по DOM: один обработчик на сетку вместо 2480. */
  const cellAtEvent = useCallback((event: React.MouseEvent): CellRef | undefined => {
    const node = (event.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    const personId = node?.dataset['person'];
    const date = node?.dataset['date'];
    return personId && date ? { personId, date } : undefined;
  }, []);

  const onMouseDown = (event: React.MouseEvent) => {
    // Правая кнопка не должна ни рисовать, ни сбрасывать выделение: её работа —
    // открыть пикер, что делает отдельный обработчик contextmenu.
    if (event.button !== 0) return;
    const cell = cellAtEvent(event);
    if (!cell) return;
    event.preventDefault();
    select(cell, event.shiftKey);
    setPainting(true);
    if (activeRoleId && !event.shiftKey) applyRole([cell], activeRoleId, true);
    wrapRef.current?.focus();
  };

  const onMouseOver = (event: React.MouseEvent) => {
    if (!painting) return;
    const cell = cellAtEvent(event);
    if (!cell) return;
    select(cell, true);
    if (activeRoleId) applyRole([cell], activeRoleId, true);
  };

  const onContextMenu = (event: React.MouseEvent) => {
    const cell = cellAtEvent(event);
    if (!cell) return;
    event.preventDefault();

    // Клик внутри выделения работает по всему выделению; мимо — переносит его.
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

    const assignmentId = value.kind === 'ROLE' ? value.assignmentId : undefined;

    setPicker({
      personId: cell.personId,
      personName: person?.displayName ?? cell.personId,
      date: cell.date,
      value,
      roles: view.rolesFor(cell.personId, cell.date),
      otherRoles: view.otherRolesFor(cell.personId, cell.date),
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

  /** Пункты пикера действуют на выделение, если клик был внутри него. */
  const pickerCells = useCallback((): CellRef[] => {
    if (!picker) return [];
    return picker.affected > 1
      ? selectedCells
      : [{ personId: picker.personId, date: picker.date }];
  }, [picker, selectedCells]);

  // -------------------------------------------------------------------------
  // Клавиатура
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
    const grid: (RoleId | null)[][] = [];
    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      const person = personRows[row]?.person;
      const line: (RoleId | null)[] = [];
      for (let col = bounds.left; col <= bounds.right; col += 1) {
        const date = columns[col]?.date;
        const value = person && date ? view.cellAt(person.id, date) : undefined;
        line.push(value?.kind === 'ROLE' ? value.roleId : null);
      }
      grid.push(line);
    }
    setClipboard(grid);
  }, [bounds, personRows, columns, view, setClipboard]);

  /** Вставка тайлится от левого верхнего угла выделения. */
  const pasteClipboard = useCallback(() => {
    if (!clipboard || !bounds) return;
    const byRole = new Map<RoleId | null, CellRef[]>();

    for (let row = 0; row < clipboard.length; row += 1) {
      const line = clipboard[row];
      if (!line) continue;
      const person = personRows[bounds.top + row]?.person;
      if (!person) continue;
      for (let col = 0; col < line.length; col += 1) {
        const date = columns[bounds.left + col]?.date;
        if (!date) continue;
        const roleId = line[col] ?? null;
        const bucket = byRole.get(roleId);
        if (bucket) bucket.push({ personId: person.id, date });
        else byRole.set(roleId, [{ personId: person.id, date }]);
      }
    }

    for (const [roleId, cells] of byRole) applyRole(cells, roleId);
  }, [clipboard, bounds, personRows, columns, applyRole]);

  const roleByHotkey = useMemo(() => {
    const map = new Map<string, ShiftRole>();
    for (const role of view.coverageRoles) {
      if (role.hotkey && !map.has(role.hotkey.toLowerCase())) {
        map.set(role.hotkey.toLowerCase(), role);
      }
    }
    return map;
  }, [view.coverageRoles]);

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
        return applyRole(selectedCells, null);
      case 'Escape':
        event.preventDefault();
        return clearSelection();
      default:
        break;
    }

    const role = roleByHotkey.get(key.toLowerCase());
    if (role) {
      event.preventDefault();
      applyRole(selectedCells, role.id);
    }
  };

  useEffect(() => {
    wrapRef.current?.querySelector('[data-focused]')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [selection.focus]);

  // Приход из дашборда по дыре: у неё есть только дата, поэтому прокручиваем
  // к колонке, а не к ячейке.
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
            <GroupRow key={row.key} label={row.label} count={row.count} span={columns.length} />
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
          onPickRole={(roleId) => applyRole(pickerCells(), roleId)}
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
      {/* Вход в day drill-down по заголовку колонки.
          Не data-cell — делегирующий обработчик мыши на грид его не тронет. */}
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
  span,
}: {
  readonly label: string;
  readonly count: number;
  readonly span: number;
}) {
  return (
    <>
      <div className="sheet__group">
        <span className="truncate">{label}</span>
        <span className="sheet__group-count">{count}</span>
      </div>
      <div className="sheet__group-fill" style={{ gridColumn: `span ${span}` }} />
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
        <span className="sheet__name-meta">{location.name}</span>
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
            role={value.kind === 'ROLE' ? view.roleById(value.roleId) : undefined}
            issues={view.issuesByCell.get(key) ?? EMPTY_ISSUES}
            nonWorking={view.projection.nonWorkingByCell.has(key)}
            today={column.isToday}
            selected={rowSelected && columnIndex >= selLeft && columnIndex <= selRight}
            focused={focusDate === column.date}
            generationLocked={value.kind === 'ROLE' && lockedAssignmentIds.has(value.assignmentId)}
          />
        );
      })}
    </>
  );
});

/** Общая пустая ссылка: иначе каждая ячейка без нарушений ломала бы memo. */
const EMPTY_ISSUES: readonly never[] = [];
