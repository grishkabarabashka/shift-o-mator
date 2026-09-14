# ADR-0069. Acting as somebody else, with both names in the trail

**Status:** accepted. Extends [ADR-0039](0039-actor-identity-from-the-token.md) — the actor
is still never taken from a request body, and is now earned rather than merely asserted.
Scoped by the role model in [ADR-0051](0051-roles-are-a-scoped-set.md). Uses the
notification machinery of [ADR-0044](0044-in-app-inbox-first.md) /
[ADR-0064](0064-a-notification-policy-and-a-log.md) and extends the audit row of
[ADR-0040](0040-one-change-history-for-every-entity.md) by one column.

## Context

"It works on my screen" is most of the support load on a product with four planning units
and ~80 people, each of whom sees a different subset of six screens. The questions that
actually arrive — *why is there no Approve button on my Requests page*, *why does my
calendar not offer that comp day*, *why can I not record remote on Thursday* — are answered
by being where that person is. An administrator cannot get there, so the answer is a
screenshot request and three round trips.

The product already had something that looked like the fix and was not: the `dev` pill in
the header, which sets `X-Debug-PersonId`. It is gated on `Auth:Mode=Stub` and reads headers
that exist only in `StubAuthenticationHandler`, so it is unreachable in every deployed
environment — which is correct (`Docs/00-overview.md`: "any in-app role switcher is a
development convenience and must not ship") and also why it helps nobody in production.

The hard part is not the header. ADR-0032 removed unit-scoped write permissions on the
explicit grounds that *the audit trail is the control*, and ADR-0039 then made the actor
come from the token so that trail could not be forged by the people it constrains. Anything
that lets one person act as another has to answer to that.

A first cut made the lens **read-only**: the subject's screen, the administrator's
authorization, every self-service write refused. It survived one day of use. The refusals
land exactly where the questions are — *try booking that day and see what it says* is the
whole diagnostic, and "stop impersonating first" is a worse answer than the one the person
already had. A lens that can only show that the button exists is not worth the banner.

## Decision

**Acting as somebody makes them the actor.** Their roles, their rows, their writes.

- The subject travels as `X-Impersonate-PersonId`, honoured in **every** auth mode — this is
  a product feature with a server-side permission check, not the `X-Debug-*` pair.
- `RoleClaimsTransformation` resolves it once per request and stamps the subject as a claim,
  after which `ActorResolver.RequireAsync` answers with it and every endpoint in the product
  follows without knowing anything about lenses. A claim, not a scoped service: that class
  runs inside a scope it creates for itself, so anything scoped written there is a different
  instance from the one an endpoint resolves. The principal is the one thing that flows.
- **ADR-0039 still holds.** What it forbids is an actor taken from a request *body*, which
  anybody could write. This one is stamped only after a permission check against grants the
  caller actually holds — no more caller-supplied than the token is.
- **The grants are replaced, never merged.** The baseline Viewer and any debug override are
  removed from the identity before the subject's are added. A union would make the caller
  more powerful than either person, which is the one outcome a lens must never produce.
- **`ChangeHistoryEntry.ImpersonatedById`** carries the administrator on every row written
  while a lens is open. Both names, or the design does not hold: the change has to *be* the
  subject's for the engines to read it correctly, and the trail has to name who was really
  at the keyboard for ADR-0032's claim to survive.
- **One interceptor stamps it**, not thirty call sites. `ImpersonationAuditInterceptor`
  hangs off `SaveChanges`, so `ChangeAudit`, `DraftService.Publish` and anything added later
  are covered without knowing it. A forgotten call site would not fail anything — it would
  quietly write the one row with the hole in it.
- **Who may:** `Admin` over the subject's unit, **and** no global grant the subject holds
  that the caller lacks. The first condition is the ordinary scope rule: an administrator of
  a unit can already grant themselves any role in it on Settings → Roles, so acting as
  somebody in that unit hands them nothing they could not take in one click. The second
  exists because that argument stops at the unit boundary — without it, a unit Admin acts as
  whoever holds the global Admin grant (who may well sit in their own unit) and comes out
  administering everything.
- **Opening one is a POST**, not just a header the client starts sending. The permission
  check would happen either way; the *record* would not. `POST /api/auth/impersonate` writes
  the history row and notifies the subject. Per request it would write eighty rows a minute;
  never, and the feature is unaccountable.
- **A header the caller may not use is a 403, never a silent fall-back.** The client sends it
  on every request; dropping it quietly would show an administrator their own calendar, own
  inbox and own balances under somebody else's name, with nothing on screen wrong.
- **One exception, and it is not a write.** The calendar feed address is refused under a
  lens, read and reset alike. The token in that URL is the entire authentication on the only
  anonymous route in the product, it outlives the session, and the subject has no way to see
  a copy was taken. Handing over a standing credential is a different kind of act from
  making a change.
- **The header keeps showing the signed-in name**, with "acting as …" beneath it and the
  subject's initials in `--warn`. The rest of the product becomes the subject, which is
  exactly why this corner must not: it is the one place still answering "who am I", and an
  administrator three screens deep with only somebody else's name in view has no anchor.

## Consequences

**The escalation is bounded by argument, not by hope.** Inside their own unit an
administrator gains nothing they could not grant themselves; outside it, and over a global
grant, the lens is refused. Those two rules are the whole security story, and both are
tested.

**Two things stopped being free.** `RoleClaimsTransformation` no longer returns early on the
stub role override: a lens has to resolve under one, and the test factory pins
`Auth:StubRole` on every request it makes, so the early return made this untestable and
would have made it silently inert in any deployment that had ever set that setting.

And the interceptor had to be wired **explicitly**. EF resolves `IEnumerable<IInterceptor>`
from the application container, so registering under `ISaveChangesInterceptor` — the obvious
interface — finds nothing, runs nothing, and fails nothing: the rows are simply written
without the stamp. `AddInfrastructure` now asks for both.

**The schema moved.** One nullable column, and because `InitialCreate` is regenerated rather
than appended to (CLAUDE.md), every existing database — the dev one and all twelve test ones
— had to be dropped. The dev database comes back through the setup wizard.

**A trap, paid for once.** The audit row for opening a lens is written with
`RecordConfiguration`, not `RecordPerson`. The latter stamps `PersonId`, which is what the
**cell** history filters on, and a row with no affected dates matches every day — so one
lens put "started acting as" onto every cell of that person's year.

## Alternatives

**Read-only.** What was built first, and reverted. See Context: the refusals land exactly
where the diagnostic is.

**Writes as the administrator, screen as the subject.** Considered and briefly specified.
It splits the two halves of an identity in a way nothing else in the product does: the
screen offers what the subject can do, the server authorizes what the administrator can do,
and every disagreement between them is a 403 on a button that was rendered. Worse, a
self-referential write — *withdraw my request*, *mark my inbox read* — silently acts on the
administrator's own rows.

**Intersect the grants: the subject's, minus anything the caller lacks.** Safe, and closes
the escalation without the global-grant rule. Rejected because it reintroduces the problem
read-only had, one level down: an Admin who is not a Planner acting as a Planner gets the
Planner's screen with the planning removed, which is the state that prompted the complaint.

**Filter the person list to the caller's scope.** The client does not do this. The server
owns the check and would have to be asked anyway, and a list that quietly omits names reads
as a missing roster rather than as a permission — a refusal that names the reason is the
better failure.
