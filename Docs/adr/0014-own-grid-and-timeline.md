# ADR-0014. Timeline and grid are built in-house

**Status:** accepted

## Context

The two most visible components of the product are the shift timeline and the
planning grid. Off-the-shelf libraries exist for both.

## Decision

Both are hand-built.

**Grid.** AG Grid Community doesn't include range selection, fill handle, or clipboard
operations — exactly the features it gets picked for. At 80 rows and ~30 columns, a
custom implementation wins: full control over keyboard and paint mode, no license,
roughly 500–800 lines of code.

**Timeline.** Gantt libraries are heavy, impose their own data model, and resist
recoloring to a corporate style. Implementation: one scale function (`d3-scale`,
`scaleTime`) as the single source of truth for time → px conversion, bars as
absolutely positioned `div`s (so corporate component styles still apply), SVG only for
the grid and overlap fills.

## Consequences

- The grid's keyboard behavior is shaped by the task, not by what a library happens to
  support.
- No virtualization needed: 80 rows × ~30 columns render in full (see
  [12-architecture.md](../12-architecture.md), scale section).
- A single source of truth for time → px conversion rules out drift between the scale
  and the bars.
- Cost: accessibility and selection edge cases are hand-built and need tests.
- Final confirmation on the grid comes after seeing a real spreadsheet export — that's
  what'll show which range operations actually matter.

## Alternatives considered

- **AG Grid Enterprise.** A license for features that fit in a few hundred lines here.
- **An off-the-shelf Gantt (dhtmlx, frappe, vis-timeline).** Its own data model,
  heavy weight, expensive to recolor to a corporate style.
