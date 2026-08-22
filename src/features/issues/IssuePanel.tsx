/**
 * Панель нарушений.
 *
 * Клик по строке ведёт в соответствующую ячейку сетки — без этого список
 * нарушений превращается в декорацию.
 *
 * Дыры и конфликты разведены по разным спискам намеренно (ADR-0009): дыра
 * чинится назначением кого-то, конфликт — снятием или исправлением назначения.
 * Это разные действия, и сваливать их в один поток «ошибок» значит заставлять
 * планировщика каждый раз читать текст, чтобы понять, что вообще делать.
 *
 * Предупреждение снимается только осознанно: с комментарием, который остаётся
 * в плане. Через полгода видно, сколько раз и почему приходилось выходить за
 * рамки.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useState } from 'react';
import type { Issue } from '../../domain/types.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import { useUi } from '../../store/useUi.ts';
import type { PlanningView } from '../planning/usePlanningView.ts';

interface Props {
  readonly view: PlanningView;
}

type Bucket = 'GAP' | 'CONFLICT' | 'WARNING' | 'INFO';

const BUCKETS: ReadonlyArray<{ id: Bucket; label: string; hint: string }> = [
  { id: 'GAP', label: 'Gaps', hint: 'Work nobody is doing. Blocks publication.' },
  {
    id: 'CONFLICT',
    label: 'Conflicts',
    hint: 'An assignment contradicts another record. Allowed with a comment.',
  },
  { id: 'WARNING', label: 'Warnings', hint: 'Needs an acknowledgement with a comment.' },
  { id: 'INFO', label: 'Info', hint: 'Signals only. Never blocks.' },
];

/**
 * Категория решает раньше уровня.
 *
 * Конфликт перестал быть блокирующим (ADR-0024), но он по-прежнему чинится
 * иначе, чем дыра: снять назначение, а не найти человека. Если раскладывать по
 * уровню, конфликты растворятся среди прочих предупреждений, и разделение,
 * ради которого ADR-0009 их развёл, пропадёт.
 */
function bucketOf(issue: Issue): Bucket {
  if (issue.category === 'CONFLICT') return 'CONFLICT';
  if (issue.level === 'BLOCKING') return 'GAP';
  return issue.level === 'WARNING' ? 'WARNING' : 'INFO';
}

export function IssuePanel({ view }: Props) {
  const select = useUi((s) => s.select);
  const focusDate = useUi((s) => s.focusDate);
  const acknowledge = useSchedule((s) => s.acknowledge);

  const [open, setOpen] = useState<Bucket>('GAP');
  const [pendingAck, setPendingAck] = useState<Issue>();
  const [comment, setComment] = useState('');

  const byBucket = useMemo(() => {
    const map = new Map<Bucket, Issue[]>(BUCKETS.map((bucket) => [bucket.id, []]));
    for (const issue of view.issues) map.get(bucketOf(issue))?.push(issue);
    return map;
  }, [view.issues]);

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
    <aside className="card flex w-[290px] shrink-0 flex-col overflow-hidden" aria-label="Issues">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <h2 className="text-[13px] font-semibold">Attention</h2>
        <span className="text-[11.5px] text-faint">{view.issues.length} total</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {BUCKETS.map((bucket) => {
          const issues = byBucket.get(bucket.id) ?? [];
          const expanded = open === bucket.id;
          return (
            <section key={bucket.id} className="border-b border-line last:border-0">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover"
                onClick={() => setOpen(expanded ? ('' as Bucket) : bucket.id)}
                title={bucket.hint}
                aria-expanded={expanded}
              >
                <span
                  aria-hidden
                  className="text-[9px] text-faint transition-transform"
                  style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
                >
                  ▶
                </span>
                <span className="text-[12.5px] font-semibold">{bucket.label}</span>
                <span className={`pill ml-auto ${pillOf(bucket.id, issues.length)}`}>
                  {issues.length}
                </span>
              </button>

              {expanded ? (
                issues.length === 0 ? (
                  <p className="px-3 pb-3 text-[11.5px] text-faint">
                    {bucket.id === 'GAP'
                      ? 'Every requirement is met for this period.'
                      : 'Nothing here.'}
                  </p>
                ) : (
                  <ul className="pb-1.5">
                    {issues.map((issue) => {
                      const ack = view.acknowledged.has(issue.key);
                      return (
                        <li key={issue.key}>
                          <button
                            type="button"
                            className="block w-full px-3 py-1.5 text-left hover:bg-hover"
                            onClick={() => goTo(issue)}
                          >
                            <span className="flex items-baseline gap-2">
                              {issue.date ? (
                                <span className="shrink-0 font-mono text-[10.5px] text-faint">
                                  {issue.date.slice(5)}
                                </span>
                              ) : null}
                              <span className="text-[12px] leading-snug">{issue.message}</span>
                            </span>
                            {/* По уровню, а не по корзине: конфликт лежит в
                                своей корзине, но подтверждается так же. */}
                            {issue.level === 'WARNING' ? (
                              <span
                                className="mt-0.5 block text-[10.5px]"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (!ack) setPendingAck(issue);
                                }}
                              >
                                {ack ? (
                                  <span className="text-ok">✓ acknowledged</span>
                                ) : (
                                  <span className="text-accent underline">
                                    acknowledge with a comment
                                  </span>
                                )}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : null}
            </section>
          );
        })}
      </div>

      <Dialog.Root
        open={pendingAck !== undefined}
        onOpenChange={(next) => {
          if (!next) {
            setPendingAck(undefined);
            setComment('');
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="dialog">
            <Dialog.Title className="dialog__title">Acknowledge warning</Dialog.Title>
            <Dialog.Description className="mb-3 text-[13px] text-muted">
              {pendingAck?.message}
            </Dialog.Description>
            <textarea
              className="field h-20 w-full resize-none py-2 leading-snug"
              value={comment}
              placeholder="Why are we stepping outside the rule?"
              onChange={(event) => setComment(event.target.value)}
              autoFocus
            />
            <p className="mt-1.5 text-[11.5px] text-faint">
              Kept with the plan and visible in history — this is the record that answers
              &ldquo;how often did we have to break the rule, and why&rdquo;.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button type="button" className="btn">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                className="btn btn--primary"
                disabled={comment.trim().length === 0}
                onClick={confirm}
              >
                Acknowledge
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </aside>
  );
}

function pillOf(bucket: Bucket, count: number): string {
  if (count === 0) return '';
  if (bucket === 'GAP' || bucket === 'CONFLICT') return 'pill--bad';
  if (bucket === 'WARNING') return 'pill--warn';
  return 'pill--accent';
}
