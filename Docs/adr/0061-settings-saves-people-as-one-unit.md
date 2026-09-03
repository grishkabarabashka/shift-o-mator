# ADR-0061. Settings saves people as one unit

**Status:** accepted. Narrows nothing; adds a write path beside the single-row
`/api/admin/*` endpoints, which stay exactly as they are. Extends
[ADR-0040](0040-one-change-history-for-every-entity.md) by giving person edits the history row it
already required them to have.

## Context

Settings saves a screenful of edits by sending **one HTTP request per changed row**, in
the order the fields happened to be edited (`useAdminEdits.saveAll` walks a `Map`). On a
per-field rejection it records the error and **carries on** with the remaining rows.

For most admin resources that is fine, and deliberately so: one location cannot invalidate
another, so a partial save is an inconvenience you fix by pressing Save again.

**People are not like that.** `Person.Email` and `Person.EmployeeId` carry filtered unique
indexes. `Email` in particular is what an Entra ID sign-in resolves a person by
(ADR-0058) — it is a credential in everything but name. So moving an address from one
person to another is not two independent edits; it is a **release** and a **claim** that
are only valid together.

Sent one at a time, that sequence loses the address outright:

1. The claim goes first (whatever order the fields were typed in). The unique index rejects
   it — the address is still held. A field error is recorded and the loop continues.
2. The release goes second. It is valid on its own, and commits.

The address is now on nobody, and the person it belonged to **can no longer sign in**. This
was observed, not theorised: an administrator moving their own sign-in link between two
people locked themselves out of the product, and the only way back was an `UPDATE`
statement against the database.

Two further things made it worse than it needed to be. The client mapper silently dropped
`email` on the way in, so Settings showed the column blank and `personAdminToWire` then
sent `email: null` for every person saved — meaning an unrelated edit to any row *also*
cleared its link. And `PeopleAdminEndpoints` wrote no `ChangeHistoryEntry` at all, so
"who cleared this, and when" had no answer anywhere, despite ADR-0040 naming person edits
explicitly.

## Decision

**`POST /api/admin/people/batch` applies every pending person edit, or none of them.**

**1. Atomicity and ordering are separate problems, and both are solved here.** A
transaction alone is not enough: SQL Server checks a unique index per *statement*, not at
commit, so "claim" before "release" is rejected inside a transaction exactly as it is
outside one. The endpoint therefore does both:

- **Order** — ops that *release* a unique value (a delete, or an update that blanks `Email`
  or `EmployeeId` relative to the row's current value) are applied first. Each op validates
  against the state its predecessors left, so the claim sees the address already free.
- **Atomicity** — everything runs in one `BeginTransactionAsync`. Any rejection rolls the
  whole batch back, including ops that were individually valid.

Errors come back keyed by the op's **index in the request the caller sent**, not by the
order the server applied them in, and not as one flat object: with several rows in flight,
"email is taken" that does not say which row is an error the client cannot put beside a
field.

**2. The single-row endpoints stay.** They are the right shape for one edit, they are what
the OpenAPI document documents, and deleting them to force everything through a batch would
be churn. The batch is not a replacement; it is what Settings uses because Settings edits
several rows at once.

**3. Only people get this, for now.** The batch path is optional on `EntityOps`
(`saveBatch?`), and an entity without it keeps the row-at-a-time loop. That is not laziness
about the others — it is the criterion: **an entity needs a batch when its rows can
invalidate each other.** People can, through two unique indexes. Locations, shifts, day
configurations and the rest cannot; a partial save there costs a second press of Save and
no data.

**4. Person edits write history.** `RecordConfiguration` on every create, update and
delete, inside the same transaction, as ADR-0040 required all along.

## Consequences

- Moving a sign-in address between two people works in one save, in either order, and can
  no longer end with the address on nobody.
- A rejected batch leaves **every** row dirty, including rows that would have been accepted
  on their own. That is the contract and the UI must not soften it: telling somebody half
  their changes saved, when nothing did, is the failure this ADR exists to remove.
- The audit trail finally covers person edits. It does **not** yet cover locations, units,
  shifts, day configurations, holidays or absence capacity rules — those admin endpoints
  still write no history, which remains a live gap against ADR-0040.
- One more endpoint to keep in step with `AdminPersonRequest`. The validation is shared
  (`ValidateAsync`), so the risk is in the mapping, not the rules.

## Alternatives

- **Order the writes client-side, keep one request per row.** Rejected, and it was the
  first thing tried. Ordering makes the *success* path work and makes the *failure* path
  worse: with releases first, a failed claim now leaves the address released and there is
  no transaction to undo it. Without a rollback there is no safe order.
- **Stop the loop at the first rejection.** Safe only in combination with putting
  destructive ops last, and then the move becomes impossible in one save — the user has to
  clear, save, set, save, and understand why. Correct, and a worse product.
- **One generic `POST /api/admin/changes` across every entity.** The shape the client
  already models, and where this goes if a second entity ever needs it. Rejected for now on
  cost: thirteen endpoint files with their validation inline in lambdas, a polymorphic
  contract that generates poorly into `schema.d.ts`, and one route that can write
  everything. The person batch is a strict subset of it — the same applier would be reused
  — so nothing here is wasted if that day comes.
- **Defer the unique check to the database and translate the exception.** Would turn the
  crash into a field error but not make the pair atomic, and it trades a readable validation
  path for parsing constraint names out of a driver exception.
