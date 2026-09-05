/**
 * The actions on a day of your own calendar.
 *
 * It is `CellSelfServiceMenu` in a floating shell and nothing else. WHY that matters: this
 * screen must not become a second way to ask for leave. One menu means one set of rules
 * about what needs approving, one route for each thing, and a change made once — which is
 * the property the grid's single `AssignmentPicker` was built for and the same reason
 * applies here.
 */

import { useMemo } from 'react';
import { CellSelfServiceMenu } from '../planning/CellSelfServiceMenu.tsx';
import { FloatingMenu } from '../planning/FloatingMenu.tsx';
import { useUi } from '../../store/useUi.ts';
import type { IsoDate, PersonId } from '../../domain/types.ts';
import { eachDate } from '../../engine/dates.ts';
import { useDataset, useReference } from '../../store/useDataset.ts';

export function CalendarDayMenu({
  personId,
  from,
  to,
  x,
  y,
  closedOut,
  onClose,
}: {
  readonly personId: PersonId;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly x: number;
  readonly y: number;
  readonly closedOut: boolean;
  readonly onClose: () => void;
}) {
  const reference = useReference();
  const presenceRecords = useDataset().plan?.presence ?? [];
  const openAbsenceCreate = useUi((s) => s.openAbsenceCreate);

  const cells = useMemo(
    () => eachDate({ from, to }).map((date) => ({ personId, date })),
    [personId, from, to],
  );

  const unitId = reference?.people.find((p) => p.id === personId)?.unitId;

  // Records the store happens to hold over these days. The store carries the *planning*
  // window, so this is empty when the calendar is scrolled somewhere else — Clear is
  // offered where it can be honoured and not where it cannot, which is better than an
  // action that silently does nothing.
  const presenceIds = useMemo(
    () =>
      presenceRecords
        .filter((r) => r.personId === personId && r.from <= to && r.to >= from)
        .map((r) => r.id),
    [presenceRecords, personId, from, to],
  );

  const days = eachDate({ from, to }).length;

  return (
    <FloatingMenu
      x={x}
      y={y}
      anchorKey={`${from}|${to}`}
      label="Day"
      width={276}
      onClose={onClose}
    >
      <div className="menu-label flex items-baseline justify-between gap-2 normal-case">
        <span className="truncate text-[12px] font-semibold tracking-normal text-ink">
          {from === to ? from : `${from} → ${to}`}
        </span>
        {days > 1 ? <span className="shrink-0 text-[11px] text-accent">{days} days</span> : null}
      </div>

      <CellSelfServiceMenu
        cells={cells}
        subjectPersonId={personId}
        subjectUnitId={unitId}
        closedOut={closedOut}
        locations={reference?.locations ?? []}
        presenceIds={presenceIds}
        onMore={() => openAbsenceCreate([{ personId, from, to }])}
        onDone={onClose}
      />
    </FloatingMenu>
  );
}
