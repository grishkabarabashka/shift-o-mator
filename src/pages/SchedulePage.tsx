/**
 * Экран планирования.
 *
 * Раскладка сверху вниз: выбор периода → действия над черновиком → палитра
 * ролей → сетка с прилипшей полосой покрытия. Панель нарушений справа.
 *
 * Сетка и полоса покрытия живут в одном скролл-контейнере — иначе при
 * горизонтальной прокрутке колонки покрытия разъезжаются с колонками дней, и
 * «2/3» оказывается под чужой датой.
 */

import { useRef, useState } from 'react';
import { zoomSpec } from '../engine/period.ts';
import { hasDraftChanges, useSchedule } from '../store/useSchedule.ts';
import { useUi } from '../store/useUi.ts';
import { AbsenceDialog } from '../features/absences/AbsenceDialog.tsx';
import { AbsenceImportDialog } from '../features/absences/AbsenceImportDialog.tsx';
import { CompDayDialog } from '../features/compdays/CompDayDialog.tsx';
import { CoverageStrip } from '../features/coverage/CoverageStrip.tsx';
import { IssuePanel } from '../features/issues/IssuePanel.tsx';
import { AutoPopulateDialog } from '../features/planning/AutoPopulateDialog.tsx';
import { HeatmapGrid } from '../features/planning/HeatmapGrid.tsx';
import { PlanningGrid } from '../features/planning/PlanningGrid.tsx';
import { ReviewDialog } from '../features/planning/ReviewDialog.tsx';
import { RolePalette } from '../features/planning/RolePalette.tsx';
import { DateRangeControl } from '../features/shell/DateRangeControl.tsx';
import { resolveAbsenceTargets } from '../features/absences/selection.ts';
import type { PlanningView } from '../features/planning/usePlanningView.ts';

interface Props {
  readonly view: PlanningView;
  readonly asOf: string;
}

export function SchedulePage({ view, asOf }: Props) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [autoPopulateOpen, setAutoPopulateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const gridScroller = useRef<HTMLDivElement>(null);

  const zoom = useUi((s) => s.zoom);
  const custom = useUi((s) => s.custom);
  const range = useUi((s) => s.range);
  const selection = useUi((s) => s.selection);
  const openAbsenceCreate = useUi((s) => s.openAbsenceCreate);

  const editing = useSchedule((s) => s.session !== undefined);
  const dirty = useSchedule(hasDraftChanges);
  const changeCount = useSchedule((s) => s.changes.length);
  const publishing = useSchedule((s) => s.publishing);
  const overlapping = useSchedule((s) => s.overlappingDrafts);
  const undo = useSchedule((s) => s.undo);
  const redo = useSchedule((s) => s.redo);
  const undoDepth = useSchedule((s) => s.undoStack.length);
  const redoDepth = useSchedule((s) => s.redoStack.length);
  const discard = useSchedule((s) => s.discard);

  // Ручной диапазон всегда редактируем: его длину выбрал сам планировщик.
  const detail = custom || zoomSpec(zoom).detail;
  const absenceTargets = resolveAbsenceTargets(view, selection);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <DateRangeControl />

      {overlapping.length > 0 ? (
        <div className="rounded-lg border border-accent bg-accent-soft px-3 py-2 text-[12.5px] text-accent">
          {overlapping.length === 1
            ? 'Another planner has an open draft for this period. Concurrent drafts are allowed; publication revalidates against the latest published state.'
            : `${overlapping.length} other planners have open drafts for this period.`}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3">
        <section className="card flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            {detail ? (
              <button
                type="button"
                className="btn btn--sm"
                disabled={absenceTargets.length === 0}
                onClick={() => openAbsenceCreate(absenceTargets)}
                title="Record leave or sickness across the selected cells"
              >
                + Absence{absenceTargets.length > 1 ? ` (${absenceTargets.length})` : ''}
              </button>
            ) : null}

            {detail && view.regionIds.length > 0 ? (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setAutoPopulateOpen(true)}
                title="Fill defaults and rank candidates for what's left, as a preview"
              >
                Generate…
              </button>
            ) : null}

            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setImportOpen(true)}
              title="Paste or upload leave-system data: map columns, review the diff, apply as one batch"
            >
              Import absences…
            </button>

            <div className="ml-auto flex items-center gap-2">
              {editing ? (
                <>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={undo}
                      disabled={undoDepth === 0}
                      title="Undo (Ctrl+Z)"
                    >
                      ↶ Undo{undoDepth > 0 ? ` ${undoDepth}` : ''}
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={redo}
                      disabled={redoDepth === 0}
                      title="Redo (Ctrl+Y)"
                    >
                      ↷ Redo
                    </button>
                  </div>
                  <button type="button" className="btn btn--sm" onClick={() => void discard()}>
                    Discard draft
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--primary"
                    onClick={() => setReviewOpen(true)}
                    disabled={!dirty || publishing}
                  >
                    {publishing ? 'Publishing…' : `Review & publish (${changeCount})`}
                  </button>
                </>
              ) : (
                <span className="text-[11.5px] text-faint">
                  Right-click a cell to start editing — a draft opens automatically
                </span>
              )}
            </div>
          </div>

          {detail ? (
            <div className="border-b border-line px-3 py-2">
              <RolePalette roles={view.coverageRoles} referenceDate={range.from} />
            </div>
          ) : null}

          {detail ? (
            <>
              <PlanningGrid view={view} scrollerRef={gridScroller} />
              <CoverageStrip view={view} syncWith={gridScroller} />
            </>
          ) : (
            <HeatmapGrid view={view} />
          )}
        </section>

        <IssuePanel view={view} />
      </div>

      <AbsenceDialog />
      <AbsenceImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <CompDayDialog asOf={asOf} />
      <ReviewDialog view={view} open={reviewOpen} onClose={() => setReviewOpen(false)} />
      <AutoPopulateDialog
        view={view}
        open={autoPopulateOpen}
        onClose={() => setAutoPopulateOpen(false)}
      />
    </div>
  );
}
