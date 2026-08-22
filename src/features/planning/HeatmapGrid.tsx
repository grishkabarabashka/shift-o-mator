/**
 * Компактный вид длинных периодов: человек — строка, день — точка.
 *
 * Спека §4.2 разводит два масштаба намеренно. Три и шесть месяцев — это
 * 90–180 колонок; редактируемая сетка на таком масштабе не помещается ни на
 * экран, ни в бюджет отрисовки, и главное — на ней нечего делать мышью.
 * Здесь отвечают на другие вопросы: где сидят блоки отпусков, кто месяцами не
 * стоял в выходные, ровно ли размазаны роли.
 *
 * Поэтому вид только на чтение, а цвет берётся у роли: те же цвета, что в
 * сетке, People и таймлайне.
 */

import { useMemo } from 'react';
import type { IsoDate } from '../../domain/types.ts';
import { parseDate } from '../../engine/dates.ts';
import { useUi } from '../../store/useUi.ts';
import type { GridRow, PlanningView } from './usePlanningView.ts';
import { STATUS_LABEL } from './GridCell.tsx';

const DAY_W = 7;

export function HeatmapGrid({ view }: { readonly view: PlanningView }) {
  const setZoom = useUi((s) => s.setZoom);
  const { rows, columns } = view;

  /** Заголовки месяцев: недельные группы на 180 колонках нечитаемы. */
  const months = useMemo(() => {
    const out: { key: string; label: string; span: number }[] = [];
    for (const column of columns) {
      const key = column.date.slice(0, 7);
      const last = out.at(-1);
      if (last?.key === key) last.span += 1;
      else out.push({ key, label: parseDate(column.date).toFormat('LLLL yyyy'), span: 1 });
    }
    return out;
  }, [columns]);

  const template = `var(--name-w) repeat(${columns.length}, ${DAY_W}px)`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-sunken px-3 py-1.5 text-[11.5px] text-muted">
        <span>Read-only overview — {columns.length} days.</span>
        <button type="button" className="btn btn--sm" onClick={() => setZoom('month')}>
          Switch to Month to edit
        </button>
        <Legend />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="heat" style={{ gridTemplateColumns: template }}>
          <div className="heat__head sticky left-0 z-[4]" />
          {months.map((month) => (
            <div
              key={month.key}
              className="heat__head"
              style={{ gridColumn: `span ${month.span}` }}
              title={month.label}
            >
              {month.label}
            </div>
          ))}

          {rows.map((row) =>
            row.kind === 'group' ? (
              <GroupBand key={row.key} label={row.label} span={columns.length} />
            ) : (
              <PersonBand key={row.key} row={row} view={view} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <span className="ml-auto flex items-center gap-3 text-[11px] text-faint">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-2.5 rounded-[2px] bg-accent" /> working role
      </span>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-2.5 w-2.5 rounded-[2px]"
          style={{ background: 'var(--warn)' }}
        />
        leave
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-2.5 rounded-[2px] bg-sunken ring-1 ring-line" /> free
      </span>
    </span>
  );
}

function GroupBand({ label, span }: { readonly label: string; readonly span: number }) {
  return (
    <>
      <div className="sheet__group">
        <span className="truncate">{label}</span>
      </div>
      <div className="sheet__group-fill" style={{ gridColumn: `span ${span}` }} />
    </>
  );
}

function PersonBand({
  row,
  view,
}: {
  readonly row: Extract<GridRow, { kind: 'person' }>;
  readonly view: PlanningView;
}) {
  return (
    <>
      <div className="heat__name" title={row.person.displayName}>
        <span className="truncate">{row.person.displayName}</span>
      </div>
      {view.columns.map((column) => {
        const value = view.cellAt(row.person.id, column.date);
        const role = value.kind === 'ROLE' ? view.roleById(value.roleId) : undefined;
        return (
          <div
            key={column.date}
            className="heat__cell"
            style={{ background: colorOf(value, role?.color, column.isNonWorking) }}
            title={labelOf(row.person.displayName, column.date, value, role?.code)}
          />
        );
      })}
    </>
  );
}

function colorOf(
  value: ReturnType<PlanningView['cellAt']>,
  roleColor: string | undefined,
  nonWorking: boolean,
): string {
  if (value.kind === 'ROLE') return roleColor ?? 'var(--accent)';
  if (value.kind === 'STATUS') {
    switch (value.status) {
      case 'VACATION':
      case 'SICK':
      case 'OTHER':
        return 'var(--warn)';
      case 'COMP_OFF':
        return 'color-mix(in srgb, var(--ok) 55%, transparent)';
      case 'PH':
        return 'color-mix(in srgb, var(--warn) 30%, transparent)';
      default:
        return 'var(--surface-sunken)';
    }
  }
  return nonWorking ? 'var(--surface-sunken)' : 'transparent';
}

function labelOf(
  name: string,
  date: IsoDate,
  value: ReturnType<PlanningView['cellAt']>,
  roleCode: string | undefined,
): string {
  const what =
    value.kind === 'ROLE'
      ? (roleCode ?? 'assigned')
      : value.kind === 'STATUS'
        ? STATUS_LABEL[value.status]
        : '—';
  return `${name} · ${date}\n${what}`;
}
