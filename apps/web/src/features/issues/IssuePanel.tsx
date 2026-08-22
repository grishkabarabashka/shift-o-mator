/**
 * NOTE: Issues panel. Clicking a row jumps to the corresponding grid cell —
 * without that, the issue list is just decoration.
 * NOTE: Gaps and conflicts are kept in separate lists deliberately (ADR-0009):
 * a gap is fixed by assigning someone, a conflict by removing or correcting an
 * assignment. These are different actions, and lumping them into one "errors"
 * stream would force the planner to read the text every time just to know what
 * to do.
 * NOTE: A warning is only cleared deliberately, with a comment that stays in
 * the plan. Six months later it shows how often and why the rule had to be
 * broken.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useState } from 'react';
import type { Issue } from '../../domain/types.ts';
import { isCoverageGap } from '../../engine/issues.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import { useUi } from '../../store/useUi.ts';
import type { PlanningView } from '../planning/usePlanningView.ts';
import { GapSummaryCard } from './GapSummaryCard.tsx';
import { dateSpanLabel, groupIssues, type IssueGroup } from './grouping.ts';

interface Props {
  readonly view: PlanningView;
}

type Bucket = 'GAP' | 'CONFLICT' | 'WARNING' | 'INFO';

const BUCKETS: ReadonlyArray<{ id: Bucket; label: string; hint: string }> = [
  { id: 'GAP', label: 'Gaps', hint: 'Work nobody is doing. Shown and highlighted, never blocks.' },
  {
    id: 'CONFLICT',
    label: 'Conflicts',
    hint: 'An assignment contradicts another record. Allowed with a comment.',
  },
  { id: 'WARNING', label: 'Warnings', hint: 'Worth a comment if you’re acknowledging it, but never blocks.' },
  { id: 'INFO', label: 'Info', hint: 'Signals only. Never blocks.' },
];

/**
 * NOTE: Category decides before level. A conflict stopped being blocking
 * (ADR-0024), and so did a gap (ADR-0035), but both are still fixed
 * differently from other warnings: a gap by assigning someone, a conflict by
 * removing or correcting an assignment. Sorting by level alone would dissolve
 * both into the general signal stream, erasing the separation ADR-0009
 * introduced them for. `isCoverageGap` checks by code, not level, so it
 * doesn't depend on CoverageGap now being INFO.
 */
function bucketOf(issue: Issue): Bucket {
  if (issue.category === 'CONFLICT') return 'CONFLICT';
  if (isCoverageGap(issue)) return 'GAP';
  return issue.level === 'WARNING' ? 'WARNING' : 'INFO';
}

