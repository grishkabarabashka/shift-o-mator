/**
 * WHY: Floating assignment picker — the only one for the whole grid.
 *
 * Each cell used to carry its own `ContextMenu.Root` with a portal. At 80
 * people over 31 days that's 2480 menu roots, each with its own dismissable-
 * layer and focus subscription: the grid bogged down on any selection
 * movement, and the cause looked like "the table is slow."
 *
 * NOTE: Here there's one instance, mounted at the grid level and positioned
 * by the cursor. The cell goes back to being a plain `div`.
 *
 * The picker deliberately works in read mode too: a right-click on a cell is
 * the most obvious gesture, and the user shouldn't have to hit "Edit" first.
 * Picking an item opens the draft by itself (see `withDraft` in PlanningGrid).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CellValue, IsoDate, PersonId, Shift, ShiftId } from '../../domain/types.ts';

export interface PickerTarget {
  readonly personId: PersonId;
  readonly personName: string;
  readonly date: IsoDate;
  readonly value: CellValue;
  readonly shifts: readonly Shift[];
  /** NOTE: Unit shifts outside the day configuration or eligibility — the path for a departure from the rule. */
  readonly otherShifts: readonly Shift[];
  /**
   * NOTE: The cell is closed out by vacation or a confirmed comp day.
   *
   * This used to disable the menu items. No longer (ADR-0024): the assignment
   * gets recorded and the conflict is highlighted and acknowledged. The flag
   * stayed to **warn in advance** — a refusal with no explanation was worse.
   */
  readonly locked: boolean;
  readonly lockReason: string | undefined;
  /** NOTE: Id of the assignment that can be locked against auto-generation — only when one exists. */
  readonly assignmentId: string | undefined;
  readonly generationLocked: boolean;
  readonly x: number;
  readonly y: number;
  /** NOTE: How many cells will receive the picked value. >1 means a right-click on a selection. */
  readonly affected: number;
}

interface Props {
  readonly target: PickerTarget;
  readonly onClose: () => void;
  readonly onPickShift: (shiftId: ShiftId | null) => void;
  readonly onPickMarker: (marker: 'OFF' | 'NOT_SCHEDULED') => void;
  readonly onAbsence: () => void;
  readonly onCompDay: (() => void) | undefined;
  readonly onToggleLock: (() => void) | undefined;
}

const MARGIN = 8;

export function AssignmentPicker({
  target,
  onClose,
  onPickShift,
  onPickMarker,
  onAbsence,
  onCompDay,
  onToggleLock,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });
  const [showOther, setShowOther] = useState(false);

  // NOTE: The flip at the screen edge is computed after mount: before the
  // actual height of the shift list is measured, any estimate would be a lie.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const left =
      target.x + box.width + MARGIN > window.innerWidth
        ? Math.max(MARGIN, target.x - box.width)
        : target.x;
    const top =
      target.y + box.height + MARGIN > window.innerHeight
        ? Math.max(MARGIN, window.innerHeight - box.height - MARGIN)
        : target.y;
    setPos({ left, top });
  }, [target.x, target.y, target.personId, target.date]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // NOTE: Scroll closes it: the menu is pinned to a screen point, not to
    // the cell, and a menu left behind would point at the wrong date.
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.menu-item:not(:disabled)')?.focus();
  }, [target.personId, target.date]);

  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  const occupied = target.value.kind !== 'EMPTY';

  return createPortal(
    <div
      ref={ref}
      className="popover fixed max-h-[70vh] w-[268px] overflow-y-auto"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      aria-label="Assignment"
    >
      <div className="menu-label flex items-baseline justify-between gap-2 normal-case">
        <span className="truncate text-[12px] font-semibold tracking-normal text-ink">
          {target.personName}
        </span>
        <span className="shrink-0 text-[11px] font-medium tracking-normal">{target.date}</span>
      </div>
      {target.affected > 1 ? (
        <div className="px-2.5 pb-1 text-[11px] text-accent">
          Applies to {target.affected} selected cells
        </div>
      ) : null}

      {target.locked ? (
        <div className="mx-1.5 mb-1 rounded-md bg-warn-soft px-2 py-1.5 text-[11px] text-warn">
          {target.lockReason} — assigning is allowed and will be flagged as a conflict.
        </div>
      ) : null}

      <div className="menu-sep" />
      <div className="menu-label">Shifts</div>

      {target.shifts.length === 0 ? (
        <div className="px-2.5 pb-1.5 text-[12px] text-faint">
          No shift in this day&rsquo;s configuration matches this person&rsquo;s eligibility.
        </div>
      ) : (
        target.shifts.map((shift) => (
          <ShiftItem key={shift.id} shift={shift} onPick={run(() => onPickShift(shift.id))} />
        ))
      )}

      {target.otherShifts.length > 0 ? (
        <>
          <button
            type="button"
            className="menu-item text-faint"
            aria-expanded={showOther}
            onClick={() => setShowOther(!showOther)}
          >
            <span aria-hidden className="text-[8px]">
              {showOther ? '▼' : '▶'}
            </span>
            <span className="text-[11.5px]">
              Other shifts in this unit ({target.otherShifts.length})
            </span>
          </button>
          {showOther ? (
            <>
              <div className="px-2.5 pb-1 text-[10.5px] text-warn">
                Outside this day&rsquo;s configuration or their eligibility. Recorded as a
                conflict needing a comment.
              </div>
              {target.otherShifts.map((shift) => (
                <ShiftItem key={shift.id} shift={shift} onPick={run(() => onPickShift(shift.id))} />
              ))}
            </>
          ) : null}
        </>
      ) : null}

      <div className="menu-sep" />
      <div className="menu-label">Non-working</div>
      <button type="button" className="menu-item" role="menuitem" onClick={run(() => onPickMarker('OFF'))}>
        Off
      </button>
      <button
        type="button"
        className="menu-item"
        role="menuitem"
        onClick={run(() => onPickMarker('NOT_SCHEDULED'))}
      >
        0 — not scheduled
      </button>
      <button type="button" className="menu-item" role="menuitem" onClick={run(onAbsence)}>
        {target.value.kind === 'STATUS' && target.value.absenceId ? 'Edit absence…' : 'Leave / sick…'}
      </button>
      {onCompDay ? (
        <button type="button" className="menu-item" role="menuitem" onClick={run(onCompDay)}>
          Manage comp day…
        </button>
      ) : null}
      {onToggleLock ? (
        <button type="button" className="menu-item" role="menuitem" onClick={run(onToggleLock)}>
          {target.generationLocked ? 'Unlock — let auto-populate replace it' : 'Lock from auto-populate'}
        </button>
      ) : null}

      <div className="menu-sep" />
      <button
        type="button"
        className="menu-item menu-item--danger"
        role="menuitem"
        disabled={!occupied}
        onClick={run(() => onPickShift(null))}
      >
        Clear
      </button>
    </div>,
    document.body,
  );
}

function ShiftItem({ shift, onPick }: { readonly shift: Shift; readonly onPick: () => void }) {
  return (
    <button type="button" className="menu-item" role="menuitem" onClick={onPick}>
      <span
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 rounded-[4px]"
        style={{ background: shift.color }}
      />
      <span className="font-mono text-[12.5px] font-semibold">{shift.code}</span>
      <span className="ml-auto shrink-0 font-mono text-[11px] text-faint">
        {shift.start}–{shift.end}
      </span>
    </button>
  );
}
