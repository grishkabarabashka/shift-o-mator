# ADR-0047. Absorb the self-service portal

**Status:** accepted

## Context

A separate corporate portal did what this product did not: employees recorded their own
leave, recorded whether they were working remotely or from an office (and which one), and
requests routed to designated approvers through configurable event types.

`Docs/00-overview.md` listed *"replacing the corporate leave system"* as out of scope, and
`Docs/11-integrations.md` recorded the consequence: absences arrive by **paste** — a
hand-made export, retyped into an import wizard. `Docs/00` names this as one of the things
wrong with the spreadsheet ("Vacations live in another system with no API, retyped by
hand. Double entry."), and then scopes out fixing it.

Three positions were considered.

| | Absorb | Integrate | Federate / defer |
|---|---|---|---|
| Model | requests, approvals, presence, event types live here | presence + leave are read-models synced from the portal | schema now, external writes for the first release |
| Effort | ~3 phases | ~1 phase | ~1.5 phases |
| Operational cost | this product owns entitlement, statutory minima across 8 locations, DPIA and retention for sick-leave data | sync freshness, identity reconciliation on `employeeId` | none |
| SPOF | app down ⇒ nobody can book leave | portal down ⇒ presence goes stale, planning still works | none |
| Reversal | effectively one-way | cheap in both directions | free |

The recommendation from analysis was to split at the *entitlement* line: keep anything
with a statutory or balance character upstream, absorb only what is rota-local. The owner
chose **absorb** outright.

## Decision

**shift-o-mator becomes the system of record for self-service.** Concretely, in this
phase:

- **Presence** — remote / office-X / travel / customer-site, as a first-class entity
  (ADR-0043). This has no owner outside the product today; it was spreadsheet-and-Teams
  work.
- **Requests and approvals** — a generic envelope with typed outcomes and configurable
  approval routes (ADR-0045, ADR-0046).
- **Leave** — an approved leave request writes an `Absence` directly. The paste-import
  path (`Docs/11`) stays for historical data and for anything still originating upstream,
  but it is no longer the only way leave arrives.
- **Notifications** — an in-app inbox (ADR-0044), because an approval queue nobody is told
  about is worse than the message it replaces.

`Docs/00-overview.md`'s scope statement changes accordingly: *"replacing the corporate
leave system"* moves out of "out of scope".

## Consequences

The costs are real and are accepted rather than dismissed:

- **Availability becomes a people problem.** If the app is down, nobody can book leave.
  Previously an outage only stopped planning.
- **Sick-leave data is GDPR Article 9 special-category data.** `AbsenceType.Sick` now
  originates here rather than passing through, which brings retention, subject-access and
  a DPIA into scope. This is an operational obligation, not a code change, and it is the
  single largest thing this decision buys.
- **Entitlement is deliberately not modelled.** There is no `LeaveBalance` and no
  `Entitlement` entity. The product records that leave was requested and approved; it does
  not compute how many days someone has left, and must not be asked to. Statutory minima
  across US/UK/CH/SG/IN are a different product.

  > **The trigger to stop:** if a leave-*balance* question ever needs answering inside
  > this app, do not extend the model — integrate or buy. That is the boundary this
  > decision does not cross.

- **Migration is a dual-run.** Leave history and any in-flight requests come across from
  the portal before it is retired; a leave year should overlap.
- ADR-0010's absence-capacity check finally becomes real. It says the simultaneous-absence
  limit *"runs not at shift-planning time but earlier — when a vacation is approved"*.
  There was no approval, so it had never run there. There is one now.

## Alternatives considered

- **Integrate.** Cheapest and reversible; keeps the double entry that `Docs/00` names as a
  founding complaint, and depends on a portal that exposes no API.
- **Federate.** Models the concepts without owning the writes. A reasonable staging post,
  and the owner's decision made it an unnecessary one.
- **Split at the entitlement line** — absorb presence and rota-local asks, leave leave
  upstream. The analysis recommendation, and still the fallback if the DPIA obligation
  proves unacceptable: the schema supports it unchanged, by setting the leave request
  types' `materializer` to `NONE`.
