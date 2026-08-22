/**
 * Палитра смен единицы планирования. Выбранная смена включает paint-режим:
 * дальше её достаточно протянуть мышью по ячейкам. Основной путь назначения —
 * контекстное меню ячейки (GridCell); палитра — быстрый путь для массовой
 * раскраски.
 *
 * Время смены подписано прямо на чипе — это и есть ответ на главную проблему
 * текущего Excel: код смены больше не нужно помнить (ADR-0001).
 *
 * Phase 8 UX fix: раньше палитра показывала смены всех регионов
 * вперемешку (почти тридцать чипов), потому что `coverageRoles` собирался по
 * всем видимым единицам сразу. Теперь `shifts` приходит уже отфильтрованным
 * выбранной единицей планирования (`SchedulePage` передаёт `view.coverageShifts`
 * только когда конкретная единица выбрана); при `ALL_UNITS` смены остаются
 * сгруппированными по единице, а не по бывшему региону.
 */

import type { IsoDate, Shift } from '../../domain/types.ts';
import { formatInZone, shiftInterval } from '../../engine/dates.ts';
import { useUi, type DisplayZone } from '../../store/useUi.ts';

interface Props {
  readonly shifts: readonly Shift[];
  /** Дата, на которую пересчитывается окно: от неё зависит DST. */
  readonly referenceDate: IsoDate;
}

/**
 * Окно смены в выбранной таймзоне отображения. При `shift` показывается как
 * задано; в остальных случаях пересчитывается через UTC, поэтому переход на
 * летнее время учитывается сам.
 */
function windowLabel(shift: Shift, date: IsoDate, zone: DisplayZone): string {
  if (zone === 'shift') return `${shift.start}–${shift.end}`;
  try {
    const interval = shiftInterval(shift, date);
    return `${formatInZone(interval.start, zone)}–${formatInZone(interval.end, zone)}`;
  } catch {
    return `${shift.start}–${shift.end}`;
  }
}

export function ShiftPalette({ shifts, referenceDate }: Props) {
  const activeShiftId = useUi((s) => s.activeShiftId);
  const setActiveShift = useUi((s) => s.setActiveShift);
  const displayZone = useUi((s) => s.displayZone);

  // Со всеми единицами сразу (`ALL_UNITS`) в палитре оказываются смены
  // нескольких единиц планирования — без разделителя список читается как
  // случайный набор кодов.
  const byUnit = new Map<string, Shift[]>();
  for (const shift of shifts) {
    const bucket = byUnit.get(shift.unitId);
    if (bucket) bucket.push(shift);
    else byUnit.set(shift.unitId, [shift]);
  }
  const grouped = byUnit.size > 1 ? [...byUnit.entries()] : [];

  if (grouped.length > 0) {
    return (
      <div className="flex flex-col gap-1" role="toolbar" aria-label="Shifts">
        {grouped.map(([unitId, unitShifts]) => (
          <div key={unitId} className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 shrink-0 text-[10px] font-bold tracking-wide text-faint uppercase">
              {unitId}
            </span>
            {unitShifts.map((shift) => (
              <ShiftChip
                key={shift.id}
                shift={shift}
                active={shift.id === activeShiftId}
                window={windowLabel(shift, referenceDate, displayZone)}
                onToggle={() => setActiveShift(shift.id === activeShiftId ? undefined : shift.id)}
              />
            ))}
          </div>
        ))}
        <span
          className="text-[11.5px] text-faint"
          title={activeShiftId ? undefined : 'A shift only applies to its own unit.'}
        >
          {activeShiftId
            ? 'Drag across cells to paint · Esc clears the selection'
            : 'Right-click a cell for options'}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Shifts">
      {shifts.map((shift) => (
        <button
          key={shift.id}
          type="button"
          className="role-chip"
          data-active={shift.id === activeShiftId}
          onClick={() => setActiveShift(shift.id === activeShiftId ? undefined : shift.id)}
          title={`${shift.label}: ${shift.start}–${shift.end} ${shift.timeZone}`}
        >
          <span
            aria-hidden
            className="h-3 w-3 shrink-0 rounded-[3px]"
            style={{ background: shift.color }}
          />
          <span className="font-mono font-bold">{shift.code}</span>
          <span className="font-mono text-[10.5px] text-faint">
            {windowLabel(shift, referenceDate, displayZone)}
          </span>
          {shift.hotkey ? <kbd className="kbd">{shift.hotkey}</kbd> : null}
        </button>
      ))}

      <span className="ml-1 text-[11.5px] text-faint">
        {activeShiftId
          ? 'Drag across cells to paint · Esc clears the selection'
          : 'Right-click any cell for its options'}
      </span>
    </div>
  );
}

function ShiftChip({
  shift,
  active,
  window: label,
  onToggle,
}: {
  readonly shift: Shift;
  readonly active: boolean;
  readonly window: string;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="role-chip"
      data-active={active}
      onClick={onToggle}
      title={`${shift.label}: ${shift.start}–${shift.end} ${shift.timeZone}`}
    >
      <span
        aria-hidden
        className="h-3 w-3 shrink-0 rounded-[3px]"
        style={{ background: shift.color }}
      />
      <span className="font-mono font-bold">{shift.code}</span>
      <span className="font-mono text-[10.5px] text-faint">{label}</span>
      {shift.hotkey ? <kbd className="kbd">{shift.hotkey}</kbd> : null}
    </button>
  );
}
