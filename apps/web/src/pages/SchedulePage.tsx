/**
 * NOTE: Planning screen.
 *
 * Top-to-bottom layout: period picker -> draft actions -> shift palette ->
 * grid with a stuck-to-it coverage strip. The issues panel sits on the right.
 *
 * The grid and coverage strip live in one scroll container — otherwise,
 * during horizontal scrolling, the coverage columns drift out of alignment
 * with the day columns, and "2/3" ends up under the wrong date.
 *
 * The shift palette duplicates the right-click picker, and on narrow screens
 * it ate a noticeable strip of vertical space (CLAUDE.md) — it is
 * collapsible, and the collapsed state lives in this component, not in the
 * global store: it is purely a view setting for this screen, not part of the
 * draft or UI state that would be worth sharing with other screens.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { rangeFor, zoomSpec } from '../engine/period.ts';
import { useRangeSettled } from '../features/shell/useRangeSettled.ts';
import { hasDraftChanges, useSchedule } from '../store/useSchedule.ts';
import { useUi } from '../store/useUi.ts';
import { useElementWidth } from '../ui/useElementWidth.ts';
import { AbsenceDialog } from '../features/absences/AbsenceDialog.tsx';
import { AbsenceImportDialog } from '../features/absences/AbsenceImportDialog.tsx';
import { CompDayDialog } from '../features/compdays/CompDayDialog.tsx';
import { CellHistoryPanel } from '../features/planning/CellHistoryPanel.tsx';
import { useCapabilities } from '../auth/useCapabilities.ts';
import { CoverageStrip } from '../features/coverage/CoverageStrip.tsx';
import { IssuePanel } from '../features/issues/IssuePanel.tsx';
import { AutoPopulateDialog } from '../features/planning/AutoPopulateDialog.tsx';
import { HeatmapGrid } from '../features/planning/HeatmapGrid.tsx';
import { PlanningGrid } from '../features/planning/PlanningGrid.tsx';
import { ReviewDialog } from '../features/planning/ReviewDialog.tsx';
import { ShiftPalette } from '../features/planning/ShiftPalette.tsx';
import { PageHeader } from '../ui/PageHeader.tsx';
import { DateRangeControl } from '../features/shell/DateRangeControl.tsx';
import type { PlanningView } from '../features/planning/usePlanningView.ts';

/** NOTE: From `--name-w`/`--cell-w` in theme.css — the name column and the
 * floor below which a cell becomes unreadable. */
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

  // WHY: useLayoutEffect, not useEffect — with a regular effect the first
  // frame still renders with Overview's period (ADR-0036 — each screen has
  // its own period), and coming from Overview flashed a one-day zoom before
  // settling on a month. A layout effect runs before paint, so the
  // intermediate state is never visible.
  const enterSchedule = useUi((s) => s.enterSchedule);
  useLayoutEffect(() => enterSchedule(), [enterSchedule]);

