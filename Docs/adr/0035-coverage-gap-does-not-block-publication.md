# ADR-0035. Coverage gap does not block publication

**Status:** accepted

## Context

ADR-0009 set three severity levels — BLOCKING, WARNING, INFO — and put an unfilled
coverage minimum (`CoverageGap`) at BLOCKING: a shift with `actual < min` refused
publication until someone filled it. ADR-0024 later carved conflicts out of that
rule ("a conflict does not block either — coming in during your own leave is a
decision, not corrupt data"), leaving `CoverageGap` and `DoubleAssignment` /
`ShiftOutsideRegion` as the only remaining BLOCKING codes.

In practice, `CoverageGap` blocking meant a planner could not save *any* draft
change while a single shift anywhere in the period sat under minimum — including
gaps that predate the draft, gaps in a different unit than the one being edited,
and gaps the planner has no way to fill before end of day (nobody eligible, nobody
available). The owner's review: gaps are real information and must stay visible —
shown in the coverage strip, the Overview timeline, and the issues panel — but they
must never be the thing standing between a planner and saving the rest of a valid
draft.

## Decision

**`CoverageGap` moves from `BLOCKING` to `INFO`.** Category stays `GAP` — it is
still a gap, chinится the same way (assign someone), counted the same way in every
summary — only the severity that used to block publication changes.

```
CheckCoverage:
  actual < min  → IssueLevel.Info, IssueCategory.Gap, IssueCode.CoverageGap   // was Blocking
  actual == min → IssueLevel.Info, IssueCategory.Gap, IssueCode.CoverageThin   // unchanged
  actual > max  → IssueLevel.Warning, IssueCategory.Policy, IssueCode.CoverageOverMax  // unchanged
```

`Validator.CanPublish` needed no change — it already reads `Level`, not a
gap-specific special case, and inherits the new behavior automatically. Everywhere
else that used to detect a gap by `level === BLOCKING && category === GAP` now
checks the code directly: `isCoverageGap(issue) === (issue.code === 'COVERAGE_GAP')`.
Level-based detection would have silently gone blind to gaps the moment this ADR
shipped; code-based detection doesn't care what the level is.

**BLOCKING now means exactly what CLAUDE.md §11 already claimed it meant**: a
double assignment, or a shift that doesn't exist or belongs to another unit —
records that cannot be right under *any* decision. A gap is a decision still to be
made, not corrupt data.

## Consequences

- A draft with gaps but no unacknowledged warnings and no BLOCKING conflicts
  publishes normally. The Review dialog shows gap count as an informational chip
  ("N coverage gaps will stay after publishing"), not a rejection.
- Coverage gaps remain red in the grid, the coverage strip, and the Overview
  timeline — visual severity is driven by category/code, not by `IssueLevel`, and
  nothing here changes what a gap looks like.
- `IssueSummary.Gaps` is computed from `IssueCode.CoverageGap` directly, not from
  `Level == Blocking`, so the count survives this change without becoming 0.
- The Overview "on shift now" / gaps chip, `IssuePanel`'s GAP bucket, and
  `GridCell`'s per-cell issue border all had to switch off level-based gap
  detection to a code-based `isCoverageGap` predicate (`engine/issues.ts`).

## Alternatives considered

- **Add a per-draft override ("publish anyway").** Rejected: an extra click that
  every planner would hit every time defeats the point, and a standing override
  that's always on is the same as not blocking, with more code.
- **Only block gaps created or worsened by the current draft.** Attractive, but
  needs the server to diff "gaps at draft-open time" against "gaps now" per cell,
  and still leaves an unrelated existing gap blocking an unrelated edit — the exact
  complaint that prompted this change.
- **Keep BLOCKING, but scope it to the unit being edited.** Same shape of problem
  one level down: a gap in a shift the planner has no near-term way to fill still
  blocks work on cells that have nothing to do with it.
