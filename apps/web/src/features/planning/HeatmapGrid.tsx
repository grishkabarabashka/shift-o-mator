/**
 * NOTE: Compact view for long periods: a person is a row, a day is a dot.
 *
 * Three and six months are 90-180 columns; an editable grid at that scale
 * fits neither the screen nor the render budget, and more importantly there's
 * nothing to do with a mouse on it. This view answers different questions:
 * where the vacation blocks sit, who hasn't had a weekend off in months,
 * whether roles are evenly spread.
 *
 * Hence read-only, and color comes from the role: the same colors as the
 * grid, People, and the timeline.
 */

import { useMemo } from 'react';
import type { IsoDate } from '../../domain/types.ts';
import { parseDate } from '../../engine/dates.ts';
import { useUi } from '../../store/useUi.ts';
import { useElementWidth } from '../../ui/useElementWidth.ts';
import type { GridRow, PlanningView } from './usePlanningView.ts';
import { STATUS_LABEL } from './GridCell.tsx';

const NAME_W = 185;
/** NOTE: Floor for the dot size: below this it can't be told apart even looking on purpose. */
const MIN_DAY_W = 4;

export function HeatmapGrid({ view }: { readonly view: PlanningView }) {
  const setZoom = useUi((s) => s.setScheduleZoom);
  const { rows, columns } = view;
  const [fillRef, fillWidth] = useElementWidth<HTMLDivElement>();

  /** NOTE: Month headers: weekly groups over 180 columns would be unreadable. */
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

  // NOTE: Same trick as the grid: zoom stretches dots to fill screen width
  // instead of a fixed 7px, with a floor where a dot would otherwise become a line.
  const dayW =
    columns.length > 0 ? Math.max(MIN_DAY_W, (fillWidth - NAME_W) / columns.length) : MIN_DAY_W;
  const template = `var(--name-w) repeat(${columns.length}, ${dayW}px)`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-sunken px-3 py-1.5 text-[11.5px] text-muted">
        <span>Read-only overview — {columns.length} days.</span>
        <button type="button" className="btn btn--sm" onClick={() => setZoom('month')}>
          Switch to Month to edit
        </button>
        <Legend />
      </div>

      <div ref={fillRef} className="min-h-0 flex-1 overflow-auto">
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
        const shift = value.kind === 'SHIFT' ? view.shiftById(value.shiftId) : undefined;
        return (
          <div
            key={column.date}
            className="heat__cell"
            style={{ background: colorOf(value, shift?.color, column.isNonWorking) }}
            title={labelOf(row.person.displayName, column.date, value, shift?.code)}
          />
        );
      })}
    </>
  );
}

function colorOf(
  value: ReturnType<PlanningView['cellAt']>,
  shiftColor: string | undefined,
  nonWorking: boolean,
): string {
  if (value.kind === 'SHIFT') return shiftColor ?? 'var(--accent)';
  if (value.kind === 'STATUS') {
    switch (value.status) {
      // The type carries its own colour now (ADR-0049); at heatmap scale a single
      // "away" tone reads better than seven near-identical ones.
      case 'ABSENT':
        return value.event?.color ?? 'var(--warn)';
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
  shiftCode: string | undefined,
): string {
  const what =
    value.kind === 'SHIFT'
      ? (shiftCode ?? 'assigned')
      : value.kind === 'STATUS'
        ? STATUS_LABEL[value.status]
        : '—';
  return `${name} · ${date}\n${what}`;
}