// NOTE: Zoom sets the scale, not a display limit — a week should stretch
  // to fill the whole screen, not sit as a strip of 62px columns in empty
  // space. Cell width is what's left after the name column, divided by the
  // number of columns, floored at MIN_CELL_W, written as a single CSS variable
  // on the common ancestor of the grid and the coverage strip so the two can
  // never drift apart.
  //
  // Measured on the **scroller**, not on the card around it: the card keeps its
  // full width while the scroller inside it loses a vertical scrollbar's worth,
  // and sizing from the card put the sheet about fifteen pixels wider than its
  // room — a permanent small horizontal scrollbar under a view that was meant to
  // fit exactly.
  const [fillRef, fillWidth] = useElementWidth<HTMLElement>();
  const cellWidth =
    view.columns.length > 0
      ? Math.max(MIN_CELL_W, (fillWidth - NAME_W) / view.columns.length)
      : MIN_CELL_W;

  const zoom = useUi((s) => s.schedule.zoom);
  const scheduleAnchor = useUi((s) => s.schedule.anchor);
  const range = useUi((s) => s.range);

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
  const caps = useCapabilities();
  const actionError = useSchedule((s) => s.actionError);
  const dismissActionError = useSchedule((s) => s.dismissActionError);

  const detail = zoomSpec(zoom).detail;
  // Computed from this screen's own zoom/anchor rather than read off `useUi.range`: that
  // one is written by a layout effect after the first render, so on that first render it
  // still names whichever screen you came from. Deriving it locally is what makes the
  // very first render already know the *true* target instead of a stale one that
  // coincidentally matched `useSchedule.range` and let a wrong frame through.
  const settled = useRangeSettled(rangeFor(zoom, scheduleAnchor));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <PageHeader
        title="Schedule"
        context={
          editing
            ? 'Your draft is open — nothing here is published until you publish it'
            : 'The published rota. Right-click to start editing.'
        }
      />

      <DateRangeControl />

      {/* WHY a banner and not the full-screen error state: a failed publish leaves the
          draft intact, so blanking the grid would hide exactly what the planner needs
          to look at. Previously this was written to `error` and rendered nowhere. */}
      {actionError ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-bad bg-bad-soft px-3 py-2 text-[12.5px] text-bad"
        >
          <span className="min-w-0 flex-1">{actionError}</span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={dismissActionError}
            aria-label="Dismiss this message"
          >
            Dismiss
          </button>
        </div>
      ) : null}

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
          className="card flex min-w-0 flex-1 flex-col overflow-hidden shadow-elev-2"
          style={{ '--cell-w': `${cellWidth}px` } as React.CSSProperties}
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            {/* Absence and presence used to have toolbar buttons here. Right-click does
                both in one click each, on the cells you already selected — a second
                route that needed the same selection was only ever more to look at. */}
            {detail ? <LayerToggles /> : null}

            {detail && caps.plansSomewhere && view.unitIds.length > 0 ? (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setAutoPopulateOpen(true)}
                title="Fill defaults and rank candidates for what's left, as a preview"
              >
                Generate…
              </button>
            ) : null}

            {caps.plansSomewhere ? (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setImportOpen(true)}
                title="Import absences — paste or upload leave-system data: map columns, review the diff, apply as one batch"
              >
                Import…
              </button>
            ) : null}

            <div className="ml-auto flex items-center gap-2">
              {editing ? (
                <>
                  {/* NOTE: A sync failure outranks the "Saving..." indicator —
                      the grid shows the edit, the server doesn't know about it
                      yet, and publishing in this state is not allowed. */}
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
                  {caps.plansSomewhere
                    ? 'Right-click a cell to start editing — a draft opens automatically'
                    : 'Right-click your own row to ask for leave or to record where you are working'}
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

          {!settled ? (
            <div className="flex flex-1 items-center justify-center p-8 text-[13px] text-muted">
              Reading the published plan…
            </div>
          ) : detail ? (
            <>
              {/* WHY: key — changing the set of units (including "all" to one)
                  changes which city-divider rows exist in the grid. Row-key
                  reconciliation correctly removes the stray groups from the DOM
                  (verified by tests in App.test.tsx), but in the browser, on a
                  CSS Grid with sticky headers inside it, an unrepainted scrap of
                  a removed row occasionally remains — a known class of repaint
                  bugs with implicit grid + position: sticky. `key` forces React
                  to rebuild the grid's DOM wholesale on scope change instead of
                  patching it in place, which guarantees a clean repaint — the
                  same thing that leaving and re-entering the screen fixes. */}
              <PlanningGrid
                key={view.unitIds.join(',')}
                view={view}
                scrollerRef={gridScroller}
                measureRef={fillRef}
              />
              <CoverageStrip view={view} syncWith={gridScroller} />
            </>
          ) : (
            <HeatmapGrid key={view.unitIds.join(',')} view={view} />
          )}
        </section>

        <IssuePanel view={view} />
      </div>

      <CellHistoryPanel />
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

/**
 * What the grid draws.
 *
 * A cell can carry a shift, an absence, where the person is and something they have asked
 * for. All four at once is a lot in 62×32 pixels, and which of them matters depends on
 * why you opened the screen — so they are layers you switch off rather than a compromise
 * nobody chose.
 */
function LayerToggles() {
  const layers = useUi((s) => s.layers);
  const toggleLayer = useUi((s) => s.toggleLayer);

  const items: readonly { key: keyof typeof layers; label: string }[] = [
    { key: 'shifts', label: 'Shifts' },
    { key: 'timeOff', label: 'Time off' },
    { key: 'presence', label: 'Presence' },
    { key: 'requests', label: 'Requests' },
  ];

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Layers">
      <span className="text-[11px] text-faint">Show</span>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className="btn btn--sm"
          data-active={layers[item.key] || undefined}
          aria-pressed={layers[item.key]}
          // The visible text is short enough to fit four of these; the accessible name
          // has to stay distinct from the shift palette's own "Shifts" button.
          aria-label={`Show ${item.label.toLowerCase()}`}
          onClick={() => toggleLayer(item.key)}
          title={`Show or hide ${item.label.toLowerCase()} in the grid`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
