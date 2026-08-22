/**
 * Одна ячейка сетки.
 *
 * Намеренно тупая и мемоизированная: ячеек на экране до двух с половиной тысяч,
 * и всё, что в ней есть лишнего, умножается на это число. Контекстное меню
 * живёт одно на всю сетку (`AssignmentPicker`), выделение приходит булевыми
 * пропами — так строки вне выделения не перерисовываются вовсе.
 *
 * Что показывать, решает проекция (`engine/cellValue.ts`), а не этот компонент:
 * приоритет «смена > отсутствие > отгул > праздник > маркер» живёт в одном месте.
 */

import { memo } from 'react';
import type { CellStatus, CellValue, IsoDate, Issue, PersonId, Shift } from '../../domain/types.ts';

/** Подписи статусов повторяют то, что было в исходной таблице. */
export const STATUS_LABEL: Record<CellStatus, string> = {
  OFF: 'Off',
  NOT_SCHEDULED: '0',
  PH: 'PH',
  COMP_OFF: 'C-Off',
  VACATION: 'Leave',
  SICK: 'Sick',
  OTHER: 'Absent',
};

interface Props {
  readonly personId: PersonId;
  readonly personName: string;
  readonly date: IsoDate;
  readonly value: CellValue;
  readonly shift: Shift | undefined;
  readonly issues: readonly Issue[];
  readonly nonWorking: boolean;
  readonly today: boolean;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly generationLocked: boolean;
}

function GridCellInner({
  personId,
  personName,
  date,
  value,
  shift,
  issues,
  nonWorking,
  today,
  selected,
  focused,
  generationLocked,
}: Props) {
  const status = value.kind === 'STATUS' ? value.status : undefined;
  const conflict = value.kind === 'SHIFT' ? value.conflict : undefined;

  const worstLevel = issues.some((issue) => issue.level === 'BLOCKING')
    ? 'BLOCKING'
    : issues.some((issue) => issue.level === 'WARNING')
      ? 'WARNING'
      : undefined;

  // Отпуск и подтверждённый отгул закрывают день; праздник и Off — нет.
  const locked =
    status === 'VACATION' || status === 'SICK' || status === 'OTHER' || status === 'COMP_OFF';

  return (
    <div
      className="cell"
      role="gridcell"
      data-cell
      data-person={personId}
      data-date={date}
      title={tooltipOf(personName, date, shift, status, conflict, issues, generationLocked)}
      data-nonworking={nonWorking || undefined}
      data-today={today || undefined}
      data-absent={locked || undefined}
      data-selected={selected || undefined}
      data-focused={focused || undefined}
      data-issue={worstLevel}
      data-conflict={conflict !== undefined || undefined}
    >
      {value.kind === 'SHIFT' && shift ? (
        <span className="chip" style={{ background: shift.color }}>
          {generationLocked ? <span className="chip__lock" aria-hidden /> : null}
          {shift.code}
        </span>
      ) : status ? (
        <span className="cell__status">{STATUS_LABEL[status]}</span>
      ) : value.kind === 'EMPTY' && value.proposedCompDay ? (
        // Предложенный отгул — подсказка пунктиром, день ещё свободен.
        <span className="cell__hint">C-Off?</span>
      ) : null}
    </div>
  );
}

function tooltipOf(
  personName: string,
  date: IsoDate,
  shift: Shift | undefined,
  status: CellStatus | undefined,
  conflict: string | undefined,
  issues: readonly Issue[],
  generationLocked: boolean,
): string {
  const parts: string[] = [`${personName} · ${date}`];
  if (shift) {
    parts.push(`${shift.code} ${shift.start}–${shift.end} (${shortZone(shift.timeZone)})`);
    if (shift.description) parts.push(shift.description);
  }
  if (status) parts.push(STATUS_LABEL[status]);
  if (conflict) parts.push(`Conflict: assigned over ${conflict.toLowerCase()}`);
  for (const issue of issues) parts.push(issue.message);
  if (generationLocked) parts.push('Locked — auto-populate will not replace this');
  return parts.join('\n');
}

function shortZone(zone: string): string {
  return zone.split('/').at(-1)?.replace(/_/g, ' ') ?? zone;
}

export const GridCell = memo(GridCellInner);
