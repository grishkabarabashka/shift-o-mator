# ADR-0049. Event types are data; anything that counts as coverage is a Shift

**Status:** accepted, generalises ADR-0017. Its **sickness default is reversed** by
[ADR-0052](0052-two-flows-drafts-for-shifts-approval-for-everything-else.md): sick leave
needs approval after all. `countsTowardCapacity = false` stands.

## Context

`AbsenceType` was a closed enum: `Vacation | Sick | Other`. Adding a kind of leave meant
a code change, a migration and a release — for a row.

The owner's list of what people actually take is longer than three: annual leave, sick
leave, floating holiday, personal days, unpaid leave, furlough. And it will keep growing,
because "what counts as an absence" is an HR policy question that changes without asking
anybody here.

Meanwhile request types were **already** data (ADR-0045). The product could offer a new
kind of *request* without a deployment but not a new kind of *absence*, which is
backwards: the request is the conversation, the absence is the thing.

## Decision

**`AbsenceType` becomes an `EventType` row.**

```
EventType {
  id, code, label, shortLabel, color
  category              LEAVE | SICKNESS | OTHER      -- grouping only
  blocksAssignment      can this person still hold a shift that day?
  countsTowardCapacity  does it count against the simultaneous-absence limit?
  requiresApproval      does raising it go through a route?
  routeId?
  allowsHalfDay
  isActive, sortOrder
}

Absence.eventTypeId : string      -- replaces `type`
AbsenceCapacityRule.countsEventTypeIds : string[]   -- replaces `countsTypes`
```

### The rule that keeps this from metastasising

> **There is no `countsAsCoverage` field on `EventType`, and there never will be. If it
> counts as coverage it is a `Shift`.**

This is [ADR-0017](0017-absence-range-cell-projection.md)'s "training is the `Cover`
shift, not an absence" turned into a schema-level guarantee. Its practical consequence is
the one that matters: **`CoverageCalculator` is not touched by this ADR at all.** An admin
adding a leave type cannot affect coverage arithmetic, because there is no field through
which they could.

### Behaviour is per type, not per enum member

Three flags replace three hard-coded switch statements:

- `blocksAssignment` — a floating holiday somebody worked through does not close the day
  out; vacation does. `isBlocked()` and `CandidateRanker.AvailabilityBlockReason` read it.
- `countsTowardCapacity` — **sickness defaults to false.** Counting unplanned illness
  against a "how many may be away at once" limit would flag the team for something nobody
  chose. A *new* type also defaults to false: silently tightening every existing limit is
  the worse surprise.
- `requiresApproval` — **sickness defaults to false** too, for a different reason: you are
  already off. Approval would be theatre.

### The client's `CellStatus` opens up, but only halfway

```ts
type CellStatus = 'OFF' | 'NOT_SCHEDULED' | 'PH' | 'COMP_OFF' | 'ABSENT';
```

The fixed roster markers stay a closed union — they are product concepts, not
configuration. `ABSENT` is the one that carries detail, and the detail rides alongside in
`CellValue.event` as a denormalised `CellEventInfo` (short label, colour, blocking,
portion) so the memoized cell never looks anything up.

## Consequences

- Deactivating a type does not rewrite history: `isActive: false` removes it from the
  pickers, existing absences keep pointing at it, and the projection falls back to
  "Absent" rather than rendering blank.
- Unknown types **block**. An absence nobody can classify must not quietly make somebody
  schedulable.
- Exclusion reasons name the actual type — "3 eligible, 2 on annual leave" rather than a
  hard-coded "on leave".
- One request type is seeded per approval-needing event type, so "ask for a personal day"
  is offered exactly the way annual leave is.
- The absence import maps spreadsheet vocabulary onto ids by synonym ("PTO", "annual
  leave"), not by matching `code` — the strings come out of somebody else's export and
  are never going to be codes here.
- **A migration trap that no longer applies, recorded because it will look tempting to
  reintroduce:** `AbsenceCapacityRule.CountsTypes` was persisted through
  `JsonListConverter` with `JsonSerializerDefaults.Web`, which registers **no** string-enum
  converter — so the column held enum *ordinals*, `[0,1,2]`. Any future move from an enum
  to a string list in a JSON column needs a data migration, not just a type change. Here
  it was free only because the schema was collapsed to a single migration with no data
  behind it.

## Alternatives considered

- **Keep the enum and add members.** A deployment per HR policy change, which is the
  problem.
- **A fully open `CellStatus`.** Would make `OFF` and `0` configurable too — but those are
  not policy, they are what a roster cell can *be*, and letting an admin delete "Off"
  serves nobody.
- **Give `EventType` a `countsAsCoverage` flag** so a type could be "working". That is a
  `Shift`, and offering two ways to say it guarantees they will disagree.
- **Model entitlement alongside the type** (days per year, accrual). Explicitly refused —
  [ADR-0047](0047-absorb-the-self-service-portal.md) draws the line at entitlement, and
  this is where the pressure to cross it will appear.
