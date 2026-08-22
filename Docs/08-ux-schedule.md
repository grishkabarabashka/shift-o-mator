# Schedule — the planning workspace

**User question:** "Who is assigned on each day, does the rota meet the rules, and what
should I change?"

One large white planning card holding a toolbar, the grid, and the coverage area.

## Toolbar

The date-range widget sits at the top: back / Today / forward, a human-readable range,
zoom choices, presets, a clickable day strip, and a year minimap for long ranges whose
selected window can be dragged.

Below it, a right-aligned action row:

| State | Actions |
|---|---|
| Published | Export, then any cell edit opens a draft |
| Draft active | Generate, Undo, Redo, Cancel, **Review & Publish (N)** |

`N` is the pending change count. The global header shows the `✏️ Draft` tag while a
session is open. No separate Edit mode — any cell change opens a draft immediately.

## Zoom levels

| Zoom | Columns | Purpose |
|---|---|---|
| Day | 1 | Drill-down, one column per person-hour detail |
| Week | 7 | Full shift codes, primary editing view |
| Two weeks | 14 | Compact codes, still editable |
| Month | 28–31 | Dense codes; the default planning horizon |
| 3 / 6 months | Weeks | **Read-only heatmap** for pattern recognition |

The heatmap is for leave blocks, shift density and fairness — not editing. Each person
is one row, each day a small colored cell, weeks grouped by header, names sticky while
both axes scroll.

## Grid layout

- First column pinned, labeled **Team Member**, 185px, text-filterable. Each cell shows
  display name and muted initials; the title attribute carries location and shift.
- Date columns 62px. Headers show three-letter weekday and date number. Weekends muted;
  today gets a pale-blue fill and a red underline.
- Rows 26px.
- Horizontal scroll on dates; names stay pinned.

### Scope and grouping

The grid shows the selected **planning unit** by default. Grouping comes from
`PlanningUnit.groupBy`:

```
AMER  ·  [● unit]  [ whole region ]        ← scope toggle

CHICAGO             (4)
  Person 06   Lead  Crew  Batch-E …
NEW YORK            (5)
  Person 07   Crew-BC …
PUNE                (6)
  Person 12   Batch-L …
```

| Unit kind | Default grouping |
|---|---|
| `REGION` (unit-amer, unit-emea, unit-apac) | by **location** — locations differ in holidays and timezone, which is what a planner needs to see |
| `CROSS_REGION` (unit-st) | by **region** — the same duty in three rule contexts |
| more than one unit in scope (`ALL`, or several picked explicitly) | by **unit** first, then by that unit's own grouping within it |

`ORG_CATEGORY` is available as a third grouping for units that want it.

**The unit picker takes any set, not just "all or one"** (the picker in the header —
Docs/07-ux-shell.md). A planner running AMER together with Service Transition selects
exactly those two; grouping by unit first is what keeps Chicago (AMER) from sitting next
to Chicago (ST) with no visible label saying whose rules apply to which.

**The unit is a default filter, not a boundary**
([ADR-0032](adr/0032-planning-unit-single-rule-axis.md)). The scope toggle switches between
"this unit" and "all shifts this unit offers" (including people from other units holding those shifts). Since every planner can write everywhere, a
gap in a shift belonging to another unit — an `ST:AMER` hole seen from the unit-amer grid —
is fixed in place, without navigating away.

Coverage is always computed **per unit**, whatever the grid is currently showing. A
unit filter narrows the rows, never the requirements.

### Cells

Each cell renders one `CellValue` (see [01-domain-model.md](01-domain-model.md)):

| Value | Rendering |
|---|---|
| Working shift | Full-cell colored chip, shift code, white or dark text by contrast. On-call codes are ordinary shifts and render the same way. |
| `Off`, `0`, `PH`, `Comp-Off`, `Vacation`, `Sick` | Muted gray chip with the status code |
| Empty | Blank |
| Ineligible weekend cell | Em dash — the person cannot be placed here at all |
| Proposed comp day | Dashed hint over an empty cell |
| Conflict | Red border plus the reason in the tooltip |
| Draft change | Visually distinct from a published cell |

## Coverage area

Two things, both under the grid, both visible while planning:

