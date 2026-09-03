# ADR-0051. Roles are a set, granted per planning unit

**Status:** accepted. Supersedes the role model in
[ADR-0046](0046-routing-is-not-authorization.md) and the "no unit scoping of write
access" rule in [ADR-0032](0032-planning-unit-single-rule-axis.md). Deletes
`ApprovalRoute` from [ADR-0045](0045-generic-request-envelope-typed-materialization.md).

## Context

`AppRole` was `Viewer | Planner | Admin`, and every policy compared it by ordinal:

```csharp
role >= requirement.MinimumRole
```

That one line encoded a claim nobody had made: that the roles form a privilege ladder
where each rung contains the one below it. The consequence was live. **An Admin could
assign shifts**, publish drafts and repaint a rota, purely because `Admin > Planner` in an
enum. Nobody granted that and nobody could withhold it.

The reverse was true too, and had been recorded as a design decision rather than an
accident: ADR-0046 argued at length that "approver" could not be a role, because it would
have to sit above Planner (granting rights no route had given) or below Viewer (which
writes nothing). Both horns of that dilemma are artefacts of the ordinal. Take the
ordering away and the objection evaporates.

Three further things the old model could not express, all of them ordinary:

- **Somebody who is both a planner and an approver.** Common, and the ladder had no rung
  for it.
- **A planner of one unit and nothing in another.** ADR-0032 removed unit scoping on the
  grounds that "a shift is global, the control is the audit trail". That reasoning holds
  for *planning*: a rota change is visible, reversible and attributed. It does not
  transfer to approving somebody's leave, which is neither reversible nor merely visible.
- **An administrator who is not a planner.** The most common real case, and the one the
  ordinal got exactly backwards.

Meanwhile `ApprovalRoute`/`ApprovalRouteStep` modelled ordered multi-step approval
(manager, then HR) that nobody had asked for, had no admin screen, and needed a
skip-forward rule so that a step resolving to nobody did not strand a request in
`Submitted` forever.

## Decision

### Roles are a set. Nothing is implied by ordering.

```
AppRole = Viewer | Planner | Approver | Admin
```

| Role | Owns |
|---|---|
| `Viewer` | Reads the rota. Self-service on their own row. **Everyone signed in.** |
| `Planner` | Shifts, markers, comp days, painting, publishing — the rota |
| `Approver` | Decides requests raised by people in the unit |
| `Admin` | Configuration. **Explicitly cannot assign shifts.** |

Holding two roles grants both, and only both. `MinimumRoleRequirement`'s `>=` comparison
is deleted; `Capabilities` is the single place that answers "may this caller do X, here",
and it asks whether the role is *held*.

`Viewer` is not stored. A row per person saying "may read the rota" is a row that can only
ever be wrong.

### Grants are scoped to a planning unit, or global

```
RoleAssignment { id, personId, unitId?, role, grantedBy, grantedAt }
```

`unitId` null is a **global** grant, satisfying every unit-scoped check for that role. It
widens *scope*, never *privilege*: a global Admin is an admin everywhere, and still not a
planner anywhere.

It exists for two real cases — configuration that belongs to no unit (locations, holidays,
the units themselves, event and request types), and the cross-unit planner who covers for
everybody.

`grantedBy`/`grantedAt` are on the row because the grant is itself an auditable act, and
"who made them an approver" is the first question after a bad approval. It also writes a
`ChangeHistoryEntry` (ADR-0040).

### This narrows ADR-0032, and only for approvals

ADR-0032's argument — the audit trail is the control, not a boundary — still stands for
planning, and a **global** Planner grant remains available for exactly that. What changes
is that the default is now a unit, and approving is scoped for a reason the original ADR
did not consider: an approval is a decision about a person's time, not an entry in a rota
that anyone can reverse tomorrow.

### The grants live in the database, not the token

