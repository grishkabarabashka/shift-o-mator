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
        │  Publish (atomic transaction)
        │
DraftSession (server)  { editor, unitId, from..to, OPEN | PUBLISHED | DISCARDED }
        └─ ordered DraftChange[]      create / update / delete (ASSIGNMENT, ABSENCE, COMP_DAY)
```

A viewer never sees draft data — only what is published. A planner sees published
data overlaid with their own draft changes, visually distinguishable from published
cells. Draft sessions and their changes live server-side; the client downloads them
via `GET /api/drafts/{id}` and applies changes via `POST /api/drafts/{id}/changes`.

## Lifecycle

1. **Open.** Any cell edit (right-click, Enter, or hotkey) sends `POST /api/drafts`
   creating a session for (editor, unit, period), or returns the existing open
   session if one exists. A `Draft` tag appears in the global header. The draft is
   persisted server-side.
2. **Edit.** The client declares the *desired state* of the cells it touched —
   `POST /api/drafts/{id}/changes/sync`, one request per debounced batch, each item a
   key (`personId|date` for an assignment, the row id for a comp day) and
   the value that cell should end up with. The server derives create / update / delete
   by comparing against published data, captures the `before` snapshot itself, and keeps
   **exactly one change per key**. Coverage and validation recompute immediately
   server-side and reflect against published + draft on the next query.

   > **Why state, not a log of operations.** The client used to send one POST per
   > change with an op it computed locally. Repainting a cell the same draft created
   > produced an `UPDATE` against a row that does not exist in published data yet — a
   > 400 that aborted the rest of the batch, silently, leaving the grid showing edits
   > the server never received. Declaring state removes the whole class: the client
   > cannot compute the wrong op because it no longer computes one, and a retry is
   > idempotent because the desired state is recomputed from the plan.

3. **Undo / redo.** Undo is not a separate server operation: it changes the plan, and
   the next sync sends what the affected cells became. Locally, each change carries both
   values, so the inverse is free.
4. **Review.** Save opens the review overlay: counts of created / modified / removed,
   a scrollable diff of old → new, and an impact summary — gaps fixed, gaps created,
   conflicts, comp-offs generated or moved.
5. **Publish.** `POST /api/drafts/{id}/publish` applies the whole ordered set as one
   transaction. On success the draft becomes `PUBLISHED`, history rows are appended
   server-side, and affected published data reloads. Returns `remainingGaps` and conflict
   metadata if any.
6. **Discard.** `POST /api/drafts/{id}/discard` marks the session `DISCARDED` and is
   retained server-side for audit. Confirmation states how many changes will be
   reversed.

## Concurrency

**Concurrent drafts are allowed.** One open session per (editor, unit) with an
overlapping period; a second request from the same editor returns the existing session.
Different planners may draft the same unit and period at the same time.

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
> session per editor and **planning unit** with an overlapping range.

## Publish preconditions

**Exactly two things block a publish**, and both are data that cannot be true under any
decision: a double assignment, and a shift that does not exist or belongs to another
unit. Everything else is a decision the planner still has to make, and the product does
not refuse to save a decision it disagrees with.

```
CanPublish(issues) = !issues.Any(i => i.Level == Blocking)
```

| Condition | Behavior |
|---|---|
| Unresolved `BLOCKING` issue | Publication refused. Only two cases produce one: a double assignment, and an unknown or wrong-unit shift ([ADR-0009](adr/0009-three-severity-levels.md)). |
| Coverage gap (filled &lt; min) | **Does not block** ([ADR-0035](adr/0035-coverage-gap-does-not-block-publication.md)). A gap is work not yet done, not corrupt data; it is `INFO`, category `Gap`, and stays highlighted everywhere. |
| Conflict (assigned during absence or comp day, ineligible shift) | **Does not block** ([ADR-0024](adr/0024-conflicts-do-not-block.md)). Acknowledgeable with a comment, which is kept as a record. |
| Unacknowledged `WARNING` | **Does not block** ([ADR-0037](adr/0037-warnings-do-not-block-publication.md)). Acknowledgement is still available and still recorded — it simply stopped being a precondition. |
| `INFO` | No effect on publication. Thin coverage and preference violations are highlighted, never blocking. |
| Stale version (concurrency token moved) | Conflict reconciliation flow; the draft is preserved. Every mutable entity carries an `int` version ([ADR-0042](adr/0042-concurrency-tokens-for-absences-and-comp-days.md)); the client compares, then refreshes and reapplies. |
| Publish fails for any reason | **The draft and every pending change survive.** Never clear a draft on failure. Actionable error with retry, surfaced as a dismissible banner rather than replacing the screen. |

## What a draft can contain

`DraftChange.targetType` covers `ASSIGNMENT` and `COMP_DAY`. **A draft publishes the
rota**, and nothing else
([ADR-0052](adr/0052-two-flows-drafts-for-shifts-approval-for-everything-else.md)).

Comp days stay because a comp day is *earned by* a weekend shift in the same draft:
accruing one for a shift that might still be withdrawn before publication would credit
work nobody has committed to.

**Absences left.** A draft's value is review before something becomes real, by the person
staging the batch. Time off already has a review step — approval — and it names the human
who decided. Keeping absences here meant a sick day stayed invisible until an unrelated
planner happened to publish, and that recording one called a planner-only endpoint. They
go to `/api/absences` directly, or through a request when the kind of absence needs
approval.

Presence never was in a draft ([ADR-0043](adr/0043-presence-is-an-orthogonal-range-entity.md)).

Configuration (shifts, requirements, holidays, handovers) is **not** part of a schedule
draft. Settings has its own dirty-state and Save All, because a rule change affects
every period rather than one planner's period.

**Presence is not part of a draft either** ([ADR-0043](adr/0043-presence-is-an-orthogonal-range-entity.md)).
Where someone works is not a roster decision: it never affects coverage, never blocks a
publish, and is owned by the person it describes. Staging it in a planner's draft would
mean an employee's "remote on Tuesday" stayed invisible until somebody else published.
It is still versioned and still audited — the two properties the draft was providing.

The same goes for an **approved request**
([ADR-0045](adr/0045-generic-request-envelope-typed-materialization.md)): it has already
been reviewed by a named human with a recorded comment, so it writes its `Absence` or
`PresenceRecord` directly rather than waiting for a second review nobody asked for.

## Audit

Publishing appends to `ChangeHistory`: entity type, entity id, action, full snapshot,
the person it is about, actor, timestamp. Append-only. This is what makes "why is this
person on Saturday" answerable six months later, and it is what a discarded session is
retained for.

It covers **every** entity, not just assignments
([ADR-0040](adr/0040-one-change-history-for-every-entity.md)): leave, comp days,
presence, person-profile edits and every `/api/admin/*` configuration change. That
matters because [ADR-0032](adr/0032-planning-unit-single-rule-axis.md) removed
unit-scoped write permissions on the explicit grounds that this trail is the control — a
trail that stopped at assignments could not carry that argument.

The actor is taken from the authenticated principal, never from a request field
([ADR-0039](adr/0039-actor-identity-from-the-token.md)). A body-supplied actor id would
make the whole trail forgeable by exactly the people it constrains.

`GET /api/history` filters by date range, by `personId` ("what happened to me") and by
entity type.