1. **Pinned coverage row** — one cell per date showing aggregate `filled/required`.
   Green when every minimum is met, amber on thin, red when any shift is below minimum.
   The tooltip lists the failing shifts: `Lead: 0/1`.
2. **Per-shift coverage strip** — one row per shift, one column per day, each cell
   `actual/min`. Red is a gap, amber below target or thin.

The aggregate answers "is this day fine"; the strip answers "which shift is the hole".
The prototype only had the aggregate, which means a planner has to hover every red day
to find out what's missing. Keeping both is the point at which this beats a
spreadsheet.

Clicking any coverage cell moves the grid selection to that date.

## Editing

Clicking a cell selects it. Any mutating action — right-click, Enter, or a hotkey to
paint a range — opens a draft session automatically. No separate Edit mode.

### Assignment picker

Right-click a cell — or press Enter on a focused cell — to open a floating portal
dropdown, rendered outside the grid so overflow cannot clip it:

```
┌──────────────────────────────┐
│ PERSON 06 · 2026-08-17       │
├──────────────────────────────┤
│ SHIFTS                       │
│ ■ Lead      09:45–18:45 CT   │
│ ■ Crew      09:00–18:00 CT   │
│ ■ Batch-E   09:00–18:00 CT   │
├──────────────────────────────┤
│ NON-WORKING                  │
│ □ Off                        │
│ □ 0  (not scheduled)         │
│ □ Comp-Off                   │
│ □ Vacation                   │
│ □ Sick                       │
├──────────────────────────────┤
│ ✕ Clear                      │
└──────────────────────────────┘
```

The Shifts section lists **only shifts in that day's configuration for which this person
is eligible**, plus the unit's default shifts. Each shows color, code, long name and
window. Clear appears only when the cell is populated and is styled destructively.

Non-working entries create the right entity for their meaning
([ADR-0017](adr/0017-absence-range-cell-projection.md)): `Off` and `0` write a roster
marker on the assignment; `Vacation` and `Sick` create a one-day `Absence` that can be
extended into a range; `Comp-Off` schedules a `CompDayEntry`. There is no `Training`
entry — in-hours training is the `Cover` shift and appears in the Shifts section.

Selection applies immediately, stages a draft change, and recomputes coverage. The
picker closes on selection or outside click.

### Keyboard

| Key | Action |
|---|---|
| Arrows | Move focus |
| Shift + arrows | Extend selection |
| Home / End | Row start / end |
| Enter | Open picker on the focused cell |
| Escape | Close picker, then clear selection |
| Shift hotkey | Apply that shift to the whole selection |
| Delete / Backspace | Clear the selection |
| Ctrl/Cmd + C / V | Copy / paste a range |
| Ctrl/Cmd + Z / Y | Undo / redo |

Hotkeys are a fast path for painting ranges. The picker is the discoverable path and
the one a new planner finds first.

### Mouse and bulk

- **Paint** — pick a shift in the palette, drag across cells.
- **Range select** — shift-click or drag; a bulk action applies one value to the whole
  selection.
- **Fill pattern** — repeat a selected shift/status sequence across a date range.
- **Drag** a populated cell to another date to move it; between people to swap — the
  swap applies **only if both resulting assignments are valid**.
- **Drag from the shift palette** to create.
- Valid drop zones highlight positively; invalid ones name the rule that blocks the
  drop — eligibility, date or conflict.
- **Lock** a cell before Generate; locked assignment IDs are passed to the generator and
  never replaced.

> The prototype chose AG Grid and hit exactly the limitation ADR-0014 predicted:
> `@dnd-kit` had to be added separately and drag/drop never landed. The grid here is
> hand-built ([ADR-0014](adr/0014-own-grid-and-timeline.md)); its layout borrows the
> prototype's proven dimensions.

## Review and publish

Save opens the review overlay before anything becomes public:

- created / modified / removed totals;
- a scrollable diff listing old → new per change;
- an impact summary: gaps fixed, gaps created, conflicts, comp-offs generated or moved;
- **Discard** and **Publish**.

Publication is atomic. Full rules in
[03-drafts-and-publication.md](03-drafts-and-publication.md).

## Multi-editor

Another planner holding an overlapping draft produces a **blue informational banner**,
not a block. Conflicts surface at publish as a compare/refresh/reapply flow. The draft
is never discarded on a failed publish.
