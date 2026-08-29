# ADR-0045. A generic request envelope, a typed outcome

**Status:** accepted; its `ApprovalRoute` half is **deleted by
[ADR-0051](0051-roles-are-a-scoped-set.md)** — the envelope and the typed outcome stand,
but routing collapsed to "the approvers of the subject's unit"

## Context

Absorbing the separate self-service portal (ADR-0051) means this product has to carry
things people ask for: remote days, an office desk, leave, eventually shift swaps and
comp-day placement. The requirement that shapes the design is that **an administrator can
define a new kind of request without a deployment**.

That pulls in two directions.

- A **type-specific entity per kind** — `RemoteWorkRequest`, `LeaveRequest`, … — means a
  schema change, a migration and a release for every new one. That is precisely what the
  requirement forbids.
- A **fully generic store** — everything in a JSON blob — breaks every engine.
  `CoverageCalculator`, `Validator` and `engine/cellValue.ts` all read typed rows. An
  approved leave request that lives as JSON is invisible to the roster.

There is also a subtler question: what does "approved" mean when the write can still fail?
An approval names dates that might, by the time it is granted, collide with something.

## Decision

**The envelope is generic. The outcome is typed.**

```
RequestType {                       // configuration, admin-editable
  id, code, label
  category      PRESENCE | LEAVE | SWAP | COMP_DAY | OTHER
  materializer  NONE | PRESENCE | ABSENCE
  presenceKind? / absenceType?      what an approval produces
  routeId, isActive, sortOrder
}

Request {
  id, typeId, subjectPersonId, unitId
  from, to                          hoisted out of the payload — see below
  payloadJson?                      type-specific detail
  note?, state, currentStep
  failureReason?, materializedEntityId?
  createdBy, createdAt, updatedAt?, decidedAt?, version
}
```

`from`/`to` are columns, not payload fields: the inbox filters on them and the capacity
check reads them, and neither should parse JSON to do it.

`materializer = NONE` is not a placeholder — it is how a request type gets used on real
traffic before it owns anything, which is how leave is meant to be introduced if the
positioning in ADR-0051 is ever revisited.

### `APPROVED` and `APPLIED` are separate states

```
DRAFT ──submit──▶ SUBMITTED ──approve(last step)──▶ APPROVED ──write──▶ APPLIED
   │                  │  │                                      │
   │                  │  └──reject──▶ REJECTED                  └─fail─▶ APPLY_FAILED
   └──cancel──▶ CANCELLED ◀── cancel (subject, any time before or after) ──┘
```

Approval is a decision a human made; application is a write that can fail. Collapsing them
would mean a rejected write silently un-approved a decision someone had already taken, and
neither party would learn that nothing happened. `APPLY_FAILED` keeps the approval, records
why, and notifies **both** the subject and the approver.

### Materialization is a direct write, not a planner draft

The draft exists so a planner can stage a batch of roster decisions and review them
together before they become real. An approved request has already been reviewed — by a
named human, with a recorded comment. Routing it into someone else's draft would add a
second review nobody asked for and leave approved leave invisible until that person
happened to publish.

`Requests/ApprovedRequestApplier` writes inside the caller's transaction, so a request can
never reach `APPLIED` without the row it claims to have created. It emits an audit entry
(ADR-0040), and the created entity carries `requestId` back to its origin.

### Withdrawing undoes it

Cancelling an `APPLIED` request removes the presence or absence it created. Leaving it
behind would show the roster something the person explicitly took back — and would move
the work to a planner, which is the opposite of self-service.

## Consequences

- Adding a request type is a row: code, label, which route, what it materializes into.
- The request payload is deliberately small and its parse failure is non-fatal
  (`RequestPayload.Read` returns empty rather than throwing). The fields the system acts
  on are columns; a corrupt detail must not stop an approved request from being recorded.
- `GET /api/requests?scope=mine|inbox` post-filters in memory. Inbox membership needs route
  resolution, which is not expressible in SQL, and at eighty people the table is small.
- The seeded set is four types: remote, office, annual leave, other leave. The first two
  are rota-local and have no owner outside this product; the second two exercise the path
  that writes an `Absence`.

## Alternatives considered

- **One entity per request kind.** A deployment per kind. Rejected by the requirement.
- **One entity, fully generic, no materialization** — approvals as a record only, with a
  planner transcribing the outcome into the roster by hand. That is the current process
  with a nicer form on top, and the transcription step is where things get lost.
- **Materialize through a system-owned draft** (open, append one change, publish
  immediately). Genuinely attractive: it reuses `DraftService.Publish`'s serializable
  transaction, conflict detection and comp-day generation for free. Rejected for presence
  because presence is not a draft target at all (ADR-0043), and for absence because it
  makes every approval carry a `DraftSession` row and the publish path's lock footprint,
  for a single-row write that has already been reviewed. Worth revisiting if approved
  requests ever need to move assignments, which is where the draft's guarantees start
  paying for themselves.
- **`APPROVED` only, applying eagerly and reverting on failure.** Loses the human decision
  on a technical fault, and gives the approver no way to see that their approval had no
  effect.
