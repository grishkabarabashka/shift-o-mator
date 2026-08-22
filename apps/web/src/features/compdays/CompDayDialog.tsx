/**
 * NOTE: Confirming and rescheduling a comp day. The system only proposes a date per
 * policy (ADR-0007); here the planner confirms the proposal (`PROPOSED` →
 * `SCHEDULED`), reschedules the date, marks it taken, or declines it. A confirmed
 * comp day then blocks assignment.
 *
 * Comp days never expire: instead of a deadline there is an age and a
 * highlight threshold.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { effectiveCompDayDate, type CompDayEntry, type CompDayStatus, type IsoDate } from '../../domain/types.ts';
import { daysBetween } from '../../engine/dates.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import { useUi } from '../../store/useUi.ts';

/** WHY: Accrual age in days as of the reference date. This used to live in
 * `engine/compDays.ts` alongside the accrual engine itself — that file was removed
 * along with the port to the backend. */
function compDayAge(entry: CompDayEntry, asOf: IsoDate): number {
  return daysBetween(entry.earnedForDate, asOf);
}

const STATUS_LABEL: Record<CompDayStatus, string> = {
  PROPOSED: 'proposed',
  SCHEDULED: 'scheduled',
  TAKEN: 'taken',
  DECLINED: 'declined',
  PENDING_APPROVAL: 'awaiting approval',
};

interface Props {
  /** NOTE: Today's date: the engine does not read the clock itself. */
  readonly asOf: string;
}

export function CompDayDialog({ asOf }: Props) {
  const entry = useUi((s) => s.compDayDraft);
  const close = useUi((s) => s.closeCompDayDialog);
  const setCompDay = useSchedule((s) => s.setCompDay);
  const person = useSchedule((s) => s.reference?.people.find((p) => p.id === entry?.personId));
  const unit = useSchedule((s) =>
    s.reference?.units.find((u) => u.id === person?.unitId),
  );

  const [actualDate, setActualDate] = useState('');

  useEffect(() => {
    if (entry) setActualDate(effectiveCompDayDate(entry) ?? '');
  }, [entry]);

  if (!entry) return null;

  const apply = (status: CompDayStatus): void => {
    setCompDay({ ...entry, status, actualDate }, entry);
    close();
  };

  const decline = (): void => {
    setCompDay({ ...entry, status: 'DECLINED' }, entry);
    close();
  };

  const editable =
    entry.status === 'PROPOSED' ||
    entry.status === 'SCHEDULED' ||
    entry.status === 'PENDING_APPROVAL';

  const age = compDayAge(entry, asOf);
  const threshold = unit?.compOffPolicy.agingThresholdDays ?? 14;
  const aged = editable && age > threshold;

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title className="dialog__title">Comp day for {entry.earnedForDate}</Dialog.Title>
          <Dialog.Description className="mb-3 text-[13px] text-muted">
            {person?.displayName ?? entry.personId} · {STATUS_LABEL[entry.status]} · earned{' '}
            {age} {age === 1 ? 'day' : 'days'} ago
            {aged ? ' — outstanding longer than the threshold' : ''}
          </Dialog.Description>

          {entry.status === 'PENDING_APPROVAL' ? (
            <p className="mb-3 text-[12.5px] text-warn">
              No free eligible date was found inside the policy window. Pick a date manually.
            </p>
          ) : null}

          <label className="mb-1 block text-[12px] font-medium text-muted">
            Comp day date
            <input
              type="date"
              className="field mt-1 py-1"
              value={actualDate}
              disabled={!editable}
              onChange={(event) => setActualDate(event.target.value)}
            />
          </label>

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button type="button" className="btn">
                Close
              </button>
            </Dialog.Close>
            {editable ? (
              <>
                <button type="button" className="btn" onClick={decline}>
                  Decline
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={actualDate === ''}
                  onClick={() => apply('TAKEN')}
                >
                  Mark taken
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={actualDate === ''}
                  onClick={() => apply('SCHEDULED')}
                >
                  {entry.status === 'SCHEDULED' ? 'Reschedule' : 'Confirm'}
                </button>
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
