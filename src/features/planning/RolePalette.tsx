/**
 * Палитра ролей единицы. Выбранная роль включает paint-режим: дальше её
 * достаточно протянуть мышью по ячейкам. Основной путь назначения — контекстное
 * меню ячейки (GridCell); палитра — быстрый путь для массовой раскраски.
 *
 * Время роли подписано прямо на чипе — это и есть ответ на главную проблему
 * текущего Excel: код смены больше не нужно помнить (ADR-0001).
 */

import type { IsoDate, ShiftRole } from '../../domain/types.ts';
import { formatInZone, shiftInterval } from '../../engine/dates.ts';
import { useUi, type DisplayZone } from '../../store/useUi.ts';

interface Props {
  readonly roles: readonly ShiftRole[];
  /** Дата, на которую пересчитывается окно: от неё зависит DST. */
  readonly referenceDate: IsoDate;
}

/**
 * Окно роли в выбранной таймзоне отображения. При `role` показывается как
 * задано; в остальных случаях пересчитывается через UTC, поэтому переход на
 * летнее время учитывается сам.
 */
function windowLabel(role: ShiftRole, date: IsoDate, zone: DisplayZone): string {
  if (zone === 'role') return `${role.start}–${role.end}`;
  try {
    const interval = shiftInterval(role, date);
    return `${formatInZone(interval.start, zone)}–${formatInZone(interval.end, zone)}`;
  } catch {
    return `${role.start}–${role.end}`;
  }
}

export function RolePalette({ roles, referenceDate }: Props) {
  const activeRoleId = useUi((s) => s.activeRoleId);
  const setActiveRole = useUi((s) => s.setActiveRole);
  const displayZone = useUi((s) => s.displayZone);

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Roles">
      {roles.map((role) => (
        <button
          key={role.id}
          type="button"
          className="role-chip"
          data-active={role.id === activeRoleId}
          onClick={() => setActiveRole(role.id === activeRoleId ? undefined : role.id)}
          title={`${role.label}: ${role.start}–${role.end} ${role.timeZone}`}
        >
          <span
            aria-hidden
            className="h-3 w-3 shrink-0 rounded-[3px]"
            style={{ background: role.color }}
          />
          <span className="font-mono font-bold">{role.code}</span>
          <span className="font-mono text-[10.5px] text-faint">
            {windowLabel(role, referenceDate, displayZone)}
          </span>
          {role.hotkey ? <kbd className="kbd">{role.hotkey}</kbd> : null}
        </button>
      ))}

      <span className="ml-1 text-[11.5px] text-faint">
        {activeRoleId
          ? 'Drag across cells to paint · Esc clears the selection'
          : 'Right-click any cell for its options'}
      </span>
    </div>
  );
}
