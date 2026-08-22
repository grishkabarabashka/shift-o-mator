/**
 * Generate / Auto-populate — заполнение периода одним прогоном (Docs/06).
 *
 * Результат — превью, а не мгновенная правка: планировщик видит, сколько
 * поставлено и что осталось дырой с причиной, и явно принимает или
 * отбрасывает. Принятие ставит изменения в черновик тем же путём, что и
 * обычная правка ячейки, — публикация и review ничего не знают про их
 * происхождение.
 *
 * Одна единица планирования и не больше 92 дней — то же ограничение, что и на бэкенд-
 * эндпоинте (`Docs/12-architecture.md`); здесь оно проверяется на клиенте до
 * прогона, а не после.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useState } from 'react';
import { AUTO_POPULATE_MAX_DAYS, runAutoPopulate, type AutoPopulateResult } from '../../api/planning.ts';
import type { UnitId } from '../../domain/types.ts';
import { rangeLength } from '../../engine/period.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import { useUi } from '../../store/useUi.ts';
import { Select } from '../../ui/primitives.tsx';
import type { PlanningView } from './usePlanningView.ts';

interface Props {
  readonly view: PlanningView;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function AutoPopulateDialog({ view, open, onClose }: Props) {
  const range = useUi((s) => s.range);
  const lockedAssignmentIds = useUi((s) => s.lockedAssignmentIds);
  const plan = useSchedule((s) => s.plan);
  const currentUserId = useSchedule((s) => s.currentUserId);
  const commitAutoPopulate = useSchedule((s) => s.commitAutoPopulate);

  const [unitId, setUnitId] = useState<UnitId | undefined>(view.unitIds[0]);
  const [preview, setPreview] = useState<AutoPopulateResult>();
  const [running, setRunning] = useState(false);
  const [accepting, setAccepting] = useState(false);

  const days = rangeLength(range);
  const tooLong = days > AUTO_POPULATE_MAX_DAYS;

  const lockedInUnit = useMemo(() => {
    if (!plan || !unitId) return 0;
    return plan.assignments.filter(
      (a) => a.unitId === unitId && lockedAssignmentIds.has(a.id),
    ).length;
  }, [plan, unitId, lockedAssignmentIds]);

  const reset = () => {
    setPreview(undefined);
    setRunning(false);
    setAccepting(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const run = async () => {
    if (!plan || !unitId || tooLong) return;
    setRunning(true);
    try {
      const result = await runAutoPopulate({
        unitId,
        range,
        lockedAssignmentIds,
        actorId: currentUserId ?? 'unknown',
      });
      setPreview(result);
    } finally {
      setRunning(false);
    }
  };

  const accept = async () => {
    if (!preview) return;
    setAccepting(true);
    try {
      await commitAutoPopulate(preview);
      close();
    } finally {
      setAccepting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog max-h-[80vh] overflow-y-auto">
          <Dialog.Title className="dialog__title">Generate / Auto-populate</Dialog.Title>
          <Dialog.Description className="mb-3 text-[13px] text-muted">
            Fills defaults, then ranks candidates for what is left. Stages a preview — nothing
            is written until you accept it.
          </Dialog.Description>

          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-semibold text-muted">Unit</span>
              <Select
                ariaLabel="Unit"
                value={unitId ?? ''}
                onChange={(value) => {
                  setUnitId(value);
                  reset();
                }}
                options={view.unitIds.map((id) => ({ value: id, label: id }))}
              />
            </label>

            <div className="rounded-lg border border-line bg-sunken px-3 py-2 text-[12.5px]">
              <div className="flex justify-between">
                <span className="text-muted">Period</span>
                <span className={tooLong ? 'font-semibold text-bad' : ''}>
                  {days} day{days === 1 ? '' : 's'}
                </span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-muted">Locked cells skipped</span>
                <span>{lockedInUnit}</span>
              </div>
            </div>

            {tooLong ? (
              <p className="rounded-lg bg-bad-soft px-3 py-2 text-[12px] text-bad">
                {days} days exceeds the {AUTO_POPULATE_MAX_DAYS}-day limit. Narrow the visible
                period first.
              </p>
            ) : null}

            {!preview ? (
              <button
                type="button"
                className="btn btn--primary w-full justify-center"
                disabled={!unitId || tooLong || running}
                onClick={() => void run()}
              >
                {running ? 'Generating…' : 'Generate'}
              </button>
            ) : (
              <PreviewSummary result={preview} />
            )}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn" onClick={close}>
              {preview ? 'Discard' : 'Cancel'}
            </button>
            {preview ? (
              <>
                <button type="button" className="btn" onClick={reset}>
                  Run again
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={accepting || preview.assignedCount === 0}
                  onClick={() => void accept()}
                >
                  {accepting ? 'Adding to draft…' : `Accept (${preview.assignedCount})`}
                </button>
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PreviewSummary({ result }: { readonly result: AutoPopulateResult }) {
  const compDays = result.changes.filter((c) => c.targetType === 'COMP_DAY').length;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Assigned" value={result.assignedCount} tone="ok" />
        <Stat label="Comp days" value={compDays} />
        {result.gaps.length > 0 ? (
          <Stat label="Gaps left" value={result.gaps.length} tone="bad" />
        ) : (
          <Stat label="Gaps left" value={result.gaps.length} />
        )}
      </div>

      {result.gaps.length > 0 ? (
        <div className="max-h-[200px] overflow-y-auto rounded-lg border border-line">
          {result.gaps.map((gap) => (
            <div
              key={`${gap.date}-${gap.shiftId}`}
              className="border-b border-line px-3 py-1.5 text-[12px] last:border-0"
            >
              <span className="font-mono font-semibold">{gap.code}</span>
              <span className="ml-1.5 text-faint">{gap.date}</span>
              <p className="text-[11.5px] text-muted">{gap.reason}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[12.5px] text-ok">Every requirement in this period is filled.</p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: 'ok' | 'bad';
}) {
  const color = tone === 'bad' && value > 0 ? 'text-bad' : tone === 'ok' ? 'text-ok' : '';
  return (
    <div className="rounded-lg border border-line px-2 py-1.5 text-center">
      <div className={`text-[18px] leading-none font-semibold ${color}`}>{value}</div>
      <div className="mt-0.5 text-[10px] text-faint uppercase">{label}</div>
    </div>
  );
}
