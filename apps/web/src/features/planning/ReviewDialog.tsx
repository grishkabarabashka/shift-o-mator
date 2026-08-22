/**
 * Review & publish — ADR-0015.
 *
 * Ничего не становится публичным без этого экрана: счётчики, построчный diff
 * старое → новое, влияние на покрытие. Публикация атомарна; при расхождении
 * версий показывается сравнение, а черновик **сохраняется целиком**.
 *
 * Список изменений группируется по человеку — на черновике в полсотни правок
 * плоская лента спанов читалась как одна строка текста (owner review). Ни
 * `dialog--wide`, ни `review__*` классов в CSS не было — диалог рисовался
 * узким, без колонок и без прокрутки списка, выдавливая кнопки за край;
 * здесь только `.overlay`/`.dialog` и Tailwind, как в остальном приложении
 * (ADR-0022).
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
  const publishable = canPublish(view.issues);

  const groups = useMemo(() => groupByPerson(changes, view), [changes, view]);

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
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog w-[min(680px,calc(100vw-32px))]">
          <Dialog.Title className="dialog__title">Review changes</Dialog.Title>

          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
            <span>
              <strong className="font-semibold">{summary.created}</strong> created
            </span>
            <span>
              <strong className="font-semibold">{summary.updated}</strong> modified
            </span>
            <span>
              <strong className="font-semibold">{summary.deleted}</strong> removed
            </span>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {/* Дыры не блокируют публикацию (ADR-0035) — этот чип информационный,
                не предупреждение об отказе. */}
            <Pill tone={gaps > 0 ? 'warn' : 'ok'}>
              {gaps} coverage {gaps === 1 ? 'gap' : 'gaps'} will stay after publishing
            </Pill>
            <Pill tone={dataConflicts > 0 ? 'warn' : 'ok'}>
              {dataConflicts} {dataConflicts === 1 ? 'conflict' : 'conflicts'}
            </Pill>
            <Pill tone={unacknowledgedWarnings > 0 ? 'warn' : 'ok'}>
              {unacknowledgedWarnings} unacknowledged {unacknowledgedWarnings === 1 ? 'warning' : 'warnings'}
            </Pill>
          </div>

          {conflicts.length > 0 ? (
            <div className="mb-3 rounded-lg border border-bad bg-bad-soft px-3 py-2.5 text-[12.5px]">
              <strong className="block font-semibold text-bad">
                Publication was rejected — the schedule changed underneath you.
              </strong>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                {conflicts.map((conflict) => (
                  <li key={conflict.changeId}>{conflict.reason}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-faint">Your draft is intact. Reload the period and reapply.</p>
            </div>
          ) : null}

          <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-line">
            {groups.length === 0 ? (
              <p className="p-3 text-[12.5px] text-faint">No changes yet</p>
            ) : (
              groups.map((group) => <PersonGroup key={group.personId} group={group} />)
            )}
          </div>

          {!publishable ? (
            <p className="mt-3 text-[12.5px] text-bad">
              Publication is blocked by a double assignment or an unknown/ineligible shift.
            </p>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
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

function Pill({
  tone,
  children,
}: {
  readonly tone: 'ok' | 'warn' | 'bad';
  readonly children: React.ReactNode;
}) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Группировка по человеку
// ---------------------------------------------------------------------------

interface PersonGroup {
  readonly personId: string;
  readonly personName: string;
  readonly changes: readonly DraftChange[];
}

function personIdOf(change: DraftChange): string | undefined {
  return (change.after ?? change.before)?.personId;
}

function dateOf(change: DraftChange): string {
  if (change.targetType === 'ASSIGNMENT') return (change.after ?? change.before)?.date ?? '';
  if (change.targetType === 'ABSENCE') return (change.after ?? change.before)?.from ?? '';
  return (change.after ?? change.before)?.earnedForDate ?? '';
}

function groupByPerson(changes: readonly DraftChange[], view: PlanningView): PersonGroup[] {
  const nameOf = (personId: string | undefined): string => {
    if (!personId) return '—';
    const row = view.rows.find((r) => r.kind === 'person' && r.person.id === personId);
    return row?.kind === 'person' ? row.person.displayName : personId;
  };

  const byPerson = new Map<string, DraftChange[]>();
  for (const change of changes) {
    const personId = personIdOf(change) ?? '—';
    const bucket = byPerson.get(personId);
    if (bucket) bucket.push(change);
    else byPerson.set(personId, [change]);
  }

  return [...byPerson.entries()]
    .map(([personId, personChanges]) => ({
      personId,
      personName: nameOf(personId === '—' ? undefined : personId),
      changes: [...personChanges].sort((a, b) => dateOf(a).localeCompare(dateOf(b))),
    }))
    .sort((a, b) => a.personName.localeCompare(b.personName));
}

function PersonGroup({ group }: { readonly group: PersonGroup }) {
  return (
    <div className="border-b border-line last:border-0">
      <div className="sticky top-0 flex items-center gap-2 border-b border-line bg-sunken px-3 py-1.5">
        <span className="text-[12px] font-semibold">{group.personName}</span>
        <span className="text-[10.5px] text-faint">
          {group.changes.length} {group.changes.length === 1 ? 'change' : 'changes'}
        </span>
      </div>
      <div className="divide-y divide-line/60">
        {group.changes.map((change) => (
          <ChangeRow key={change.id} change={change} />
        ))}
      </div>
    </div>
  );
}

function describe(change: DraftChange, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (change.targetType === 'ASSIGNMENT') {
    const assignment = value as { content: { kind: string; shiftId?: string; marker?: string } };
    if (assignment.content.kind === 'SHIFT' && assignment.content.shiftId) {
      return assignment.content.shiftId;
    }
    return assignment.content.marker === 'OFF' ? 'Off' : '0';
  }
  if (change.targetType === 'ABSENCE') {
    const absence = value as { type: string; from: string; to: string };
    return `${absence.type} ${absence.from}–${absence.to}`;
  }
  const entry = value as { status: string };
  return entry.status;
}

function ChangeRow({ change }: { readonly change: DraftChange }) {
  return (
    <div className="grid grid-cols-[72px_1fr_auto_1fr] items-center gap-2 px-3 py-1.5 text-[12px]">
      <span className="font-mono text-[11px] text-faint">{dateOf(change).slice(5) || '—'}</span>
      <span className="truncate text-muted">{describe(change, change.before)}</span>
      <span aria-hidden className="text-faint">
        →
      </span>
      <span className="truncate font-medium">{describe(change, change.after)}</span>
    </div>
  );
}
