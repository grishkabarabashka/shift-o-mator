/**
 * Review & publish — ADR-0015.
 *
 * Ничего не становится публичным без этого экрана: счётчики, построчный diff
 * старое → новое, влияние на покрытие. Публикация атомарна; при расхождении
 * версий показывается сравнение, а черновик **сохраняется целиком**.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useMemo } from 'react';
import { summarizeChanges } from '../../domain/draft.ts';
import type { DraftChange } from '../../domain/types.ts';
import { canPublish } from '../../engine/issues.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import type { PlanningView } from './usePlanningView.ts';

interface Props {
  readonly view: PlanningView;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ReviewDialog({ view, open, onClose }: Props) {
  const changes = useSchedule((s) => s.changes);
  const publish = useSchedule((s) => s.publish);
  const discard = useSchedule((s) => s.discard);
  const publishing = useSchedule((s) => s.publishing);
  const conflicts = useSchedule((s) => s.conflicts);

  const summary = useMemo(() => summarizeChanges(changes), [changes]);
  const { gaps, conflicts: dataConflicts, unacknowledgedWarnings } = view.issueSummary;
  const publishable = canPublish(view.issues, view.acknowledged);

  const onPublish = async (): Promise<void> => {
    const outcome = await publish();
    // Закрываем только при успехе: конфликт нужно показать здесь же.
    if (outcome?.ok) onClose();
  };

  if (!open) return null;

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog__overlay" />
        <Dialog.Content className="dialog dialog--wide">
          <Dialog.Title className="dialog__title">Review changes</Dialog.Title>

          <div className="review__counts">
            <span className="review__count">
              <strong>{summary.created}</strong> created
            </span>
            <span className="review__count">
              <strong>{summary.updated}</strong> modified
            </span>
            <span className="review__count">
              <strong>{summary.deleted}</strong> removed
            </span>
          </div>

          <div className="review__impact">
            <span className={gaps > 0 ? 'review__impact--bad' : 'review__impact--good'}>
              {gaps} coverage {gaps === 1 ? 'gap' : 'gaps'} remaining
            </span>
            <span className={dataConflicts > 0 ? 'review__impact--bad' : 'review__impact--good'}>
              {dataConflicts} {dataConflicts === 1 ? 'conflict' : 'conflicts'}
            </span>
            <span
              className={
                unacknowledgedWarnings > 0 ? 'review__impact--warn' : 'review__impact--good'
              }
            >
              {unacknowledgedWarnings} unacknowledged{' '}
              {unacknowledgedWarnings === 1 ? 'warning' : 'warnings'}
            </span>
          </div>

          {conflicts.length > 0 ? (
            <div className="review__conflicts">
              <strong>Publication was rejected — the schedule changed underneath you.</strong>
              <ul>
                {conflicts.map((conflict) => (
                  <li key={conflict.changeId}>{conflict.reason}</li>
                ))}
              </ul>
              <p>Your draft is intact. Reload the period and reapply.</p>
            </div>
          ) : null}

          <div className="review__list">
            {changes.length === 0 ? (
              <p className="issues__empty">No changes yet</p>
            ) : (
              changes.map((change) => (
                <ChangeRow key={change.id} change={change} view={view} />
              ))
            )}
          </div>

          {!publishable ? (
            <p className="dialog__body">
              {gaps + dataConflicts > 0
                ? 'Publication is blocked until every gap and conflict is resolved.'
                : 'Every warning must be acknowledged with a comment before publishing.'}
            </p>
          ) : null}

          <div className="dialog__actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                void discard();
                onClose();
              }}
            >
              Discard draft
            </button>
            <Dialog.Close asChild>
              <button type="button" className="btn">
                Keep editing
              </button>
            </Dialog.Close>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!publishable || publishing || changes.length === 0}
              onClick={() => void onPublish()}
            >
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ChangeRow({ change, view }: { change: DraftChange; view: PlanningView }) {
  const describe = (value: unknown): string => {
    if (value === null || value === undefined) return '—';
    if (change.targetType === 'ASSIGNMENT') {
      const assignment = value as { content: { kind: string; roleId?: string; marker?: string } };
      if (assignment.content.kind === 'ROLE' && assignment.content.roleId) {
        return view.roleById(assignment.content.roleId)?.code ?? assignment.content.roleId;
      }
      return assignment.content.marker === 'OFF' ? 'Off' : '0';
    }
    if (change.targetType === 'ABSENCE') {
      const absence = value as { type: string; from: string; to: string };
      return `${absence.type} ${absence.from}–${absence.to}`;
    }
    const entry = value as { status: string };
    return entry.status;
  };

  const anchor = (): string => {
    if (change.targetType === 'ASSIGNMENT') {
      const target = change.after ?? change.before;
      if (!target) return '';
      const person = view.rows.find(
        (row) => row.kind === 'person' && row.person.id === target.personId,
      );
      const name = person?.kind === 'person' ? person.person.displayName : target.personId;
      return `${name} · ${target.date}`;
    }
    const target = change.after ?? change.before;
    return target ? `${(target as { personId: string }).personId}` : '';
  };

  return (
    <div className="review__row">
      <span className="review__anchor">{anchor()}</span>
      <span className="review__from">{describe(change.before)}</span>
      <span className="review__arrow">→</span>
      <span className="review__to">{describe(change.after)}</span>
    </div>
  );
}
