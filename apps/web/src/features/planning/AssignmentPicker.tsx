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
 *
 * One menu, contents by role. A non-planner gets self-service actions on their own row
 * and history everywhere; a planner gets the planning actions as well. Before this the
 * menu was role-blind, so a viewer was offered shifts they could not assign.
 */

import { useState, type ReactNode } from 'react';
import type { CellValue, IsoDate, PersonId, Shift, ShiftId } from '../../domain/types.ts';
import { FloatingMenu } from './FloatingMenu.tsx';

export interface PickerTarget {
  readonly personId: PersonId;
  readonly personName: string;
  /** The row's planning unit. Every permission question is scoped to it (ADR-0051). */
  readonly unitId: string | undefined;
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
  readonly onAbsence: () => void;
  readonly onCompDay: (() => void) | undefined;
  readonly onToggleLock: (() => void) | undefined;
  /** Planning actions — shifts, markers, clear. False for a non-planner. */
  readonly canEditPlan: boolean;
  /** Self-service actions. True on the caller's own row, or for a planner. */
  readonly canRequest: boolean;
  /** The one-click presence and time-off section, rendered by the caller so this
   * component stays a menu and does not grow a data layer. */
  readonly selfService: ReactNode | undefined;
  readonly onShowHistory: (() => void) | undefined;
  /** Pending requests covering this cell, decidable by this caller. */
  readonly pending: readonly PendingApproval[];
  readonly onDecide: ((requestId: string, approve: boolean) => void) | undefined;
}

export interface PendingApproval {
  readonly requestId: string;
  readonly label: string;
  readonly subjectName: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
}

export function AssignmentPicker({
  target,
  onClose,
  onPickShift,
  onAbsence,
  onCompDay,
  onToggleLock,
  canEditPlan,
  canRequest,
  selfService,
  onShowHistory,
  pending,
  onDecide,
}: Props) {
  const [showOther, setShowOther] = useState(false);

  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  const occupied = target.value.kind !== 'EMPTY';

  return (
    <FloatingMenu
      x={target.x}
      y={target.y}
      anchorKey={`${target.personId}|${target.date}`}
      label="Assignment"
      width={268}
      onClose={onClose}
    >
      <div className="menu-label flex items-baseline justify-between gap-2 normal-case">
        <span className="truncate text-[12px] font-semibold tracking-normal text-ink">
          {target.personName}
        </span>
        <span className="shrink-0 text-[11px] font-medium tracking-normal">{target.date}</span>
      </div>
      {/* First, and loud. A decision waiting on this caller outranks everything else the
          menu offers — it was below the selection count and the conflict warning, which is
          where you look last. */}
      {pending.length > 0 && onDecide ? (
        <div className="menu-decide">
          <div className="menu-decide__label">Awaiting your decision</div>
          {pending.map((request) => (
            <div key={request.requestId} className="menu-decide__row">
              <div className="text-[11.5px] font-medium">
                {request.subjectName} · {request.label}
              </div>
              <div className="text-[10.5px] text-faint">
                {request.from === request.to ? request.from : `${request.from} → ${request.to}`}
              </div>
              <div className="mt-1.5 flex gap-1">
                <button
                  type="button"
                  className="btn btn--sm btn--primary"
                  onClick={run(() => onDecide(request.requestId, true))}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={run(() => onDecide(request.requestId, false))}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* A comp day only offers itself on a day that has one, so when it is here it is
          the reason the menu was opened. It was ten items down among the planning
          actions, below the shift list, where nothing draws the eye. */}
      {onCompDay ? (
        <button type="button" className="menu-feature" role="menuitem" onClick={run(onCompDay)}>
          <span aria-hidden className="menu-feature__icon">C</span>
          <span className="min-w-0 flex-1">
            <span className="menu-feature__title">Comp day earned</span>
            <span className="menu-feature__hint">Choose which day to take &mdash; needs approval</span>
          </span>
          <span aria-hidden className="menu-feature__chevron">&rsaquo;</span>
        </button>
      ) : null}

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

      {canRequest && selfService ? selfService : null}

      {!canEditPlan ? (
        <>
          {onShowHistory ? (
            <>
              <div className="menu-sep" />
              <button type="button" className="menu-item" role="menuitem" onClick={run(onShowHistory)}>
                History…
              </button>
            </>
          ) : null}
        </>
      ) : null}

      {!canEditPlan ? null : (
      <>
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

      {/* The "Non-working" block is gone (ADR-0052). "Off" and "0 — not scheduled" were
          markers this model no longer has, and "Leave / sick…" offered a third route to
          the time-off actions the self-service section already lists one click away.
          Editing an existing absence still needs the dialog, so that item survives — but
          only when there is one to edit. */}
      {target.value.kind === 'STATUS' && target.value.absenceId ? (
        <>
          <div className="menu-sep" />
          <button type="button" className="menu-item" role="menuitem" onClick={run(onAbsence)}>
            Edit absence…
          </button>
        </>
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

      {onShowHistory ? (
        <>
          <div className="menu-sep" />
          <button type="button" className="menu-item" role="menuitem" onClick={run(onShowHistory)}>
            History…
          </button>
        </>
      ) : null}
      </>
      )}
    </FloatingMenu>
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
