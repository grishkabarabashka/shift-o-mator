# ADR-0032. PlanningUnit is the single rule axis

**Status:** accepted — **supersedes [ADR-0004](0004-roles-belong-to-unit.md) and [ADR-0020](0020-planning-unit-and-region.md)**.
Its "no unit scoping of write access" rule is **narrowed by
[ADR-0051](0051-roles-are-a-scoped-set.md)**: roles are granted per unit, with a global
grant available for the cross-unit planner this rule was written for.

## Context

Phase 8 merged two separate concepts in the model: Region (which rules apply) and Planning Unit (whose screen a person appears on). An examination of production seed data revealed a real structural defect: **65 of 76 people had a 1:1 mapping between Region and PlanningUnit**. The only true second axis was Service Transition, a cross-region team — and that is now a first-class unit like any other.

At the same time, splitting rules between Region and PlanningUnit created operational friction: a service-transition engineer in Hartford was in Region AMER (which rules apply? AMER rules, okay) and Planning Unit ST (whose screen? ST's screen, okay) — but which entity owns the day configurations, the comp-off policy, the absence limits? Both? The model said Region, but the first-class status of ST was pushing toward PlanningUnit.

The two entities, separately, were redundant. Together, they created ambiguity.

## Decision

**Delete Region entirely.** PlanningUnit becomes the single axis answering both questions: which rules apply and whose screen. The model simplifies:

```
PlanningUnit {
  id, name
  kind                    REGION | CROSS_REGION
  primaryLocationId       whose calendar decides holiday-ness
  locationIds[]           many-to-many — Pune hosts AMER/EMEA/APAC at once
  groupBy                 LOCATION | REGION | ORG_CATEGORY
  shifts[]                code, label, time window
  dayConfigurations[]     grouping of days with shift requirements
  absenceCapacityRules[]  simultaneous-absence limits
  compOffPolicy           placement window
}

Person {
  unitId                  the single rule axis
  locationId              calendar and display timezone
}
```

Service Transition becomes `unit-st` — not a cross-region team with an exception, just another unit. AMER, EMEA, APAC remain as `unit-amer`, `unit-emea`, `unit-apac`.

All shift definitions (e.g., "Pune EMEA shift 13:00–21:30 IST") are captured as default shift assignments stored in Person — the pattern is now: person → default shift, person → unit → shifts.

## Consequences

- Coverage rules, shift definitions, day configurations, and comp-off policy — once split between Region and PlanningUnit — now all live in one entity and resolve consistently per unit.
- A unit can be added (e.g., "Automation", "SRE") as a data-only change without code changes to the authorization or coverage model.
- Service Transition is no longer a special case. The ST manager's screen shows `unit-st` people, just as the AMER manager's shows `unit-amer` people.
- `Person.regionId` is deleted. `Person.unitId` is the sole rule axis, narrowing the potential for disagreement (e.g., "which day configuration version applies today?" — now unambiguous).
- The claim that "a unit is a default filter, not a hard boundary" ([ADR-0020](0020-planning-unit-and-region.md)) still holds: the Schedule screen offers a toggle to view the whole unit plus related shifts; coverage is computed directly per unit.
- Access control simplifies: no "is this action regional" question — everything is per-unit. No region-scope claims to check.
- Handover between units stays exactly what it already was: not a stored entity, but the intersection of two units' shift windows, computed on the fly by the timeline engine (`engine/timeline.ts`) — storing it separately would let it drift from reality on the first DST transition. Phase 8 does not change this; it only means the "unit" on either side of a handover is now the single rule axis rather than one of two entities that used to disagree about which one owned it.

## Alternatives considered

- **Keep both axes but make Region the source of truth and PlanningUnit a view filter.** Keeps the redundancy and the question of which entity owns what. The 65:1 skew shows this was never a real second axis.
- **Keep both axes and make PlanningUnit the source of truth, with Region as a grouping for reporting.** Inverts the current model and solves the immediate problem but does not explain why Region is needed at all.
- **Rename Region to Unit and make PlanningUnit disappear.** Naming is less important than the structural clarity; this is equivalent to the decision, just with earlier terminology. The naming choice reflects that the retained entity is a unit of planning and roster management, not a geographic concept.
