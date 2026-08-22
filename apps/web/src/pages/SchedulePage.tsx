/**
 * Экран планирования.
 *
 * Раскладка сверху вниз: выбор периода → действия над черновиком → палитра
 * смен → сетка с прилипшей полосой покрытия. Панель нарушений справа.
 *
 * Сетка и полоса покрытия живут в одном скролл-контейнере — иначе при
 * горизонтальной прокрутке колонки покрытия разъезжаются с колонками дней, и
 * «2/3» оказывается под чужой датой.
 *
 * Палитра смен дублирует пикер по правому клику и на узких экранах отъедала
 * заметную полосу по высоте (CLAUDE.md) — она сворачиваема, свёрнутое
 * состояние держится в этом компоненте, не в глобальном сторе: это чисто
 * видовая настройка экрана, не часть черновика или UI-состояния, которое
 * стоило бы делить с другими экранами.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { zoomSpec } from '../engine/period.ts';
import { hasDraftChanges, useSchedule } from '../store/useSchedule.ts';
import { useUi } from '../store/useUi.ts';
import { useElementWidth } from '../ui/useElementWidth.ts';
import { AbsenceDialog } from '../features/absences/AbsenceDialog.tsx';
import { AbsenceImportDialog } from '../features/absences/AbsenceImportDialog.tsx';
import { CompDayDialog } from '../features/compdays/CompDayDialog.tsx';
import { CoverageStrip } from '../features/coverage/CoverageStrip.tsx';
import { IssuePanel } from '../features/issues/IssuePanel.tsx';
import { AutoPopulateDialog } from '../features/planning/AutoPopulateDialog.tsx';
import { HeatmapGrid } from '../features/planning/HeatmapGrid.tsx';
import { PlanningGrid } from '../features/planning/PlanningGrid.tsx';
import { ReviewDialog } from '../features/planning/ReviewDialog.tsx';
import { ShiftPalette } from '../features/planning/ShiftPalette.tsx';
import { DateRangeControl } from '../features/shell/DateRangeControl.tsx';
import { resolveAbsenceTargets } from '../features/absences/selection.ts';
import type { PlanningView } from '../features/planning/usePlanningView.ts';

/** Из `--name-w`/`--cell-w` в theme.css — колонка имени и пол, ниже которого
 * ячейка становится нечитаемой. */
const NAME_W = 185;
const MIN_CELL_W = 40;

interface Props {
  readonly view: PlanningView;
  readonly asOf: string;
}

