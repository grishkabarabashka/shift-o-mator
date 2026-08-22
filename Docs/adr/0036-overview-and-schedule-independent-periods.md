# ADR-0036. Overview and Schedule hold independent periods

**Status:** accepted

## Context

Through Phase 8, `useUi` held one period — `{ zoom, anchor, range, custom }` — shared
by `DateRangeControl`, rendered identically on Overview and Schedule. Seven zoom
levels (Day, 2 Days, Week, 2 Weeks, Month, 3 Months, 6 Months) covered both screens.

Owner review surfaced that this single control served neither screen well:

- **Overview** answers "who is on shift now and in the next few days, and is
  anything uncovered". A week or a month of horizontal scroll is not the shape of
  that question; the owner wanted the visible window to always be a fixed number of
  days on screen (1, 3, or 7), centered on "now" when the screen opens, with
  further days reached by a continuous horizontal scroll rather than by re-zooming.
- **Schedule** plans a roster. A day or week is too short to be a useful planning
  unit — a shift pattern, a comp-day window, and a fairness check all reason in
  months — and Schedule's own zoom needed exactly three settings: Month, 3 Months,
  6 Months (the last two already read-only heatmaps, ADR from Phase 8's grid
  redesign).

No zoom level satisfies both: Overview never needs "6 months" and Schedule never
needs "1 day". Forcing one shared `range` meant every zoom change on either screen
silently changed what the other screen would show when the planner switched back.

## Decision

**`useUi` holds two remembered period slices, `overview` and `schedule`, plus one
active `range` that mirrors whichever screen is mounted:**

```ts
overview: { anchor: IsoDate; span: 1 | 3 | 7 }
schedule: { anchor: IsoDate; zoom: 'month' | 'quarter' | 'half-year' }
range: DateRange   // written by enterOverview() / enterSchedule() on mount
```

`OverviewPage` calls `enterOverview()` and `SchedulePage` calls `enterSchedule()` in
a mount effect; each recomputes `range` from its own remembered slice. Every other
consumer of period state — `App.tsx`'s data-loading effect, `usePlanningView`,
coverage, the grid — keeps reading `range` exactly as before; only the two owning
screens know they have their own memory.

`engine/period.ts` splits the same way: `ZoomId` narrows to `ScheduleZoom = 'month'
| 'quarter' | 'half-year'` (`rangeFor`/`stepAnchor` drop their day/week branches),
and a new `overviewRange(anchor, span)` returns a window `3 × span` days wide — the
visible `span` days plus `span` days of context on each side, so scrolling one
screen-width in either direction never needs a refetch mid-drag. `stepOverviewAnchor`
steps by exactly `span`, matching the existing "step equals the visible period"
rule `stepAnchor` already followed for Schedule.

**Arbitrary custom ranges are gone.** The day-strip drag-select and the scrubber's
resize handles existed to build a `DateRange` no zoom button could produce; once
Schedule's shortest zoom is a month and Overview's zoom is a fixed 1/3/7-day window,
there is no gap for a manual range to fill. `DateRangeControl`'s day-strip and
scrubber now only *jump* the anchor (click a day → `setScheduleAnchor(date)`, drag
the scrubber → same), never construct a bespoke `{from, to}`.

## Consequences

- Switching from Overview to Schedule (or back) now fires two `load()` calls in
  quick succession — the mounting screen's own period, immediately after the
  previous screen's. Nothing in `useSchedule.load` previously guarded against a
  slower-resolving stale request overwriting a faster-resolving current one; this
  ADR's own regression surfaced that gap. Fixed alongside this change: `load()`
  tags each call with a monotonic `loadSeq` and drops any response that isn't from
  the newest call by the time it resolves.
- `DayDrilldownPage` and `AbsenceImportDialog`'s "jump to this date" actions used to
  call `setZoom('day')` to land on an editable single-day grid; Schedule has no day
  zoom anymore, so they call `setScheduleAnchor(date)` instead, landing on the month
  containing that date.
- The day-strip's "click a date, click another to set the range" two-click flow and
  its context-day padding are gone with `custom`; the strip now shows exactly the
  active period's days and each click jumps straight there.
- `OverviewPeriodControl` is a new, separate component from `DateRangeControl` — the
  two screens' period pickers no longer share one component now that they don't
  share one state shape.

## Alternatives considered

- **One shared `range`, but let each screen clamp it to its own valid shape on
  mount.** Rejected: clamping on mount is exactly what caused the confusion this
  ADR fixes — the last screen's zoom choice would still leak into the other
  screen's default the next time either mounted, just clamped instead of raw.
- **Give Overview its own zoom levels inside the existing `ZoomId` union** (e.g.
  keep `day`/`two-day`/`week` for Overview, add nothing new). Rejected: Overview's
  actual requirement — a fixed on-screen day count with continuous scroll for
  context — isn't a `DateRange` zoom at all; forcing it through `rangeFor` would
  have meant re-deriving the same "3× context" math outside the type it's supposed
  to describe.
