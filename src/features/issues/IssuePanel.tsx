/**
 * Боковая панель нарушений.
 *
 * Клик по строке ведёт в соответствующую ячейку сетки — без этого список
 * нарушений превращается в декорацию.
 *
 * Предупреждение снимается только осознанно: с комментарием, который остаётся
 * в плане. Через полгода видно, сколько раз и почему приходилось выходить за
 * рамки (ADR-0009).
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import type { Issue, IssueLevel } from '../../domain/types.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import { useUi } from '../../store/useUi.ts';
import type { PlanningView } from '../planning/usePlanningView.ts';

interface Props {
  readonly view: PlanningView;
}

const FILTERS: ReadonlyArray<{ value: IssueLevel | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Все' },
  { value: 'BLOCKING', label: 'Блокеры' },
  { value: 'WARNING', label: 'Предупр.' },
  { value: 'INFO', label: 'Инфо' },
];

export function IssuePanel({ view }: Props) {
  const filter = useUi((s) => s.issueFilter);
  const setFilter = useUi((s) => s.setIssueFilter);
  const select = useUi((s) => s.select);
  const focusDate = useUi((s) => s.focusDate);
  const acknowledge = useSchedule((s) => s.acknowledge);

  const [pendingAck, setPendingAck] = useState<Issue | undefined>();
  const [comment, setComment] = useState('');

  const issues = view.issues.filter((issue) => filter === 'ALL' || issue.level === filter);

  const goTo = (issue: Issue) => {
    if (issue.personId && issue.date) select({ personId: issue.personId, date: issue.date });
    else if (issue.date) focusDate(issue.date);
  };

  const confirm = () => {
    if (!pendingAck || comment.trim().length === 0) return;
    acknowledge(pendingAck.key, comment.trim());
    setPendingAck(undefined);
    setComment('');
  };

  return (
    <aside className="issues" aria-label="Нарушения">
      <div className="issues__head">
        <span>Нарушения</span>
        <span>{view.issues.length}</span>
      </div>

      <div className="issues__filters">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            className="issues__filter"
            data-active={filter === item.value}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="issues__list">
        {issues.length === 0 ? (
          <p className="issues__empty">Ничего не найдено</p>
        ) : (
          issues.map((issue) => {
            const ack = view.acknowledged.has(issue.key);
            return (
              <button
                key={issue.key}
                type="button"
                className="issue"
                onClick={() => goTo(issue)}
                onDoubleClick={() => {
                  if (issue.level === 'WARNING' && !ack) setPendingAck(issue);
                }}
              >
                <span className="issue__top">
                  <span className="issue__level" data-level={issue.level}>
                    {issue.level === 'BLOCKING' ? 'BLK' : issue.level === 'WARNING' ? 'WRN' : 'INF'}
                  </span>
                  {issue.date ? <span className="issue__date">{issue.date}</span> : null}
                </span>
                <span className="issue__message">{issue.message}</span>
                {issue.level === 'WARNING' ? (
                  <span className="issue__ack">
                    {ack ? 'подтверждено' : 'двойной клик — подтвердить с комментарием'}
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>

      <Dialog.Root
        open={pendingAck !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setPendingAck(undefined);
            setComment('');
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog__overlay" />
          <Dialog.Content className="dialog">
            <Dialog.Title className="dialog__title">Подтвердить нарушение</Dialog.Title>
            <Dialog.Description className="dialog__body">{pendingAck?.message}</Dialog.Description>
            <textarea
              value={comment}
              placeholder="Почему выходим за рамки"
              onChange={(event) => setComment(event.target.value)}
              autoFocus
            />
            <div className="dialog__actions">
              <Dialog.Close asChild>
                <button type="button" className="btn">
                  Отмена
                </button>
              </Dialog.Close>
              <button
                type="button"
                className="btn btn--primary"
                disabled={comment.trim().length === 0}
                onClick={confirm}
              >
                Подтвердить
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </aside>
  );
}
