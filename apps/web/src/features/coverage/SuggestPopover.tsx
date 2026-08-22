/**
 * Suggest — ранжированные кандидаты на конкретную дыру (Docs/06-generation.md).
 *
 * Открывается с красной клетки полосы покрытия. Список — та же функция
 * ранжирования, что использует авто-заполнение, только на одну ячейку и с
 * ручным подтверждением: выбор кандидата ставит роль через обычный путь
 * записи (`setCells`) и сразу открывает черновик, если его ещё нет.
 *
 * Если кандидатов нет, список объясняет почему — «3 eligible, 2 on leave,
 * 1 not available this weekday», а не пустая рамка.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchCandidates } from '../../api/planning.ts';
import type { IsoDate, PersonId, ShiftId, UnitId } from '../../domain/types.ts';
import { useSchedule } from '../../store/useSchedule.ts';

export interface SuggestTarget {
  readonly shiftId: ShiftId;
  readonly code: string;
  readonly unitId: UnitId;
  readonly date: IsoDate;
  readonly x: number;
  readonly y: number;
}

interface Props {
  readonly target: SuggestTarget;
  readonly onClose: () => void;
  readonly onPick: (personId: PersonId, shiftId: ShiftId, date: IsoDate) => void;
}

const MARGIN = 8;

export function SuggestPopover({ target, onClose, onPick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  const plan = useSchedule((s) => s.plan);

  const busyToday = new Set(
    (plan?.assignments ?? []).filter((a) => a.date === target.date).map((a) => a.personId),
  );
  const { data: result } = useQuery({
    queryKey: ['suggest', target.shiftId, target.date, target.unitId, [...busyToday].sort()],
    queryFn: () =>
      fetchCandidates({
        shiftId: target.shiftId,
        date: target.date,
        unitId: target.unitId,
        excludePersonIds: busyToday,
      }),
    enabled: plan !== undefined,
  });

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
  }, [target.x, target.y]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
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

  return createPortal(
    <div
      ref={ref}
      className="popover fixed max-h-[70vh] w-[300px] overflow-y-auto"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      aria-label="Suggested candidates"
    >
      <div className="menu-label px-2.5 pt-1 normal-case">
        <span className="font-mono font-bold text-ink">{target.code}</span>
        <span className="ml-1.5 text-faint">{target.date}</span>
      </div>

      {!result || result.available.length === 0 ? (
        <div className="px-2.5 py-2 text-[12px] text-muted">
          {result
            ? explainNoCandidates(result.excluded.length)
            : 'Loading…'}
          {result && result.excluded.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5">
              {result.excluded.slice(0, 6).map((entry) => (
                <li key={entry.personId} className="text-[11px] text-faint">
                  {entry.name} — {entry.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <>
          <div className="menu-sep" />
          {result.available.slice(0, 8).map((candidate, i) => (
            <button
              key={candidate.personId}
              type="button"
              className="menu-item items-start"
              role="menuitem"
              onClick={() => {
                onPick(candidate.personId, target.shiftId, target.date);
                onClose();
              }}
            >
              <span className="mt-0.5 w-4 shrink-0 text-[10px] text-faint">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium">{candidate.name}</span>
                <span className="block text-[10.5px] text-faint">
                  {candidate.shiftCountLast90}× in 90d
                  {candidate.daysSinceLastHeld !== undefined
                    ? ` · held ${candidate.daysSinceLastHeld}d ago`
                    : ' · never held it'}
                  {' · weekends '}
                  {candidate.weekendLoad}
                  {result.teamWeekendAverage > 0 ? ` (avg ${result.teamWeekendAverage})` : ''}
                </span>
                {candidate.warnings.length > 0 ? (
                  <span className="mt-0.5 block text-[10.5px] text-warn">
                    {candidate.warnings.join(' · ')}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </>
      )}
    </div>,
    document.body,
  );
}

function explainNoCandidates(excludedCount: number): string {
  return excludedCount === 0
    ? 'No one in this unit is eligible for this shift.'
    : `${excludedCount} eligible, none available:`;
}
