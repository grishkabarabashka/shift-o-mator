/**
 * Ручной ввод и правка отсутствий.
 *
 * Создание приходит из выделения в сетке (SelectionToolbar): по одной записи
 * на каждого выделенного человека, все — одним патчем-батчем. Правка —
 * с двойного клика по уже стоящей отметке.
 *
 * `COMP_DAY` в список типов не входит: отгул — это `CompDayEntry` с балансом
 * (ADR-0007), а не отсутствие; он редактируется через CompDayDialog.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import type { Absence, AbsenceType } from '../../domain/types.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import { useUi, type AbsenceRangeTarget } from '../../store/useUi.ts';
import { Select, type SelectOption } from '../../ui/primitives.tsx';

const TYPE_OPTIONS: readonly SelectOption[] = [
  { value: 'VACATION', label: 'Отпуск' },
  { value: 'TRAINING', label: 'Обучение' },
  { value: 'SICK', label: 'Больничный' },
  { value: 'OTHER', label: 'Прочее' },
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

/** Правка держит поля происхождения (`source`, импорт) нетронутыми. */
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
        <Dialog.Overlay className="dialog__overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title className="dialog__title">
            {draft.mode === 'create' ? 'Отметить отсутствие' : 'Изменить отсутствие'}
          </Dialog.Title>

          <div className="dialog__people">
            {targets.map((target) => (
              <span key={`${target.personId}-${target.from}`}>
                {nameOf(target.personId)}:{' '}
                {target.from === target.to ? target.from : `${target.from}–${target.to}`}
              </span>
            ))}
          </div>

          <label>
            Тип
            <Select
              ariaLabel="Тип отсутствия"
              value={type}
              onChange={(value) => setType(value as AbsenceType)}
              options={TYPE_OPTIONS}
            />
          </label>

          <label>
            Комментарий
            <textarea value={note} onChange={(event) => setNote(event.target.value)} />
          </label>

          <div className="dialog__actions">
            {draft.mode === 'edit' ? (
              <button type="button" className="btn" onClick={remove}>
                Удалить
              </button>
            ) : null}
            <Dialog.Close asChild>
              <button type="button" className="btn">
                Отмена
              </button>
            </Dialog.Close>
            <button type="button" className="btn btn--primary" onClick={save}>
              Сохранить
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
