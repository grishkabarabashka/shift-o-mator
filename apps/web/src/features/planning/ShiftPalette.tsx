/**
 * NOTE: Planning unit's shift palette. Picking a shift turns on paint mode:
 * from there it's enough to drag across cells with the mouse. The main
 * assignment path is the cell context menu (GridCell); the palette is the
 * fast path for bulk coloring.
 *
 * The shift's time is printed right on the chip — that's the answer to the
 * main problem with the current Excel sheet: you no longer need to memorize
 * the shift code (ADR-0001).
 *
 * Phase 8 UX fix: the palette used to show shifts from all regions mixed
 * together (nearly thirty chips), because `coverageRoles` was assembled
 * across all visible units at once. Now `shifts` arrives already filtered by
 * the selected planning unit (`SchedulePage` passes `view.coverageShifts`
 * only when one specific unit is selected); under `ALL_UNITS` shifts stay
 * grouped by unit rather than by the former region.
 */

import type { IsoDate, Shift } from '../../domain/types.ts';
import { formatInZone, shiftInterval } from '../../engine/dates.ts';
import { useUi, type DisplayZone } from '../../store/useUi.ts';

interface Props {
  readonly shifts: readonly Shift[];
  /** NOTE: Date the window is recomputed for: DST depends on it. */
  readonly referenceDate: IsoDate;
}

/**
 * NOTE: The shift's window in the selected display timezone. Under `shift`
 * it's shown as configured; otherwise it's recomputed via UTC, so the switch
 * to daylight saving is handled automatically.
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

  // NOTE: With all units at once (`ALL_UNITS`), the palette ends up with
  // shifts from several planning units — without a separator the list reads
  // like a random set of codes.
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
