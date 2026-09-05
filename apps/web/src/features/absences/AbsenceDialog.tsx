/**
 * Recording — or asking for — a non-working day.
 *
 * Two paths through one dialog (ADR-0049, ADR-0047):
 *
 * - a planner records directly, which is administrative entry on anyone's behalf;
 * - anyone else raises a **request**, which appears in the grid as pending and becomes
 *   an absence only once approved.
 *
 * The type list is data. A type that does not require approval — sickness, which you
 * report rather than ask for — is recorded directly by everybody.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState } from 'react';
import { useCreateRequest, useRequestTypes } from '../../api/requests.ts';
import { useCapabilities } from '../../auth/useCapabilities.ts';
import type { AbsenceUpsert } from '../../api/schedule.ts';
import type { DayPortion, EventType } from '../../domain/types.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import { useUi, type AbsenceRangeTarget } from '../../store/useUi.ts';
import { Select, type SelectOption } from '../../ui/primitives.tsx';
import { useReference } from '../../store/useDataset.ts';

const PORTION_OPTIONS: readonly SelectOption[] = [
  { value: 'FULL', label: 'Whole day' },
  { value: 'MORNING', label: 'Morning only' },
  { value: 'AFTERNOON', label: 'Afternoon only' },
];

// The id used to be minted here for the draft to carry. The server mints it now
// (ADR-0052) — an absence is a direct write, not a staged change.

export function AbsenceDialog() {
  const draft = useUi((s) => s.absenceDraft);
  const close = useUi((s) => s.closeAbsenceDialog);
  const saveAbsence = useSchedule((s) => s.saveAbsence);
  const setActionError = useSchedule((s) => s.setActionError);
  const removeAbsence = useSchedule((s) => s.removeAbsence);
  const eventTypes = useReference()?.eventTypes;
  const caps = useCapabilities();
  const requestTypes = useRequestTypes();
  const createRequest = useCreateRequest();

  const [eventTypeId, setEventTypeId] = useState('');
  const [portion, setPortion] = useState<DayPortion>('FULL');
  const [note, setNote] = useState('');

  const types = useMemo(
    () => [...(eventTypes ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [eventTypes],
  );

  useEffect(() => {
    if (!draft) return;
    if (draft.mode === 'edit') {
      setEventTypeId(draft.absence.eventTypeId);
      setPortion(draft.absence.portion);
      setNote(draft.absence.note ?? '');
    } else {
      setEventTypeId(types[0]?.id ?? '');
      setPortion('FULL');
      setNote('');
    }
  }, [draft, types]);

  if (!draft) return null;

  const selected: EventType | undefined = types.find((t) => t.id === eventTypeId);

  // Needing approval is a property of the kind of leave, not of who is recording it
  // (ADR-0051) — a planner asks like anybody else. Sickness is reported, not requested.
  const asRequest = selected?.requiresApproval ?? true;
  const requestType = requestTypes.data?.find((t) => t.code === selected?.code);

  const typeOptions: readonly SelectOption[] = types.map((t) => ({ value: t.id, label: t.label }));

  /**
   * Who and when this is about — the selection when creating, the edited record when
   * editing.
   *
   * WHY editing contributes a target: it used to yield an empty list, so changing the kind
   * of an existing absence to anything needing approval looped zero times and closed the
   * dialog having done nothing at all. Now nearly every kind needs approval (ADR-0052), so
   * that was almost every edit.
   */
  const targets: readonly AbsenceRangeTarget[] =
    draft.mode === 'create'
      ? draft.targets
      : [
          {
            personId: draft.absence.personId,
            from: draft.absence.from,
            to: draft.absence.to,
          },
        ];
  const range =
    draft.mode === 'edit'
      ? { from: draft.absence.from, to: draft.absence.to }
      : (targets[0] ?? { from: '', to: '' });

  const build = (target: AbsenceRangeTarget): AbsenceUpsert => ({
    personId: target.personId,
    eventTypeId,
    portion,
    from: target.from,
    to: target.to,
    ...(note ? { note } : {}),
  });

  const save = async () => {
    if (!eventTypeId) return;

    if (asRequest) {
      if (!requestType) {
        setActionError(
          `No request type is configured for ${selected?.label ?? 'this kind of leave'}, so there is nowhere to send this.`,
        );
        return;
      }
      // Changing the kind of an existing absence is a **new request**, not an edit: the
      // approval writes the row, and the new row supersedes the old one for those days
      // (ADR-0052). Editing the type in place would have skipped the approval.
      for (const target of targets) {
        await new Promise<void>((resolve) => {
          createRequest.mutate(
            {
              typeId: requestType.id,
              subjectPersonId: target.personId,
              from: target.from,
              to: target.to,
              portion,
              ...(note ? { note } : {}),
            },
            { onSettled: () => resolve() },
          );
        });
      }
      close();
      return;
    }

    if (draft.mode === 'edit') {
      await saveAbsence({
        id: draft.absence.id,
        personId: draft.absence.personId,
        eventTypeId,
        portion,
        from: draft.absence.from,
        to: draft.absence.to,
        // Round-tripped untouched, so the server can tell a stale edit from a fresh one
        // (ADR-0042).
        version: draft.absence.version,
        ...(note ? { note } : {}),
      });
    } else {
      // Sequential rather than parallel: each is its own row, and a failure part-way
      // through should leave the ones already written alone rather than racing them.
      for (const target of targets) await saveAbsence(build(target));
    }
    close();
  };

  const remove = async () => {
    if (draft.mode !== 'edit') return;
    await removeAbsence(draft.absence.id);
    close();
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog__overlay" />
        <Dialog.Content className="dialog w-[min(460px,calc(100vw-32px))]">
          <Dialog.Title className="dialog__title">
            {draft.mode === 'edit'
              ? 'Edit absence'
              : asRequest
                ? 'Ask for time off'
                : 'Record an absence'}
          </Dialog.Title>

          <p className="mb-3 text-[12.5px] text-faint">
            {range.from === range.to ? range.from : `${range.from} → ${range.to}`}
            {draft.mode === 'create' && targets.length > 1 ? ` · ${targets.length} people` : ''}
          </p>

          <label className="mb-3 block text-[12.5px]">
            <span className="mb-1 block font-medium">Type</span>
            <Select
              value={eventTypeId}
              onChange={setEventTypeId}
              options={typeOptions}
              ariaLabel="Absence type"
            />
          </label>

          {selected?.allowsHalfDay ? (
            <label className="mb-3 block text-[12.5px]">
              <span className="mb-1 block font-medium">How much of the day</span>
              <Select
                value={portion}
                onChange={(value) => setPortion(value as DayPortion)}
                options={PORTION_OPTIONS}
                ariaLabel="How much of the day"
              />
            </label>
          ) : null}

          <label className="mb-4 block text-[12.5px]">
            <span className="mb-1 block font-medium">Note (optional)</span>
            <input
              className="input w-full"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          {asRequest ? (
            <p className="mb-3 text-[11.5px] text-faint">
              This goes to an approver. It shows on the schedule as pending until they
              decide.
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            {draft.mode === 'edit' && caps.plansSomewhere ? (
              <button type="button" className="btn btn--sm mr-auto" onClick={remove}>
                Delete
              </button>
            ) : null}
            <button type="button" className="btn btn--sm" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--sm btn--primary"
              disabled={!eventTypeId || (asRequest && !requestType)}
              onClick={() => void save()}
            >
              {asRequest ? 'Send request' : 'Save'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
