# Drafts and publication

The published rota and a planner's work-in-progress are different things. Editing the
shared spreadsheet *is* editing the live rota; that is one of the problems this product
exists to remove.

See [ADR-0015](adr/0015-optimistic-drafts-and-publication.md), which supersedes the
earlier period-locking decision.

## States

```
Published assignments        the authoritative rota, visible to everyone
        ▲
        │  Publish (atomic)
        │
DraftSession { editor, region, from..to, OPEN }
        └─ ordered DraftChange[]      create / update / delete
```

A viewer never sees draft data. A planner sees published data overlaid with their own
draft changes, visually distinguishable from published cells.

## Lifecycle

1. **Open.** The planner presses Edit. A session is created for (editor, region,
   period), or the existing open session is returned. A `Draft` tag appears in the
   global header.
2. **Edit.** Every cell change appends a `DraftChange` carrying the full before and
   after value. Coverage and validation recompute immediately against
   published + draft.
3. **Undo / redo.** Reverses changes in order. Because each change carries both
   values, the inverse is free.
4. **Review.** Save opens the review overlay: counts of created / modified / removed,
   a scrollable diff of old → new, and an impact summary — gaps fixed, gaps created,
   conflicts, comp-offs generated or moved.
5. **Publish.** The whole ordered set applies as one transaction. On success the draft
   becomes `PUBLISHED`, history rows are appended, and affected published data reloads.
6. **Discard.** The session becomes `DISCARDED` and is retained for audit rather than
   deleted. Confirmation states how many changes will be reversed.

## Concurrency

**Concurrent drafts are allowed.** One open session per (editor, region) with an
overlapping period; a second request from the same editor returns the existing session.
Different planners may draft the same region and period at the same time.

When another planner has an open session overlapping yours, show a **blue informational
banner** naming them and their period. Do not block entry — pessimistic locking
produces the "someone went on holiday holding September" failure and solves a problem
that does not occur at this team size.

Conflicts are resolved at publish, not prevented up front:

- every published assignment carries a version token;
- publish revalidates the whole set against the current published state;
- a stale change produces a conflict result rather than an overwrite;
- the planner sees published value versus draft value and chooses refresh, reapply or
  drop, per change.

Silent overwrite is never acceptable.

> **Divergence from the prototype, deliberate.** The prototype scopes a draft session
> to a Monday week start. Planning here happens by month, so the session is scoped to
> an explicit period instead. The uniqueness rule generalizes accordingly: one open
> session per editor and region with an overlapping range.

## Publish preconditions

| Condition | Behavior |
|---|---|
| Unresolved `BLOCKING` issue | Publication refused. An Admin force action exists, must be explicit, and is audited. |
| Unacknowledged `WARNING` | Publication allowed only after each warning is acknowledged with a comment. |
| `INFO` | No effect on publication. |
| Stale version | Conflict reconciliation flow; the draft is preserved. |
| Publish fails for any reason | **The draft and every pending change survive.** Never clear a draft on failure. |

## What a draft can contain

`DraftChange.targetType` covers `ASSIGNMENT`, `ABSENCE` and `COMP_DAY`. Marking an
absence, confirming a comp day and assigning a role are all staged the same way and
published together — a planner should never have half their work live and half pending.

Configuration (roles, requirements, holidays, handovers) is **not** part of a schedule
draft. Settings has its own dirty-state and Save All, because a rule change affects
every period rather than one planner's period.

## Audit

Publishing appends to `AssignmentHistory`: assignment, action, full snapshot, actor,
timestamp. Append-only. This is what makes "why is this person on Saturday" answerable
six months later, and it is what a discarded session is retained for.