Roles are scoped to planning units, and no identity provider knows what `unit-emea` is or
has any reason to learn. `RoleClaimsTransformation` reads `RoleAssignment` on each
authenticated request and projects one claim per grant (`sfm:role` = `role|unitId`). The
token establishes *who you are*; what you may do is data an admin edits on a Settings
screen, taking effect on the next request rather than the next token refresh.

Endpoint policies can only check "holds this role **somewhere**", because a policy runs
before the body is read and cannot know which unit is being written to. That is a cheap
gate; the decision is the unit-scoped check in the handler, where the unit is known.

### Approvers replace approval routes

`ApprovalRoute`, `ApprovalRouteStep`, `ApprovalStrategy` and `ApprovalMode` are deleted,
along with `Request.CurrentStep` and `ApprovalDecision.Step`. Whose inbox a request lands
in has one answer: the people holding `Approver` in the subject's unit. The first decision
settles it — with a single list of equal approvers there is nothing for a second to add.

The one property worth keeping from the route table is kept: **a request must never
resolve to nobody**, because an empty inbox is the failure nobody notices. Where a unit has
no approver configured it falls through to the admins, the people who can fix the cause.
`RequestService.IsUnrouted` reports that the fallback was taken, so a misconfigured unit is
visible rather than merely slow.

ADR-0046's title still holds and is now trivially true: routing is not authorization,
because they are computed by the same function and therefore cannot disagree.

### Approval is a property of the thing, not of who asks

A planner recording leave on somebody else's row **raises a request**, like anybody else.
`EventType.RequiresApproval` and the remote presence kind decide; the asker's role does
not. A planner owns the rota, not other people's time off.

This reverses an earlier reading in which `canEditPlan` bypassed approval. That was the
approval step quietly not happening.

The write-access question is separate and still role-based: `CanWriteRecordOf` says a
planner of your unit may act *on* your row. What they may do there is decided by the thing.

### Being in a planning unit is what puts you on the grid

Everyone is in the People list. `Person.UnitId` decides whether a row is drawn — including
managers, who appear with different settings rather than not appearing. `EventType.RouteId`
is gone, and so is `PlanningUnit.ApproverPersonIds`: two places naming approvers would have
disagreed the first time one was edited.

## Consequences

- `MeResponse.Role` becomes `MeResponse.Roles: RoleGrant[]`. The client's
  `useCapabilities()` takes a unit on every question, because "can I plan" has no answer
  on its own.
- The dev identity switcher becomes a set of toggles rather than a dropdown. Nothing
  selected means "use their real grants", which is the realistic path and the default.
- Settings grows a **Roles** tab: a matrix of people against roles, filtered by unit.
  Read-only for somebody who does not administer that unit, because "who approves my
  leave" is a fair question for the person waiting on the answer.
- Granting is itself scoped: a unit's admin manages that unit's grants, and only a global
  admin can make a global grant. Without that rule any unit admin could promote themselves
  out of their unit. Revoking the last global admin is refused, since nothing else could
  grant it back.
- The seed grants every manager Planner, Approver and Admin **in their own unit**, plus one
  global Admin. A starting point an admin narrows, not a claim about how the team is really
  organised.
- Multi-step approval is gone. If a leave type ever genuinely needs manager-then-HR it comes
  back as a new ADR and a route table with an admin screen, not as the untested, unreachable
  one that was there.

## Alternatives considered

- **Keep the ordinal, add Approver to it.** ADR-0046 talked itself out of this correctly:
  there is no rung that works. The mistake was accepting the ladder rather than the rung.
- **Global roles, approvers listed on the unit.** Simpler, and the shape already half-built.
  Rejected because it splits one concept across two places: the list on the unit and the
  role would both have to be edited, and the first edit that touched only one would be a
  silent bug.
- **Roles as claims in the token.** Correct for a product whose scopes an IdP understands.
  Planning units are ours, and a role change that needs a token refresh to take effect is a
  role change people work around.
- **Keep routes and gate them with the new role.** Two mechanisms that must agree about who
  is looking at a request, when one of them is enough. The route table was answering a
  question nobody had asked.