export function SchedulePage({ view, asOf }: Props) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [autoPopulateOpen, setAutoPopulateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const gridScroller = useRef<HTMLDivElement>(null);

  // useLayoutEffect, не useEffect: с обычным эффектом первый кадр рисуется ещё
  // овервьюшным периодом (ADR-0036 — у экранов свои периоды), и переход с
  // Overview моргал однодневным зумом, прежде чем встать на месяц. Layout-эффект
  // отрабатывает до отрисовки, так что промежуточного состояния не видно.
  const enterSchedule = useUi((s) => s.enterSchedule);
  useLayoutEffect(() => enterSchedule(), [enterSchedule]);

  // Зум задаёт масштаб, а не лимит показа: неделя должна растянуться на весь
  // экран, а не остаться полосой 62px-колонок в пустом пространстве. Ширина
  // ячейки — это то, что осталось после имени, поделенное на число колонок, с
  // полом в MIN_CELL_W. Меряется на общем предке сетки и полосы покрытия и
  // пишется одной CSS-переменной, чтобы обе не могли разъехаться.
  const [fillRef, fillWidth] = useElementWidth<HTMLElement>();
  const cellWidth =
    view.columns.length > 0
      ? Math.max(MIN_CELL_W, (fillWidth - NAME_W) / view.columns.length)
      : MIN_CELL_W;

  const zoom = useUi((s) => s.schedule.zoom);
  const range = useUi((s) => s.range);
  const selection = useUi((s) => s.selection);
  const openAbsenceCreate = useUi((s) => s.openAbsenceCreate);

  const editing = useSchedule((s) => s.session !== undefined);
  const dirty = useSchedule(hasDraftChanges);
  const changeCount = useSchedule((s) => s.changes.length);
  const publishing = useSchedule((s) => s.publishing);
  const pendingSync = useSchedule((s) => s.pendingSync);
  const syncError = useSchedule((s) => s.syncError);
  const overlapping = useSchedule((s) => s.overlappingDrafts);
  const undo = useSchedule((s) => s.undo);
  const redo = useSchedule((s) => s.redo);
  const undoDepth = useSchedule((s) => s.undoStack.length);
  const redoDepth = useSchedule((s) => s.redoStack.length);
  const discard = useSchedule((s) => s.discard);

  const detail = zoomSpec(zoom).detail;
  const absenceTargets = resolveAbsenceTargets(view, selection);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <DateRangeControl />

      {overlapping.length > 0 ? (
        <div
          className="rounded-lg border border-accent bg-accent-soft px-3 py-2 text-[12.5px] text-accent"
          title="Concurrent drafts are allowed; publication revalidates against the latest published state."
        >
          {overlapping.length === 1
            ? 'Another planner has an open draft for this period.'
            : `${overlapping.length} other planners have open drafts for this period.`}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3">
        <section
          ref={fillRef}
          className="card flex min-w-0 flex-1 flex-col overflow-hidden"
          style={{ '--cell-w': `${cellWidth}px` } as React.CSSProperties}
        >
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

            {detail && view.unitIds.length > 0 ? (
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
              title="Import absences — paste or upload leave-system data: map columns, review the diff, apply as one batch"
            >
              Import…
            </button>

            <div className="ml-auto flex items-center gap-2">
              {editing ? (
                <>
                  {/* Сбой синхронизации важнее индикатора «Saving…»: сетка
                      показывает правку, сервер о ней не знает, и публиковать
                      в этом состоянии нельзя. */}
                  {syncError ? (
                    <span
                      className="rounded border border-bad bg-bad-soft px-1.5 py-0.5 text-[11px] text-bad"
                      title={syncError}
                    >
                      Not saved — retrying
                    </span>
                  ) : pendingSync || view.coverageStale ? (
                    <span
                      className="text-[11px] text-faint"
                      title={
                        pendingSync
                          ? 'Edits are staged and will sync to the draft shortly'
                          : 'Coverage and issues are refreshing for the dates you just touched'
                      }
                    >
                      {pendingSync ? 'Saving…' : 'Updating coverage…'}
                    </span>
                  ) : null}
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
                    {publishing ? 'Publishing…' : `Publish (${changeCount})`}
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
              <button
                type="button"
                className="btn btn--sm mb-1.5"
                onClick={() => setPaletteOpen(!paletteOpen)}
                aria-expanded={paletteOpen}
                title={paletteOpen ? 'Hide the shift palette' : 'Show the shift palette'}
              >
                <span aria-hidden className="text-[8px]">
                  {paletteOpen ? '▼' : '▶'}
                </span>{' '}
                Shifts
              </button>
              {paletteOpen ? (
                <ShiftPalette shifts={view.coverageShifts} referenceDate={range.from} />
              ) : null}
            </div>
          ) : null}

          {detail ? (
            <>
              {/* key: смена набора единиц (в т.ч. со «всех» на одну) меняет, какие
                  строки-разделители городов есть в сетке. Реконсиляция по ключам
                  строк убирает лишние группы из DOM корректно (проверено тестами
                  в App.test.tsx), но в браузере на CSS Grid с sticky-заголовками
                  внутри изредка остаётся неперерисованный кусок картинки от
                  удалённой строки — известный класс багов перерисовки при
                  implicit grid + position: sticky. `key` заставляет React
                  пересобрать DOM сетки целиком при смене области вместо точечного
                  патча, тем самым гарантируя чистую перерисовку — то же самое,
                  что чинит переход на экран заново. */}
              <PlanningGrid
                key={view.unitIds.join(',')}
                view={view}
                scrollerRef={gridScroller}
              />
              <CoverageStrip view={view} syncWith={gridScroller} />
            </>
          ) : (
            <HeatmapGrid key={view.unitIds.join(',')} view={view} />
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
