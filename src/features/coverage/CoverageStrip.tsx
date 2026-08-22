/**
 * Полоса покрытия под сеткой.
 *
 * По умолчанию — **одна** строка `filled/required` на день, как в спеке §4.2.
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
import type { CoverageLevel, IsoDate } from '../../domain/types.ts';
import { useUi } from '../../store/useUi.ts';
import type { PlanningView } from '../planning/usePlanningView.ts';

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
  const [expanded, setExpanded] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

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

        for (const role of view.coverageRoles) {
          const cell = view.coverageByCell.get(`${column.date}|${role.id}`);
          if (!cell) continue;
          filled += cell.actual;
          required += cell.min;
          if (cell.level === 'GAP') {
            worst = 'GAP';
            gaps.push(`${role.code}: ${cell.actual}/${cell.min}`);
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
    [view.columns, view.coverageRoles, view.coverageByCell],
  );

  if (view.coverageRoles.length === 0) return null;

  const template = `var(--name-w) repeat(${view.columns.length}, var(--cell-w))`;
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
              {view.coverageRoles.map((role) => (
                <CoverageRow
                  key={role.id}
                  view={view}
                  roleId={role.id}
                  code={role.code}
                  color={role.color}
                  onPick={focusDate}
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
              expanded ? 'Collapse to the daily total' : 'Show every role in the day configuration'
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
    </div>
  );
}

function CoverageRow({
  view,
  roleId,
  code,
  color,
  onPick,
}: {
  readonly view: PlanningView;
  readonly roleId: string;
  readonly code: string;
  readonly color: string;
  readonly onPick: (date: string) => void;
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
        const cell = view.coverageByCell.get(`${column.date}|${roleId}`);
        if (!cell) return <div key={column.date} className="cover__cell" />;

        const title = [
          `${code} · ${column.date}`,
          `${cell.actual} assigned, minimum is ${cell.min}`,
          cell.max !== undefined ? `maximum ${cell.max}` : undefined,
          cell.level === 'THIN' ? 'Exactly at the minimum — one absence breaks it' : undefined,
          cell.level === 'GAP' ? 'Below the minimum — blocks publication' : undefined,
          cell.ruleLabel,
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
            onClick={() => onPick(column.date)}
          >
            {cell.actual}/{cell.min}
          </button>
        );
      })}
    </>
  );
}