export function IssuePanel({ view }: Props) {
  const select = useUi((s) => s.select);
  const focusDate = useUi((s) => s.focusDate);
  const acknowledge = useSchedule((s) => s.acknowledge);
  const unitId = useSchedule((s) => s.unitId);
  const range = useSchedule((s) => s.range);
  const index = useSchedule((s) => s.index);

  const [open, setOpen] = useState<Bucket>('GAP');
  const [pendingAck, setPendingAck] = useState<Issue>();
  const [comment, setComment] = useState('');

  const byBucket = useMemo(() => {
    const map = new Map<Bucket, Issue[]>(BUCKETS.map((bucket) => [bucket.id, []]));
    for (const issue of view.issues) map.get(bucketOf(issue))?.push(issue);
    return map;
  }, [view.issues]);

  // NOTE: The collapsed view is computed once per list change, not on every
  // bucket expand: a month for one unit brings a couple hundred issues here.
  const groups = useMemo(() => {
    const map = new Map<Bucket, IssueGroup[]>();
    for (const bucket of BUCKETS) {
      map.set(bucket.id, groupIssues(byBucket.get(bucket.id) ?? [], index, view.acknowledged));
    }
    return map;
  }, [byBucket, index, view.acknowledged]);

  const goTo = (issue: Issue) => {
    if (issue.personId && issue.date) select({ personId: issue.personId, date: issue.date });
    else if (issue.date) focusDate(issue.date);
  };

  const confirm = () => {
    if (!pendingAck || comment.trim().length === 0) return;
    void acknowledge(pendingAck.key, comment.trim());
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
        <GapSummaryCard unitId={unitId} range={range} issueCount={view.issues.length} />

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
                    {(groups.get(bucket.id) ?? []).map((group) => (
                      <IssueGroupRow
                        key={group.key}
                        group={group}
                        acknowledged={view.acknowledged}
                        onGoTo={goTo}
                        onAcknowledge={setPendingAck}
                      />
                    ))}
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
              title="Kept with the plan and visible in history — the record of how often and why."
              onChange={(event) => setComment(event.target.value)}
              autoFocus
            />
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

/**
 * NOTE: One finding: "Cover — uncovered · 12 days", expands into dates.
 * NOTE: A group of a single issue is shown directly as a row, no disclosure
 * triangle: clicking a triangle to reveal one row underneath is work the
 * interface invented for itself.
 */
function IssueGroupRow({
  group,
  acknowledged,
  onGoTo,
  onAcknowledge,
}: {
  readonly group: IssueGroup;
  readonly acknowledged: ReadonlySet<string>;
  readonly onGoTo: (issue: Issue) => void;
  readonly onAcknowledge: (issue: Issue) => void;
}) {
  const [open, setOpen] = useState(false);
  const single = group.issues.length === 1;

  if (single) {
    const issue = group.issues[0] as Issue;
    return (
      <li>
        <IssueRow
          issue={issue}
          acknowledged={acknowledged}
          onGoTo={onGoTo}
          onAcknowledge={onAcknowledge}
        />
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-hover"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span
          aria-hidden
          className="shrink-0 text-[8px] text-faint transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : undefined }}
        >
          ▶
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] leading-snug">
            <span className="font-medium">{group.subject}</span> — {group.what}
          </span>
          <span className="block font-mono text-[10.5px] text-faint">
            {group.issues.length} days · {dateSpanLabel(group.dates)}
          </span>
        </span>
        {group.unacknowledged > 0 ? (
          <span className="shrink-0 text-[10.5px] text-accent">{group.unacknowledged}</span>
        ) : null}
      </button>

      {open ? (
        <ul className="border-l border-line pl-2 ml-4">
          {group.issues.map((issue) => (
            <li key={issue.key}>
              <IssueRow
                issue={issue}
                acknowledged={acknowledged}
                onGoTo={onGoTo}
                onAcknowledge={onAcknowledge}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** NOTE: A single issue — exactly what the list row was before grouping. */
function IssueRow({
  issue,
  acknowledged,
  onGoTo,
  onAcknowledge,
}: {
  readonly issue: Issue;
  readonly acknowledged: ReadonlySet<string>;
  readonly onGoTo: (issue: Issue) => void;
  readonly onAcknowledge: (issue: Issue) => void;
}) {
  const ack = acknowledged.has(issue.key);
  return (
    <button
      type="button"
      className="block w-full px-3 py-1.5 text-left hover:bg-hover"
      onClick={() => onGoTo(issue)}
    >
      <span className="flex items-baseline gap-2">
        {issue.date ? (
          <span className="shrink-0 font-mono text-[10.5px] text-faint">{issue.date.slice(5)}</span>
        ) : null}
        <span className="text-[12px] leading-snug">{issue.message}</span>
      </span>
      {/* NOTE: By level, not by bucket: a conflict sits in its own bucket but
          is acknowledged the same way. */}
      {issue.level === 'WARNING' ? (
        <span
          className="mt-0.5 block text-[10.5px]"
          onClick={(event) => {
            event.stopPropagation();
            if (!ack) onAcknowledge(issue);
          }}
        >
          {ack ? (
            <span className="text-ok">✓ acknowledged</span>
          ) : (
            <span className="text-accent underline">acknowledge with a comment</span>
          )}
        </span>
      ) : null}
    </button>
  );
}

function pillOf(bucket: Bucket, count: number): string {
  if (count === 0) return '';
  if (bucket === 'GAP' || bucket === 'CONFLICT') return 'pill--bad';
  if (bucket === 'WARNING') return 'pill--warn';
  return 'pill--accent';
}
