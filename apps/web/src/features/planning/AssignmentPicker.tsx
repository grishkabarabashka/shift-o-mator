/**
 * Плавающий пикер назначения — единственный на всю сетку.
 *
 * Раньше каждая ячейка несла собственный `ContextMenu.Root` с порталом. При
 * 80 людях на 31 день это 2480 корней меню, каждый со своей подпиской на
 * dismissable-слой и фокус: сетка проседала на любом движении выделения, а
 * причина выглядела как «тормозит таблица».
 *
 * Здесь один экземпляр, смонтированный на уровне сетки и позиционируемый по
 * курсору. Ячейка снова становится обычным `div`.
 *
 * Пикер намеренно работает и в режиме чтения: правый клик по ячейке — самый
 * очевидный жест, и упираться в «сначала нажмите Edit» пользователь не должен.
 * Выбор пункта сам открывает черновик (см. `withDraft` в PlanningGrid).
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
  /** Смены единицы вне конфигурации дня или eligibility — путь для отступления. */
  readonly otherShifts: readonly Shift[];
  /**
   * Ячейка закрыта отпуском или подтверждённым отгулом.
   *
   * Раньше это выключало пункты меню. Больше нет (ADR-0024): назначение
   * записывается, а конфликт подсвечивается и подтверждается. Флаг остался,
   * чтобы **предупредить заранее** — отказ без объяснения был хуже.
   */
  readonly locked: boolean;
  readonly lockReason: string | undefined;
  /** Id назначения, которое можно закрепить от автогенерации — только если оно есть. */
  readonly assignmentId: string | undefined;
  readonly generationLocked: boolean;
  readonly x: number;
  readonly y: number;
  /** Сколько ячеек получит выбранное значение. >1 — правый клик по выделению. */
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

  // Переворот у края экрана считается после монтирования: до измерения
  // настоящей высоты списка смен любая оценка была бы враньём.
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
    // Скролл закрывает: меню привязано к точке экрана, а не к ячейке, и
    // «уехавшее» меню указывало бы не на ту дату.
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
