# ADR-0015. Optimistic drafts and atomic publication

**Status:** accepted — **supersedes [ADR-0011](0011-checkout-instead-of-realtime.md)**

## Context

ADR-0011 chose pessimistic period locking: one planner checks out a (region, period)
pair, everyone else reads. It was written on the assumption that with one or two
planners per region, conflicts are rare enough that preventing them is cheaper than
resolving them.

Two things invalidate it.

**First, the earlier corporate implementation went the other way and it worked.** It
allows concurrent draft sessions, shows an informational banner when two planners
overlap, and resolves conflicts at publish through row versions and a compare/refresh
flow. That is evidence from real operation, not a preference.

**Second, ADR-0011 had no answer for the more important half of the problem.** Locking
addresses "two planners edit at once". It says nothing about "a planner's work in
progress must not be visible as the published rota" — and that is the problem the
product actually exists to solve. Editing the shared spreadsheet *is* editing the live
rota; a lock does not change that. Without a published/draft split, the
publication that [ADR-0009](0009-three-severity-levels.md) refuses to allow does not
exist.

The lock also introduced a failure mode that had to be patched with a force-release
administrator action: someone goes on leave holding September.

## Decision

Replace locking with drafts.

- `DraftSession` (editor, region, period, `OPEN | PUBLISHED | DISCARDED`) holds an
  ordered list of `DraftChange` records, each carrying the full before and after value.
- A viewer sees only published data. A planner sees published data overlaid with their
  own draft, visually distinguished.
- **Concurrent drafts are allowed.** One open session per (editor, region) with an
  overlapping period. When another planner overlaps, show a blue informational banner
  naming them — do not block.
- Publication applies the whole ordered set in one transaction, appends history, and
  marks the session published.
- Every published assignment carries a version token. Publish revalidates against
  current state; a stale change yields a conflict result with published-versus-draft
  comparison and refresh / reapply / drop per change. Silent overwrite is never
  acceptable.
- A failed publish preserves the draft and every pending change.

## Consequences

- The published/draft distinction becomes real in the data model, which is what makes
  "publication is blocked by an unresolved gap" enforceable.
- Undo/redo stays free: each change carries both values, so the inverse is the same
  record reversed.
- The review overlay — counts, diff, impact summary — becomes possible, because there
  is a discrete set of changes to review.
- Discarded sessions are retained for audit rather than deleted.
- Cost: conflict reconciliation UI must be built. It is a rarer path than locking's
  force-release, but a more complex one.
- `PeriodLock` and the check-out/release UI are deleted.

## Alternatives considered

- **Keep pessimistic locking** and add a published/draft split separately. Two
  mechanisms for one problem, and the lock still strands periods.
- **Real-time collaborative editing** (CRDT / OT). Rejected for the same reason as in
  ADR-0011: an entire subsystem with its own conflict model, for two planners per
  region.
