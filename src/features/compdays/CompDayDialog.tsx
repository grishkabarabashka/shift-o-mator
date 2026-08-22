/**
 * Подтверждение и перенос отгула.
 *
 * Система только предлагает дату по политике (ADR-0007); здесь планировщик
 * подтверждает предложение (`PROPOSED` → `SCHEDULED`), переносит дату,
 * отмечает отгуленным или отклоняет. Подтверждённый отгул после этого
 * блокирует назначение — см. `compDayBlocksAssignment`.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { effectiveCompDayDate, type CompDayEntry, type CompDayStatus } from '../../domain/types.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import { useUi } from '../../store/useUi.ts';

const STATUS_LABEL: Record<CompDayStatus, string> = {
  PROPOSED: 'предложен',
  SCHEDULED: 'запланирован',
  TAKEN: 'отгулян',
  EXPIRED: 'сгорел',
  DECLINED: 'отклонён',
};

export function CompDayDialog() {
  const entry = useUi((s) => s.compDayDraft);
  const close = useUi((s) => s.closeCompDayDialog);
  const setCompDay = useSchedule((s) => s.setCompDay);
  const person = useSchedule((s) => s.reference?.people.find((p) => p.id === entry?.personId));

  const [actualDate, setActualDate] = useState('');

  useEffect(() => {
    if (entry) setActualDate(effectiveCompDayDate(entry));
  }, [entry]);

  if (!entry) return null;

  const apply = (status: CompDayStatus): void => {
    const updated: CompDayEntry = { ...entry, status, actualDate };
    setCompDay(updated, entry);
    close();
  };

  const decline = (): void => {
    setCompDay({ ...entry, status: 'DECLINED' }, entry);
    close();
  };

  const editable = entry.status === 'PROPOSED' || entry.status === 'SCHEDULED';

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
          <Dialog.Title className="dialog__title">Отгул за {entry.earnedForDate}</Dialog.Title>
          <Dialog.Description className="dialog__body">
            {person?.displayName ?? entry.personId} · {STATUS_LABEL[entry.status]} · сгорает{' '}
            {entry.expiresOn}
          </Dialog.Description>

          <label>
            Дата отгула
            <input
              type="date"
              value={actualDate}
              disabled={!editable}
              onChange={(event) => setActualDate(event.target.value)}
            />
          </label>

          <div className="dialog__actions">
            <Dialog.Close asChild>
              <button type="button" className="btn">
                Закрыть
              </button>
            </Dialog.Close>
            {editable ? (
              <>
                <button type="button" className="btn" onClick={decline}>
                  Отклонить
                </button>
                <button type="button" className="btn" onClick={() => apply('TAKEN')}>
                  Отмечено отгуленным
                </button>
                <button type="button" className="btn btn--primary" onClick={() => apply('SCHEDULED')}>
                  {entry.status === 'PROPOSED' ? 'Подтвердить' : 'Перенести'}
                </button>
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
