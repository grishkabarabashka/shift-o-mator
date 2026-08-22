# ADR-0020. A planning unit and a region are orthogonal; access is unrestricted with audit

**Status:** accepted — **supersedes [ADR-0019](0019-service-transition-as-category.md)**,
amends [ADR-0003](0003-planning-unit-not-geography.md)

## Context

Three attempts at the same problem:

- **ADR-0003** made the planning unit the single boundary — rules, coverage, roles and
  planning all in one entity. Service Transition became a fourth unit. This breaks
  coverage: an ST engineer in Hartford works AMER hours against AMER requirements on
  the AMER handover, but sat outside the AMER region entirely.
- **ADR-0019** went the other way: Service Transition as an org category inside each
  region. Coverage becomes correct, but the manager who actually plans ST across all
  three regions loses their screen — the planning boundary disappears as a first-class
  concept, leaving only a filter bolted onto region grids.
- Neither worked because **the two boundaries are different boundaries** and both
  attempts insisted on one.

The owner also settled the access question directly: there is a manager who plans
cross-regionally, and giving every planner write access everywhere is not a problem.
The team is small, nobody edits another team's rota without reason, and the control
that is actually wanted is knowing who changed what.

## Decision

**Two orthogonal axes.**

```
Region        AMER | EMEA | APAC        which rules apply
PlanningUnit  AMER | EMEA | APAC        whose screen this person is on
              | Service Transition
```

- `Person.regionId` drives roles, day configurations, coverage contribution, comp-off
  policy and handovers.
- `Person.planningUnitId` drives which planner's screen they appear on.
- `PlanningUnit.kind` is `REGION` (a region's own roster) or `CROSS_REGION` (a team
  drawn from several regions). A `REGION` unit carries `regionId`.
- `PlanningUnit.groupBy` controls grid grouping: `LOCATION` by default for region
  units, `REGION` for cross-region units.

**A unit is a default filter, not a hard boundary.** Schedule defaults to the selected
unit's people and offers a toggle for the whole region, so a gap belonging to another
unit can be fixed without navigating away.

**Coverage is computed per region, never per unit.** An `ST Amer` gap shows on the AMER
coverage strip even though those people are planned in the Service Transition unit. The
requirement belongs to the region.

**Access has no regional scoping.** Three roles: Viewer reads; Planner drafts and
publishes anywhere; Admin adds configuration and force-publish. The control is a
complete append-only audit trail — actor, timestamp, previous value — on every
published change.

## Consequences

- The ST manager gets one screen with all ST people, and each region's planner gets a
  clean roster, without duplicating roles or requirements.
- Region-scope claims, cross-region permission checks and the custom authorization
  handler comparing a route's region against a planner's scope all disappear. This is a
  large, permanent simplification of the security model.
- `orgCategory` survives only as a reporting and grouping attribute plus the
  `MANAGEMENT` + `isIncluded = false` idiom. It is no longer how ST is modeled.
- A draft session is scoped to (editor, planning unit, period).
- Adding a unit — "Automation", "SRE" — is a data change.
- **Accepted risk:** unrestricted write access depends on the audit trail being complete
  and actually consulted. If the team grows past the point where social control works,
  scoping can be reintroduced on the `PlanningUnit` axis without touching the region
  model — which is the main reason for keeping the axes separate.

## Alternatives considered

- **One boundary** (ADR-0003) — breaks coverage for cross-region teams.
- **Category only** (ADR-0019) — loses the planning screen; leaves an open access
  question the owner has now answered.
- **Region-scoped write access with an exception for the ST manager.** Rejected by the
  owner as solving a problem the team does not have, at the cost of a permission matrix
  to maintain.
