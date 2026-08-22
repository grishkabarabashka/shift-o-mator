/**
 * Сетка планирования: строки — люди, колонки — дни.
 *
 * Написана руками намеренно (ADR-0014): нужны range selection, paint-режим,
 * буфер обмена и полный контроль над клавиатурой — то есть ровно то, чего нет
 * в AG Grid Community.
 *
 * Клавиатура:
 *   стрелки            перемещение, с Shift — расширение выделения
 *   Home / End         начало и конец строки
 *   буква роли         поставить роль во всё выделение
 *   Delete / Backspace очистить
 *   Ctrl+C / Ctrl+V    копировать и вставить диапазон
 *   Ctrl+Z / Ctrl+Y    отмена и повтор
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compDayBlocksAssignment } from '../../domain/types.ts';
import type { IsoDate, PersonId, RoleId, ShiftRole } from '../../domain/types.ts';
import { useSchedule, type CellRef } from '../../store/useSchedule.ts';
import { selectionBounds, useUi } from '../../store/useUi.ts';
import { cellKey, type GridRow, type PlanningView } from './usePlanningView.ts';

interface Props {
  readonly view: PlanningView;
}

export function PlanningGrid({ view }: Props) {
  const { rows, columns } = view;
  const setCells = useSchedule((s) => s.setCells);
  const undo = useSchedule((s) => s.undo);
  const redo = useSchedule((s) => s.redo);

  const selection = useUi((s) => s.selection);
  const select = useUi((s) => s.select);
  const clearSelection = useUi((s) => s.clearSelection);
  const activeRoleId = useUi((s) => s.activeRoleId);
  const clipboard = useUi((s) => s.clipboard);
  const setClipboard = useUi((s) => s.setClipboard);
  const openAbsenceEdit = useUi((s) => s.openAbsenceEdit);
  const openCompDayDialog = useUi((s) => s.openCompDayDialog);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [painting, setPainting] = useState(false);

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

  /** Ячейки текущего выделения. */
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
   * Роль ставится только тем, кому она доступна, и только в свободный день:
   * не в отпуск и не на подтверждённый отгул (`PROPOSED` ещё не блокирует —
   * это предложение системы, а не решение планировщика).
   */
  const assignableCells = useCallback(
    (cells: readonly CellRef[], roleId: RoleId | null): CellRef[] =>
      cells.filter((cell) => {
        const key = cellKey(cell.personId, cell.date);
        if (view.absenceByCell.has(key)) return false;
        const compDay = view.compDayByCell.get(key);
        if (compDay && compDayBlocksAssignment(compDay)) return false;
        if (roleId === null) return true;
        return view.rolesFor(cell.personId).some((role) => role.id === roleId);
      }),
    [view],
  );

  const applyRole = useCallback(
    (cells: readonly CellRef[], roleId: RoleId | null) => {
      const allowed = assignableCells(cells, roleId);
      if (allowed.length > 0) setCells(allowed, roleId);
    },
    [assignableCells, setCells],
  );

  // -------------------------------------------------------------------------
  // Мышь: выделение и paint-режим
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!painting) return;
    const stop = () => setPainting(false);
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, [painting]);

  const onCellMouseDown = (cell: CellRef, shiftKey: boolean) => {
    select(cell, shiftKey);
    setPainting(true);
    if (activeRoleId && !shiftKey) applyRole([cell], activeRoleId);
    wrapRef.current?.focus();
  };

  const onCellMouseEnter = (cell: CellRef) => {
    if (!painting) return;
    select(cell, true);
    if (activeRoleId) applyRole([cell], activeRoleId);
  };

  /** Двойной клик редактирует то, что стоит в ячейке: сначала отсутствие, иначе отгул. */
  const onCellDoubleClick = useCallback(
    (cell: CellRef) => {
      const key = cellKey(cell.personId, cell.date);
      const absence = view.absenceByCell.get(key);
      if (absence) {
        openAbsenceEdit(absence);
        return;
      }
      const compDay = view.compDayByCell.get(key);
      if (compDay) openCompDayDialog(compDay);
    },
    [view, openAbsenceEdit, openCompDayDialog],
  );

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
        const assignment =
          person && date ? view.assignmentByCell.get(cellKey(person.id, date)) : undefined;
        line.push(assignment?.roleId ?? null);
      }
      grid.push(line);
    }
    setClipboard(grid);
  }, [bounds, personRows, columns, view.assignmentByCell, setClipboard]);

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
    for (const role of view.roles) {
      if (role.hotkey) map.set(role.hotkey.toLowerCase(), role);
    }
    return map;
  }, [view.roles]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const { key, shiftKey, ctrlKey, metaKey } = event;
    const modifier = ctrlKey || metaKey;

    if (modifier) {
      const lower = key.toLowerCase();
      if (lower === 'z') {
        event.preventDefault();
        if (shiftKey) redo();
        else undo();
        return;
      }
      if (lower === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (lower === 'c') {
        event.preventDefault();
        copySelection();
        return;
      }
      if (lower === 'v') {
        event.preventDefault();
        pasteClipboard();
        return;
      }
      return;
    }

    switch (key) {
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-1, 0, shiftKey);
        return;
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(1, 0, shiftKey);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        moveFocus(0, -1, shiftKey);
        return;
      case 'ArrowRight':
      case 'Tab':
        event.preventDefault();
        moveFocus(0, 1, shiftKey && key === 'ArrowRight');
        return;
      case 'Home':
        event.preventDefault();
        moveFocus(0, -columns.length, shiftKey);
        return;
      case 'End':
        event.preventDefault();
        moveFocus(0, columns.length, shiftKey);
        return;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        applyRole(selectedCells, null);
        return;
      case 'Escape':
        event.preventDefault();
        clearSelection();
        return;
      default:
        break;
    }

    const role = roleByHotkey.get(key.toLowerCase());
    if (role) {
      event.preventDefault();
      applyRole(selectedCells, role.id);
    }
  };

  // Держим фокус видимым при навигации клавиатурой.
  useEffect(() => {
    wrapRef.current?.querySelector('[data-focused="true"]')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [selection.focus]);

  const template = `var(--name-width) repeat(${columns.length}, var(--cell-width))`;

  return (
    <div
      className="grid-wrap"
      ref={wrapRef}
      tabIndex={0}
      role="grid"
      aria-label="Сетка планирования"
      onKeyDown={onKeyDown}
    >
      <div className="grid" style={{ gridTemplateColumns: template }}>
        <div className="grid__corner">Человек</div>
        {columns.map((column) => (
          <div
            key={column.date}
            className="grid__head"
            data-nonworking={column.isNonWorking}
            title={column.holidayName ?? column.date}
          >
            <span>{column.dayLabel}</span>
            <span>{column.weekdayLabel}</span>
          </div>
        ))}

        {rows.map((row) =>
          row.kind === 'group' ? (
            <GroupRow key={row.key} label={row.label} span={columns.length} />
          ) : (
            <PersonRow
              key={row.key}
              row={row}
              view={view}
              columns={columns}
              bounds={bounds}
              rowIndex={rowIndexOf(row.person.id)}
              focus={selection.focus}
              onMouseDownCell={onCellMouseDown}
              onMouseEnterCell={onCellMouseEnter}
              onDoubleClickCell={onCellDoubleClick}
            />
          ),
        )}
      </div>
    </div>
  );
}

