# Dashboard, Timeline and day drill-down

## Dashboard — the operational overview

**User question:** "Are we covered now and over the selected period, and where must I
act?"

This is the landing page. Most users never go further.

### Summary card

`Dashboard` plus today's long-form date, then one horizontal card:

| Statistic | Meaning |
|---|---|
| On Shift | Filled assignments today across visible regions |
| Regions | Regions currently included |
| Gaps | Current unmet requirements. Red when nonzero, green when zero. |
| Handovers | Unique visible handover definitions |
| Gap Days (Week) | Days in the current Mon–Sun week containing any gap |
| People | People included under the current unit and Only Me filters |

Gaps and coverage are computed **per region**, whatever unit is selected — a unit
filter narrows the roster, never the requirements.

### Attention Required

Appears only when there is something to act on; it is never an empty box.

Each **gap** line: `GAP` badge, region, long role name, role code, required count,
filled count, and the number of eligible suggestions. Each **conflict** line: a
separate `CONFLICT` badge and a description.

Gaps and conflicts are different problems — missing work versus invalid data — and are
listed separately.

**Clicking a gap opens Schedule at the same region and date with the missing role
highlighted.** Without that jump the list is decoration.

### Coverage Timeline card

Shows the active display timezone, the date-range widget, and one collapsible card per
visible region.

A **collapsed** region card is not empty: it shows the region name, `filled/required`,
and a 24-hour minibar — APAC blue, EMEA green, AMER red — with a red now marker
crossing it and a red left edge when the region has a gap. That is what makes
collapsing useful rather than merely quieter.

Expanding shows multi-day shift timelines for the selected range. Dashboard rendering
is capped at 14 days regardless of the chosen zoom; beyond that the information stops
being readable and Schedule is the right tool.

## Timeline — the wall-monitor view

A standalone route. The screen a team leaves open on a second monitor.

- Selected date and display-timezone label.
- A 0–24 hour axis, or a multi-day axis.
- One section per region, one track per role.
- Horizontal shift blocks positioned by local-to-display conversion, each carrying the
  role code and assigned count.
- **Dashed blocks where a required role is unfilled** — the gap is a shape on the
  timeline, not a number elsewhere.
- Pale amber vertical handover bands with labels.
- A vertical red **NOW** marker, updated every minute.
- **Pin to now** — keeps the marker centered and auto-scrolls. Switch it on and forget
  it; this is the whole point of the view.
- An optional bottom headcount strip.
- Hover or click a block for the assigned people.
- A persistent "who is on now" summary.

Zones where regional coverage overlaps are filled, computed on UTC intervals.

Built by hand from CSS grid and absolutely positioned blocks, with one scale function
as the single source of time → px ([ADR-0014](adr/0014-own-grid-and-timeline.md)). No
charting library, no Gantt component.

Timeline needs no dedicated backend: it composes published assignments, region/shift/
handover configuration and coverage snapshots on the client. Add an aggregation
endpoint only if measurement proves client composition is too slow.

## Day drill-down

Same visual grammar, one day expanded, **each assigned person as their own bar**
instead of one bar per role.

Entered from a date header or a Dashboard alert. Shows role annotations, inline gaps
and conflicts, and an Edit action for planners that opens Schedule at that date with a
draft.

## Reports and export

Beyond CSV export and the People metrics:

- a print/PDF-friendly full-month schedule;
- per-person statistics: hours, weekends, comp-off balance, role distribution;
- regional coverage percentage over time and gap frequency;
- a role-equity chart and a rotation-fairness heatmap.

Every export respects the active region and date filters and **states the display
timezone on the artifact**. Exports are built from published assignments unless
explicitly labeled a draft preview.
