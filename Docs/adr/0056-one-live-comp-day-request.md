# ADR-0056. At most one live comp-day placement request

**Status:** accepted.

## Context

Placing a comp day is a request (ADR-0052): the engineer picks a date, an approver
decides. Nothing stopped an engineer from asking twice — for the 12th, then, having
changed their mind, for the 19th. Both requests sat `Submitted`, both in the approver's
inbox, both naming the same `CompDayEntry`.

`PlaceCompDay` had no memory of this: whichever request got decided last wrote
`ActualDate`/`Status` on the entry, with no regard for what a previous decision had
already settled. Deciding the older request *after* the newer one moved the day back —
silently, from the approver's point of view they were approving a request that read
"the 12th" and had no way to know a later request for the 19th existed or had already
been granted.

## Decision

**Creating a new comp-day placement request cancels every other `Submitted` request for
the same `CompDayEntry`**, before the new one is added. `RequestService.Supersede` is
`Cancel` with a narrower gate — it only touches `Submitted`, leaving a request already
decided (approved, rejected, applied) or mid-return-for-amendment (`Draft`) alone. A
decided request is a fact that happened, not a duplicate to clean up.

The superseded request's subject gets a notification (`RequestSuperseded`) naming what
replaced it, so "my request just disappeared" has an answer in the inbox rather than
requiring a question to Support.

Deciding a superseded request now answers `REQUEST_NOT_PENDING` — the same refusal a
request that was rejected or already applied gives. Nothing new to learn: cancellation by
supersession and cancellation by anything else look identical from the deciding side.

This is the same shape of rule `RangeSupersede` (ADR-0052) applies to absences and
presence — the newer record replaces the older rather than the two coexisting — applied
to the one place a *request*, rather than a written record, could duplicate.

## Consequences

- An approver's inbox never shows two live proposals for one comp day. Deciding whichever
  one is there is deciding the current answer.
- The rule is scoped to comp-day placement specifically. Other request types (leave,
  presence) do not supersede each other on creation — two leave requests covering
  overlapping days are not a mistake in the same way, and the write path that actually
  applies leave (`RangeSupersede` on approval) already resolves the overlap correctly at
  that point.