function GroupRow({ label, span }: { label: string; span: number }) {
  return (
    <>
      <div className="grid__group">{label}</div>
      <div className="grid__group-fill" style={{ gridColumn: `span ${span}` }} />
    </>
  );
}

interface PersonRowProps {
  readonly row: Extract<GridRow, { kind: 'person' }>;
  readonly view: PlanningView;
  readonly columns: PlanningView['columns'];
  readonly bounds: { top: number; bottom: number; left: number; right: number } | undefined;
  readonly rowIndex: number;
  readonly focus: CellRef | undefined;
  readonly onMouseDownCell: (cell: CellRef, shiftKey: boolean) => void;
  readonly onMouseEnterCell: (cell: CellRef) => void;
  readonly onDoubleClickCell: (cell: CellRef) => void;
}

function PersonRow({
  row,
  view,
  columns,
  bounds,
  rowIndex,
  focus,
  onMouseDownCell,
  onMouseEnterCell,
  onDoubleClickCell,
}: PersonRowProps) {
  const { person, location } = row;
  const inRowSelection = bounds !== undefined && rowIndex >= bounds.top && rowIndex <= bounds.bottom;

  return (
    <>
      <div className="grid__name" title={`${person.displayName} · ${location.name}`}>
        {person.displayName}
        <span className="grid__name-zone">{shortZone(location.timeZone)}</span>
      </div>
      {columns.map((column, columnIndex) => {
        const key = cellKey(person.id, column.date);
        const assignment = view.assignmentByCell.get(key);
        const role = assignment ? view.roles.find((r) => r.id === assignment.roleId) : undefined;
        const absence = view.absenceByCell.get(key);
        const compDay = view.compDayByCell.get(key);
        const blockedByCompDay = compDay ? compDayBlocksAssignment(compDay) : false;
        const issues = view.issuesByCell.get(key) ?? [];
        const worstLevel = issues.some((i) => i.level === 'BLOCKING')
          ? 'BLOCKING'
          : issues.some((i) => i.level === 'WARNING')
            ? 'WARNING'
            : undefined;

        const selected =
          inRowSelection &&
          bounds !== undefined &&
          columnIndex >= bounds.left &&
          columnIndex <= bounds.right;
        const focused = focus?.personId === person.id && focus.date === column.date;

        // Подсказка через нативный `title`, а не Radix Tooltip: 80 × 31 живых
        // тултипов кладут прокрутку сетки.
        return (
          <div
            key={key}
            className="grid__cell"
            role="gridcell"
            data-person={person.id}
            data-date={column.date}
            title={cellTooltip(role, absence?.type, compDay?.status, issues.map((i) => i.message))}
            data-nonworking={view.nonWorkingByCell.has(key)}
            data-absent={absence !== undefined || blockedByCompDay}
            data-selected={selected}
            data-focused={focused}
            data-issue={worstLevel}
            onMouseDown={(event) => {
              event.preventDefault();
              onMouseDownCell({ personId: person.id, date: column.date }, event.shiftKey);
            }}
            onMouseEnter={() => onMouseEnterCell({ personId: person.id, date: column.date })}
            onDoubleClick={() => onDoubleClickCell({ personId: person.id, date: column.date })}
          >
            {role ? (
              <span className="grid__chip" style={{ background: role.color }}>
                {role.code}
              </span>
            ) : compDay ? (
              <span className="grid__comp-day">CD</span>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function cellTooltip(
  role: ShiftRole | undefined,
  absenceType: string | undefined,
  compDayStatus: string | undefined,
  messages: readonly string[],
): string | undefined {
  const parts: string[] = [];
  if (role) parts.push(`${role.code} ${role.start}–${role.end} (${shortZone(role.timeZone)})`);
  if (absenceType) parts.push(`отсутствие: ${absenceType}`);
  if (compDayStatus) parts.push(`отгул: ${compDayStatus}`);
  parts.push(...messages);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

function shortZone(zone: string): string {
  return zone.split('/').at(-1)?.replace(/_/g, ' ') ?? zone;
}
