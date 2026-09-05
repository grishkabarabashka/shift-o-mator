/**
 * Placing an earned comp day.
 *
 * The accrual exists from the moment the weekend shift was published, and the system
 * auto-places a **proposal** per policy (ADR-0007). What happens here is the engineer
 * choosing which day they actually want — which is a request, decided by an approver
 * (ADR-0052). It used to be a planner writing the date straight into a draft, which put
 * the person whose day off it is out of the loop entirely.
 *
 * Marking one taken or declining it stays a planner's direct edit: those record what
 * became of a day already settled, not which day it should be.
 *
 * Comp days never expire: instead of a deadline there is an age and a highlight
 * threshold.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { effectiveCompDayDate, type CompDayEntry, type CompDayStatus, type IsoDate } from '../../domain/types.ts';
import { daysBetween } from '../../engine/dates.ts';
import { useCreateRequest, useRequestTypes } from '../../api/requests.ts';
import { useCapabilities } from '../../auth/useCapabilities.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import { useUi } from '../../store/useUi.ts';
import { useReference } from '../../store/useDataset.ts';

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
  const createRequest = useCreateRequest();
  const requestTypes = useRequestTypes();
  const caps = useCapabilities();
  const reference = useReference();
  const person = reference?.people.find((p) => p.id === entry?.personId);
  const unit = reference?.units.find((u) => u.id === person?.unitId);

  const [actualDate, setActualDate] = useState('');

  const setActionError = useSchedule((s) => s.setActionError);
  const selfId = useSchedule((s) => s.currentUserId);
  const aboutSelf = entry?.personId === selfId;
  const firstName = person?.displayName.split(' ')[0] ?? 'them';

  useEffect(() => {
    if (entry) setActualDate(effectiveCompDayDate(entry) ?? '');
  }, [entry]);

  if (!entry) return null;

  const apply = (status: CompDayStatus): void => {
    setCompDay({ ...entry, status, actualDate }, entry);
    close();
  };

  /**
   * Asks for the chosen day. The server checks it against the unit's comp-off policy
   * before it reaches anyone's inbox: an approver is being asked "is this a good day for
   * the team", not "is this date legal".
   */
  const askFor = (): void => {
    const type = requestTypes.data?.find((t) => t.code === 'COMP_DAY');
    if (!type) {
      // A button that silently does nothing is worse than one that says why. This is a
      // seeding problem, not a user error: the COMP_DAY request type is data.
      setActionError('No "Comp day" request type is configured, so there is nowhere to send this.');
      return;
    }
    if (actualDate === '') return;
    createRequest.mutate({
      typeId: type.id,
      subjectPersonId: entry.personId,
      compDayId: entry.id,
      from: actualDate,
      to: actualDate,
    });
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

  /**
   * WHY not "different from the current date": the dialog opens with the *proposed* date
   * already filled in, and that was the date being compared against — so the button was
   * dead on arrival and you had to nudge the date somewhere else and back to enable it.
   * A proposal is a suggestion nobody has agreed to; asking for exactly the day the
   * system proposed is the single most likely thing to want.
   *
   * The only pointless case is asking for a day already *scheduled*, which is settled.
   */
  const alreadySettledOnThisDay =
    entry.status === 'SCHEDULED' && actualDate === effectiveCompDayDate(entry);

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
          <p className="mt-1 text-[11.5px] text-faint">
            {entry.proposedDate
              ? `Proposed ${entry.proposedDate} — earned for ${entry.earnedForDate}. `
              : `Earned for ${entry.earnedForDate}. `}
            Asking does not move the day yet: it raises a request, the cell shows it dashed
            until an approver decides, and only an approval sets the date.
          </p>

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button type="button" className="btn">
                Close
              </button>
            </Dialog.Close>
            {editable ? (
              <>
                {/* Bookkeeping on a day already settled — a planner's call, and unlike
                    the placement itself it needs nobody's approval. */}
                {caps.canPlan(person?.unitId) ? (
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
                  </>
                ) : null}
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={actualDate === '' || alreadySettledOnThisDay}
                  onClick={askFor}
                >
                  {aboutSelf ? 'Ask for this day' : `Ask on ${firstName}’s behalf`}
                </button>
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
