# Overview — the operational dashboard and timeline merged

## The operational overview

**User question:** "Are we covered now and over the selected period, and where must I
act?"

This is the landing page. Most users never go further.

Overview combines three layers of decreasing urgency into one screen:

1. **Summary statistics** — period metrics at a glance.
2. **Attention Required** — actionable gaps and conflicts, with jump-to-grid links.
3. **Continuous timeline** — one or more days of shift blocks and coverage, one section
   per visible planning unit.

### Summary card

Period start and end dates in long form, then one horizontal card showing:

| Statistic | Meaning |
|---|---|
| On Shift | Filled assignments today across the visible units |
| Units | Planning units currently included in the view |
| Gaps | Current unmet requirements. Red when nonzero, green when zero. |
| Handovers | Unique visible handover definitions |
| On site / remote | People in an office versus working remotely today ([ADR-0043](adr/0043-presence-is-an-orthogonal-range-entity.md)) |
| Gap Days (Week) | Days in the current Mon–Sun week containing any gap |
| People | People in scope (filter by planning unit narrows the roster, never the requirements) |

Gaps and coverage are computed **per planning unit** — the single rule axis
([ADR-0032](adr/0032-planning-unit-single-rule-axis.md)). The unit scope picker narrows
the people listed, never the coverage requirements.

### Attention Required

Appears only when there is something to act on; never an empty box.

Each **gap** line shows: `GAP` badge, planning unit, long shift name, shift code,
required count, filled count, and eligible suggestion count. Each **conflict** line
shows: `CONFLICT` badge and a description.

Gaps and conflicts are separate problems — missing work versus invalid data —
listed separately and with separate badges.

**Clicking a gap opens Schedule at the same unit and date with the missing shift
highlighted.** This link is the entire point; the list alone is decoration.

### Timeline card

One **continuous timeline** showing the active display timezone, date-range controls,
and shift blocks positioned by UTC-converted shift windows across the visible period.

- One collapsible card per visible planning unit.
- A **collapsed** unit shows: unit name, `filled/required`, and a 24-hour minibar with a
  red now marker crossing it and a red left edge if the unit has a gap. Collapsing is
  useful, not just quieter.
- **Expanding** shows multi-day shift timelines for the selected range.
- Horizontal shift blocks positioned by local-to-display conversion, each carrying
  shift code and assigned person count.
- **Dashed blocks where a required shift is unfilled** — the gap is a visual shape,
  not a number buried in a row.
- Pale amber vertical handover bands with labels.
- A vertical red **NOW** marker, updated every minute.
- **Pin to now** — centers the marker and auto-scrolls; switch on and forget it.
  This is the entire point of the view.
- Hover or click a block for the assigned people.
- A persistent "who is on now" summary.

Rendering is capped at 14 days regardless of zoom; beyond that the information stops
being readable and Schedule is the right tool.

Built by hand from CSS grid and absolutely positioned blocks, with one scale function
as the single source of time → px ([ADR-0014](adr/0014-own-grid-and-timeline.md)). No
charting library, no Gantt component.

The timeline composes published assignments, unit/shift/handover configuration and
coverage snapshots on the client; no dedicated backend aggregation needed.

## Day drill-down

Same visual grammar, one day expanded, **each assigned person as their own bar**
instead of one bar per shift.

Entered from a date header or an Overview alert. Shows shift annotations, inline gaps
and conflicts, and an Edit action for planners that opens Schedule at that date with a
draft.

## Reports and export

Beyond CSV export and the People metrics:

- a print/PDF-friendly full-month schedule;
- per-person statistics: hours, weekends, comp-off balance, shift distribution;
- per-unit coverage percentage over time and gap frequency;
- a shift-equity chart and a rotation-fairness heatmap.

> **Not built.** Everything in this section is specified and unimplemented; export is a
> remaining roadmap stage ([13-roadmap.md](13-roadmap.md)). The only export-shaped code
> that exists today is the absence *import* wizard.

Every export respects the active unit scope and date filters and **states the display
timezone on the artifact**. Exports are built from published assignments unless
explicitly labeled a draft preview.
