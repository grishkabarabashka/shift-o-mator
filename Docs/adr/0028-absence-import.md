# ADR-0028. Absence import: one shared ranker's sibling — one diff engine, one batch

**Status:** accepted — implements [11-integrations.md](../11-integrations.md) "Absence import"

## Context

11-integrations.md is the design authority here, not a decision being made
fresh: paste or upload, column mapping saved as a template, person matching
by employee ID then name, a diff (added/changed/gone), impact on published
shifts, a freshness indicator, one batch with one-click rollback, landing in
a draft. This ADR records the implementation choices the doc left open and
one correctness decision worth defending on its own.

The domain model already anticipated this stage: `Absence.source`,
`importBatchId` and `lastSeenInImportAt` have existed since the absence
entity was designed (ADR-0017) — nothing new to add there, only to populate.

## Decision

**One pure engine module, `engine/absenceImport.ts`, six steps in sequence:**
parse → map columns → match people → diff against what's on file → impact on
published shifts → build one batch of `DraftChange`s. Each step is a
standalone function; the wizard UI holds the sequencing and the two pieces of
step-to-step state a pure function can't own (which suggestion the planner
picked, which "gone" row they confirmed). Nothing in the engine touches the
store, `Date.now`, or `localStorage`.

**"Gone" is scoped to the date span the import actually covers.** An
existing `IMPORT`-sourced absence is only flagged missing if its range
overlaps `[min(from), max(to)]` across the pasted rows. Without this, a
partial-period export — copying just this month's rows out of a bigger sheet
— would flag every absence outside that window as cancelled, which is
exactly the false signal 11-integrations.md warns about ("was the leave
cancelled, or did the row simply not make it into this export?"). Absences
with `source: 'MANUAL'` are never candidates for "gone" at all — only the
leave system's own prior export can tell the leave system its own record
disappeared.

**Every matched row becomes a draft change, including unchanged rows.**
"Unchanged" only means the visible fields (type, note) didn't move; the
record's `lastSeenInImportAt` still needs to advance so the *next* import's
gone-detection has an accurate baseline. The N/M/K counts shown to the
planner report added/changed/gone; the quiet `lastSeenInImportAt` refresh on
an unchanged row isn't a fourth number worth surfacing.

**One `commitAbsenceImport` call, one undo-stack batch.** The store's
existing undo mechanism (`useSchedule.undoStack`, one user action per
batch — see `useSchedule.ts`) already does exactly what "one-click rollback"
asks for, the same way `commitAutoPopulate` reuses it for generation. No
separate import-batch ledger was built; `importBatchId` on each `Absence`
still marks which import produced it (visible in `note`/id if ever needed),
but *rolling back* an import is Undo, not a bespoke history screen. This
holds only while the import stays in the current draft session — once
published, "rollback" is a new absence edit like any other, same as every
other draft change in this product (ADR-0015).

**Column mapping and remembered person matches live in `localStorage`, not
the domain.** Both are per-browser conveniences with no audit value — a
mapping template is "which column is which" for *this planner's* copy of the
export, and a remembered match just stops the same question being asked
twice. Neither belongs in `ScheduleRepository` (ADR-0012), which is reserved
for data that means something to more than one browser tab.

**Two hard-typed identifying columns, ID first.** A row can map both a
Person (Employee ID) and a Person (Name) column at once; matching tries the
ID column first, falls back to the name column only if the ID doesn't
resolve. This is 11-integrations.md's "by employee ID; failing that by name"
read literally as one row's fallback chain, not as two separate import modes.

**Date parsing accepts ISO and day-first `D/M/YYYY`.** ASSUMPTION: the
corporate export's locale has never been confirmed against a real sample.
Day-first was chosen because it matches more of the region set (EMEA, APAC)
than month-first would, and every parsed candidate is validated through
`engine/dates.ts#parseDate`, so a malformed date (`31/02/2026`) is rejected
rather than silently wrapped into a real one. Cheap to revisit once an actual
export is seen.

## Consequences

- Person matching for a recurring monthly export gets *quieter* over time:
  every manual resolution is remembered, keyed by the raw text that needed
  resolving, so the fifth import of the same sheet should ask nothing.
- The freshness indicator (`absenceFreshness`, read in `AppShell`) is derived
  from `published.absences`, not `plan.absences` — it reports what every
  viewer is currently trusting, not what the current planner's unpublished
  draft would make true once published. A freshly-imported-but-unpublished
  batch does not make the badge look newer than it should.
- Impact analysis reads `published.assignments`, not the draft's `plan` —
  "these assignments need a replacement" is about commitments that are
  already live, not about a hypothetical the planner hasn't published yet.
- Import UI never blocks on an unresolved row forever: Apply proceeds with
  whatever *is* resolved, and unresolved rows are simply not imported this
  time (they carry no memory of what wasn't done, so the next import will
  ask the same question until it's answered).

## A bug the tests found: Select dropdowns were unclickable inside a Dialog

Not part of the design doc, found while wiring the review step, which is the
first screen in this codebase to open several Radix `Select`s from inside a
Radix `Dialog`. `.select__content` carried `z-index: 65`; `.overlay` (the
dialog's own backdrop) carries `70`. Both portal to `document.body` as
siblings, not as parent/child, so z-index alone decided the stacking order —
the dialog's backdrop sat on top of the dropdown and silently absorbed every
click on a suggestion or a person picker. Raised `.select__content` to `75`,
above every dialog. This was latent in every existing dialog with a `Select`
(`AutoPopulateDialog`'s region picker, `AbsenceDialog`'s type picker); this
feature just opened enough Selects inside a Dialog, in a row, for the browser
run to catch it.

## Alternatives considered

- **A dedicated import-batch history/rollback screen**, tracking every batch
  ever applied with its own undo, independent of the draft's undo stack.
  Rejected for the MVP: the draft's undo already is a per-action batch
  mechanism, and a second one next to it would mean two different "undo"
  concepts a planner has to keep straight. Revisit if imports start spanning
  multiple draft sessions before being reviewed.
- **Treat any two rows with the same person+dates as "the same absence"
  regardless of source**, letting a manually-entered vacation get silently
  absorbed into an import. Rejected: a `MANUAL` record is a planner's own
  decision, and 11-integrations.md's source-of-truth split (this product
  plans, the corporate system tracks leave) means the two must stay
  distinguishable, not merged on first collision.
