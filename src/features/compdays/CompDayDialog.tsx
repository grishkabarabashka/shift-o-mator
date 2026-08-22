/**
 * Подтверждение и перенос отгула.
 *
 * Система только предлагает дату по политике (ADR-0007); здесь планировщик
 * подтверждает предложение (`PROPOSED` → `SCHEDULED`), переносит дату,
 * отмечает отгуленным или отклоняет. Подтверждённый отгул после этого
 * блокирует назначение.
 *
 * Отгулы не сгорают: вместо срока — возраст и порог подсветки.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { effectiveCompDayDate, type CompDayEntry, type CompDayStatus, type IsoDate } from '../../domain/types.ts';
import { daysBetween } from '../../engine/dates.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import { useUi } from '../../store/useUi.ts';

/** Возраст начисления в днях на дату отсчёта. Раньше жила в `engine/compDays.ts`
 * вместе с самим движком начисления — тот файл удалён вместе с портом на бэкенд. */
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
  /** Сегодняшняя дата: движок не читает часы сам. */
  readonly asOf: string;
}

export function CompDayDialog({ asOf }: Props) {
  const entry = useUi((s) => s.compDayDraft);
  const close = useUi((s) => s.closeCompDayDialog);
  const setCompDay = useSchedule((s) => s.setCompDay);
  const person = useSchedule((s) => s.reference?.people.find((p) => p.id === entry?.personId));
  const region = useSchedule((s) =>
    s.reference?.regions.find((r) => r.id === person?.regionId),
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
  const threshold = region?.compOffPolicy.agingThresholdDays ?? 14;
  const aged = editable && age > threshold;

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
          <Dialog.Title className="dialog__title">Comp day for {entry.earnedForDate}</Dialog.Title>
          <Dialog.Description className="dialog__body">
            {person?.displayName ?? entry.personId} · {STATUS_LABEL[entry.status]} · earned{' '}
            {age} {age === 1 ? 'day' : 'days'} ago
            {aged ? ' — outstanding longer than the threshold' : ''}
          </Dialog.Description>

          {entry.status === 'PENDING_APPROVAL' ? (
            <p className="dialog__body">
              No free eligible date was found inside the policy window. Pick a date manually.
            </p>
          ) : null}

          <label>
            Comp day date
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
