/**
 * Полоса покрытия под сеткой.
 *
 * По умолчанию — **одна** строка `filled/required` на день.
 * Первая версия рисовала строку на каждую роль: в AMER их шестнадцать, полоса
 * занимала пол-экрана и вытесняла сам ростер. Ответ на вопрос «где дыра» стоил
 * ответа на вопрос «кто работает», а это плохой обмен.
 *
 * Детализация по ролям открывается по требованию и ограничена по высоте.
 *
 * Горизонтальный скролл синхронизируется с сеткой программно. В общем
 * скролл-контейнере полоса либо перекрывала строки, либо ограничение её высоты
 * ломало прилипание; отдельный контейнер с синхронизацией предсказуем.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CoverageLevel, IsoDate, PersonId, ShiftId } from '../../domain/types.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import { useUi } from '../../store/useUi.ts';
import { columnsTemplate } from '../../ui/gridTemplate.ts';
import type { PlanningView } from '../planning/usePlanningView.ts';
import { SuggestPopover, type SuggestTarget } from './SuggestPopover.tsx';

interface Props {
  readonly view: PlanningView;
  /** Скроллер сетки, за которым полоса следует по горизонтали. */
  readonly syncWith: React.RefObject<HTMLDivElement | null>;
}

interface DayTotal {
  readonly date: IsoDate;
  readonly filled: number;
  readonly required: number;
  readonly level: CoverageLevel;
  readonly detail: string;
}

export function CoverageStrip({ view, syncWith }: Props) {
  const focusDate = useUi((s) => s.focusDate);
  const setCells = useSchedule((s) => s.setCells);
  const startDraft = useSchedule((s) => s.startDraft);
  const [expanded, setExpanded] = useState(false);
  const [suggestTarget, setSuggestTarget] = useState<SuggestTarget>();
  const scrollerRef = useRef<HTMLDivElement>(null);

  const pickCandidate = async (personId: PersonId, shiftId: ShiftId, date: IsoDate) => {
    if (!useSchedule.getState().session) await startDraft();
    setCells([{ personId, date }], shiftId);
  };

  useEffect(() => {
    const source = syncWith.current;
    const target = scrollerRef.current;
    if (!source || !target) return;
    const sync = () => {
      target.scrollLeft = source.scrollLeft;
    };
    sync();
    source.addEventListener('scroll', sync, { passive: true });
    return () => source.removeEventListener('scroll', sync);
  }, [syncWith, expanded]);

  const totals = useMemo<DayTotal[]>(
    () =>
      view.columns.map((column) => {
        let filled = 0;
        let required = 0;
        let worst: CoverageLevel = 'OK';
        const gaps: string[] = [];

        for (const shift of view.coverageShifts) {
          const cell = view.coverageByCell.get(`${column.date}|${shift.id}`);
          if (!cell) continue;
          filled += cell.actual;
          required += cell.min;
          if (cell.level === 'GAP') {
            worst = 'GAP';
            gaps.push(`${shift.code}: ${cell.actual}/${cell.min}`);
          } else if (cell.level === 'THIN' && worst !== 'GAP') {
            worst = 'THIN';
          }
        }

        return {
          date: column.date,
          filled,
          required,
          level: worst,
          detail:
            gaps.length > 0
              ? `${column.date}\nBelow minimum:\n${gaps.join('\n')}`
              : `${column.date}\n${filled} assigned against ${required} required`,
        };
      }),
    [view.columns, view.coverageShifts, view.coverageByCell],
  );

  if (view.coverageShifts.length === 0) return null;

  const template = columnsTemplate(view.columns.length);
  const gapDays = totals.filter((total) => total.level === 'GAP').length;

  return (
    <div className="shrink-0 border-t border-line-strong bg-surface">
      <div
        ref={scrollerRef}
        className="overflow-x-hidden"
        role="group"
        aria-label="Coverage"
      >
        {expanded ? (
          <div className="max-h-[34vh] overflow-y-auto">
            <div className="cover" style={{ gridTemplateColumns: template }}>
              {view.coverageShifts.map((shift) => (
                <CoverageRow
                  key={shift.id}
                  view={view}
                  shiftId={shift.id}
                  code={shift.code}
                  color={shift.color}
                  onPick={focusDate}
                  onSuggest={(target) => setSuggestTarget(target)}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className="cover" style={{ gridTemplateColumns: template }}>
          <button
            type="button"
            className="cover__label cover__label--action"
            onClick={() => setExpanded(!expanded)}
            title={
              expanded ? 'Collapse to the daily total' : 'Show every shift in the day configuration'
            }
          >
            <span aria-hidden className="text-[8px]">
              {expanded ? '▼' : '▶'}
            </span>
            Coverage
            {gapDays > 0 ? <span className="pill pill--bad ml-auto">{gapDays}</span> : null}
          </button>

          {totals.map((total) => (
            <button
              key={total.date}
              type="button"
              className="cover__cell cover__cell--total"
              data-level={total.level}
              title={total.detail}
              onClick={() => focusDate(total.date)}
            >
              {total.filled}/{total.required}
            </button>
          ))}
        </div>
      </div>

      {suggestTarget ? (
        <SuggestPopover
          target={suggestTarget}
          onClose={() => setSuggestTarget(undefined)}
          onPick={(personId, shiftId, date) => void pickCandidate(personId, shiftId, date)}
        />
      ) : null}
    </div>
  );
}

function CoverageRow({
  view,
  shiftId,
  code,
  color,
  onPick,
  onSuggest,
}: {
  readonly view: PlanningView;
  readonly shiftId: string;
  readonly code: string;
  readonly color: string;
  readonly onPick: (date: string) => void;
  readonly onSuggest: (target: SuggestTarget) => void;
}) {
  return (
    <>
      <div className="cover__label" title={code}>
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate text-[11.5px] font-semibold tracking-normal text-ink normal-case">
          {code}
        </span>
      </div>
      {view.columns.map((column) => {
        const cell = view.coverageByCell.get(`${column.date}|${shiftId}`);
        if (!cell) return <div key={column.date} className="cover__cell" />;

        const title = [
          `${code} · ${column.date}`,
          `${cell.actual} assigned, minimum is ${cell.min}`,
          cell.max !== undefined ? `maximum ${cell.max}` : undefined,
          cell.level === 'THIN' ? 'Exactly at the minimum — one absence breaks it' : undefined,
          cell.level === 'GAP' ? 'Below the minimum' : undefined,
          cell.ruleLabel,
          cell.level === 'GAP' ? 'Click for suggested candidates' : undefined,
        ]
          .filter(Boolean)
          .join('\n');

        return (
          <button
            key={column.date}
            type="button"
            className="cover__cell"
            data-level={cell.level}
            title={title}
            onClick={(event) => {
              if (cell.level !== 'GAP') {
                onPick(column.date);
                return;
              }
              const rect = event.currentTarget.getBoundingClientRect();
              onSuggest({
                shiftId,
                code,
                unitId: cell.unitId,
                date: column.date,
                x: rect.left,
                y: rect.bottom + 4,
              });
            }}
          >
            {cell.actual}/{cell.min}
          </button>
        );
      })}
    </>
  );
}
