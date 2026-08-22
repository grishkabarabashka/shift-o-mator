/**
 * NOTE: Manual entry and editing of absences. Creation comes either from a grid
 * selection (`SelectionToolbar`) — one record per selected person, all in a single
 * batch patch — or from a single cell's context menu (`GridCell`). Editing starts from
 * a double-click or a menu item on an existing marker.
 *
 * `COMP_DAY` is not in the type list: a comp day is a `CompDayEntry` with a balance
 * (ADR-0007), not an absence; it is edited through `CompDayDialog`.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import type { Absence, AbsenceType } from '../../domain/types.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import { useUi, type AbsenceRangeTarget } from '../../store/useUi.ts';
import { Select, type SelectOption } from '../../ui/primitives.tsx';

const TYPE_OPTIONS: readonly SelectOption[] = [
  { value: 'VACATION', label: 'Vacation' },
  { value: 'TRAINING', label: 'Training' },
  { value: 'SICK', label: 'Sick leave' },
  { value: 'OTHER', label: 'Other' },
];

let seq = 0;
function newAbsenceId(): string {
  seq += 1;
  return `abs-local-${Date.now().toString(36)}-${seq}`;
}

function buildCreated(target: AbsenceRangeTarget, type: AbsenceType, note: string): Absence {
  return {
    id: newAbsenceId(),
    personId: target.personId,
    type,
    from: target.from,
    to: target.to,
    source: 'MANUAL',
    ...(note ? { note } : {}),
  };
}

/** NOTE: Editing keeps origin fields (`source`, import) untouched. */
function buildUpdated(base: Absence, type: AbsenceType, note: string): Absence {
  return {
    id: base.id,
    personId: base.personId,
    type,
    from: base.from,
    to: base.to,
    source: base.source,
    ...(base.importBatchId !== undefined ? { importBatchId: base.importBatchId } : {}),
    ...(base.lastSeenInImportAt !== undefined
      ? { lastSeenInImportAt: base.lastSeenInImportAt }
      : {}),
    ...(base.syncedToHrAt !== undefined ? { syncedToHrAt: base.syncedToHrAt } : {}),
    ...(note ? { note } : {}),
  };
}

export function AbsenceDialog() {
  const draft = useUi((s) => s.absenceDraft);
  const close = useUi((s) => s.closeAbsenceDialog);
  const setAbsence = useSchedule((s) => s.setAbsence);
  const setAbsences = useSchedule((s) => s.setAbsences);
  const people = useSchedule((s) => s.reference?.people);

  const [type, setType] = useState<AbsenceType>('VACATION');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (draft?.mode === 'edit') {
      setType(draft.absence.type);
      setNote(draft.absence.note ?? '');
    } else {
      setType('VACATION');
      setNote('');
    }
  }, [draft]);

  if (!draft) return null;

  const nameOf = (personId: string): string =>
    people?.find((p) => p.id === personId)?.displayName ?? personId;

  const targets: ReadonlyArray<{ personId: string; from: string; to: string }> =
    draft.mode === 'create'
      ? draft.targets
      : [{ personId: draft.absence.personId, from: draft.absence.from, to: draft.absence.to }];

  const save = () => {
    if (draft.mode === 'create') {
      setAbsences(draft.targets.map((target) => buildCreated(target, type, note.trim())));
    } else {
      setAbsence(buildUpdated(draft.absence, type, note.trim()), draft.absence);
    }
    close();
  };

  const remove = () => {
    if (draft.mode === 'edit') setAbsence(null, draft.absence);
    close();
  };

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
          <Dialog.Title className="dialog__title">
            {draft.mode === 'create' ? 'Mark absence' : 'Edit absence'}
          </Dialog.Title>

          <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-muted">
            {targets.map((target) => (
              <span key={`${target.personId}-${target.from}`}>
                {nameOf(target.personId)}:{' '}
                {target.from === target.to ? target.from : `${target.from}–${target.to}`}
              </span>
            ))}
          </div>

          <label className="mb-3 block text-[12px] font-medium text-muted">
            Type
            <Select
              ariaLabel="Absence type"
              value={type}
              onChange={(value) => setType(value as AbsenceType)}
              options={TYPE_OPTIONS}
            />
          </label>

          <label className="mb-1 block text-[12px] font-medium text-muted">
            Comment
            <textarea
              className="field mt-1 h-20 w-full resize-none py-2 leading-snug"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          <div className="mt-4 flex justify-end gap-2">
            {draft.mode === 'edit' ? (
              <button type="button" className="btn" onClick={remove}>
                Delete
              </button>
            ) : null}
            <Dialog.Close asChild>
              <button type="button" className="btn">
                Cancel
              </button>
            </Dialog.Close>
            <button type="button" className="btn btn--primary" onClick={save}>
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
