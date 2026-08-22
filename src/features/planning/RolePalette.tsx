/**
 * Палитра ролей единицы. Выбранная роль включает paint-режим: дальше её
 * достаточно протянуть мышью по ячейкам.
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
    <div className="palette" role="toolbar" aria-label="Роли">
      {roles.map((role) => (
        <button
          key={role.id}
          type="button"
          className="palette__chip"
          data-active={role.id === activeRoleId}
          onClick={() => setActiveRole(role.id === activeRoleId ? undefined : role.id)}
          title={`${role.label}: ${role.start}–${role.end} ${role.timeZone}`}
        >
          <span className="palette__swatch" style={{ background: role.color }} />
          {role.code}
          <span className="palette__key">{windowLabel(role, referenceDate, displayZone)}</span>
          {role.hotkey ? <span className="palette__key">[{role.hotkey}]</span> : null}
        </button>
      ))}
      <span className="palette__hint">
        {activeRoleId
          ? 'Протяните мышью по ячейкам · Esc снимает выбор'
          : 'Выберите роль для paint-режима или нажимайте её букву на клавиатуре'}
      </span>
    </div>
  );
}
