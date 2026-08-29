# ADR-0046. Routing is not authorization; the role hierarchy is not extended

**Status:** its title still holds; its **role model is superseded by
[ADR-0051](0051-roles-are-a-scoped-set.md)**, which makes Approver a real role and deletes
the ordinal this ADR argued around. Its case against extending the *hierarchy* was right
about the hierarchy and wrong to keep it — see ADR-0051's Context.

Extends ADR-0032.

## Context

Self-service (ADR-0045) introduces two things that look like roles and are not:

- an **employee**, who writes their own requests and presence;
- an **approver**, who decides one specific request.

The existing model is a three-rung ordinal hierarchy — `Viewer < Planner < Admin` —
compared by `(int)` in `MinimumRoleAuthorizationHandler`. Its promise is that `>=` implies
"can do everything below".

It also has to be reconciled with ADR-0032, which deliberately deleted unit-scoped write
permissions from the model and made the audit trail the only control. Adding approval
routing must not smuggle that back in.

## Decision

### Routing is not authorization

> `ApprovalRoute` decides whose **inbox** a request lands in. The authorization policy
> decides who **may** act on it.

ADR-0032 removed the second and said nothing about the first. Routing is a workflow
concern; it does not deny anyone anything.

```
ApprovalRoute { id, label, fallbackPersonId?, steps[] }
ApprovalRouteStep { order, strategy: MANAGER | NAMED | UNIT_PLANNERS, mode: ANY | ALL, personIds[] }
```

`Person.managerId` is added as an **input** to the `MANAGER` strategy, not as the route
itself: one manager chain cannot express "leave goes to the line manager, a shift swap goes
to the unit's planners", and manager chains churn.

Two rules keep a request from stalling, which is the failure mode nobody notices — a
request sitting in `SUBMITTED` forever, appearing in no inbox:

1. **A step that resolves to nobody is skipped**, and routing moves to the next step. The
   seeded leave route is "line manager, then the unit's planners" precisely so somebody
   with no manager recorded still reaches a human. Skipping is a routing decision, not a
   permission one — the request goes to the *next* approver, not to nobody.
2. Only when no remaining step resolves does `fallbackPersonId` apply. A request that
   still resolves to nobody is **refused at creation** rather than accepted into limbo.

### The role hierarchy is not extended

`AppRole` stays `Viewer | Planner | Admin` and `MinimumRoleRequirement` is not modified.
Extending the ordinal was considered seriously and fails on the first real endpoint:

| Proposal | Breaks because |
|---|---|
| `Employee` below `Viewer` | An employee **writes**; a viewer cannot write anything. The order encodes a falsehood on the only axis it measures. |
| `Employee` above `Viewer` | An employee is not more privileged than a viewer for anything except their own row. |
| `Approver` between `Viewer` and `Planner` | A Planner is **not** automatically an approver for a route they are not on, so `role >= Approver` would grant rights the route explicitly withheld — breaking the hierarchy's core promise. |

Instead:

- **"Employee" is not a role.** Every authenticated person is an employee with respect to
  their own record. Self-service endpoints sit at `ViewerOrAbove` and check
  `subjectPersonId == principal.personId` (`Auth/SelfOrPlanner`).
- **"Approver" is not a role either.** It is the fact of being on the route for one
  request, computed per request by `RequestService.ApproversFor`.
- **Admin is break-glass.** An Admin can decide any request, because every decision is
  recorded with the decider's name — which is the control ADR-0032 relies on — and an
  unblockable approval queue is the worse failure mode.

### This does not reintroduce unit scoping

Nobody is denied access to another unit's *plan*. The only new denials concern another
person's own record and request, which ADR-0032 never spoke about.

## Consequences

- `MinimumRoleRequirement.cs` is untouched; `Auth/SelfOrPlanner.cs` sits beside it and
  reuses the same role comparison so the two can never diverge on what "Planner or above"
  means.
- Presence and request endpoints are all `ViewerOrAbove`. That reads permissive and is not:
  the resource check is where the decision happens.
- `PUT /api/presence/{id}` checks ownership against the **stored** subject as well as the
  requested one, so reassigning a record to someone else is not a way around it.
- `AuthProvider.roleAtLeast` on the client is unchanged. The client gains no fourth role,
  only the question "is this me".
- The decision to check request **state before approver-ness** is deliberate: a request
  already decided is not waiting on anyone, so an approver check would answer "not you" —
  true, useless, and hiding the actual reason.

## Alternatives considered

- **Extend the ordinal.** The table above.
- **A permission matrix.** Reverses ADR-0032 wholesale to solve a problem ADR-0032 was not
  about.
- **`Person.approverId` as the route.** One chain, one shape of approval. Cannot express
  per-type routing, and every reorganisation rewrites it.
- **Fail a request whose first step resolves to nobody.** Correct-looking and hostile: a
  person with no manager recorded — a data gap, not their fault — could raise nothing at
  all.
