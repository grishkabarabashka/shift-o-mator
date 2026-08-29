# ADR-0040. One append-only change history, for every entity

**Status:** accepted

## Context

ADR-0032 justified removing unit-scoped write permissions by pointing at the audit trail:
a *complete* record of who changed what is a better control than a permission matrix for
a team of eighty.

The record covered assignments and nothing else. `AssignmentHistoryEntry` was written by
`DraftService.Publish` and by no other code path. Everything below left no trace at all:

| Change | Where | Audited before |
|---|---|---|
| Leave created, edited or deleted | draft publish | no |
| Comp day confirmed, rescheduled, declined | draft publish | no |
| Eligibility, availability, default shift | `PUT /api/people/{id}` | no |
| Coverage minimums, shifts, day configurations | `/api/admin/*` | no |
| Locations, holidays, absence-capacity rules | `/api/admin/*` | no |

Two of those decide tomorrow's roster. Raising a coverage minimum or removing someone's
eligibility changes what auto-populate does, and there was no way to find out who did it.
"Who cancelled my leave" had no answer anywhere in the system.

`GET /api/history` also took only a date range — no filter by person or entity — over an
unindexed, append-only table.

## Decision

**`AssignmentHistoryEntry` becomes `ChangeHistoryEntry`, and every write path uses it.**

```
ChangeHistoryEntry {
  id
  entityType   ASSIGNMENT | ABSENCE | COMP_DAY | PRESENCE | PERSON | CONFIGURATION
  entityId
  action       CREATED | UPDATED | DELETED
  snapshotJson?    full state after the action; null on delete
  personId?        who the record is *about*, when there is one
  summary?         short prose, for entity types whose snapshot is not worth rendering
  actorId, at
}
```

`personId` and `summary` are the two additions that earn their place. `personId` makes
"what happened to me" an index seek instead of a scan that parses every snapshot.
`summary` exists because a serialized `ShiftRequirement` is not what a person reads in a
timeline — *"Coverage minimum for Crew raised 2 → 3"* is.

Draft publishes emit rows from `DraftService` as before, now for absences and comp days
too. Direct writes emit them through `Auth/ChangeAudit` at the endpoint, which is the only
place that knows what happened when no engine is involved.

`GET /api/history` gains `personId` and `entityType` filters, and the table gains indexes
on `At`, `(PersonId, At)` and `(EntityType, EntityId)`.

## Consequences

- The migration **carries the old table across** rather than dropping it, and recovers
  `personId` from the stored snapshot with `JSON_VALUE(SnapshotJson, '$.personId')`.
  Delete rows have no snapshot and legitimately end up with a null `personId`. The
  scaffolded migration wanted to `DropTable`; that would have destroyed the only record
  of every published change ever made.
- The down-migration keeps only assignment rows. A down-migration that loses the audit
  this ADR added is the honest outcome — the old shape has nowhere to put the rest.
- One stream, one query. The People screen's activity timeline, an approval dispute and
  a configuration post-mortem all read the same table.
- Admin endpoints now write two rows per mutation in effect (the change and its audit) in
  one `SaveChangesAsync`, so an audit row cannot survive a failed change or vice versa.

## Alternatives considered

- **A separate audit table per entity.** Five tables, five queries, and every new entity
  is a schema change. The thing being recorded is identical in every case.
- **EF Core interceptors / `SaveChanges` hooks.** Automatic and therefore complete, but it
  records *rows*, not *decisions*: a publish that moves an assignment would log a delete
  and an insert with no indication they were one act, and `summary` could not exist.
- **Leave configuration changes unaudited, since they are Admin-only.** Admin-only is not
  a small group in a four-unit org, and effective-dated configuration (ADR-0021) means a
  change made today can alter what last month's coverage report says.
