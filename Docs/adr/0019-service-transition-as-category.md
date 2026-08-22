# ADR-0019. Service Transition is an org category, with a cross-region view

**Status:** ~~accepted~~ — **superseded by
[ADR-0020](0020-planning-unit-and-region.md)**

> Modeling ST as a category kept coverage correct but discarded the planning boundary
> as a first-class concept, leaving the cross-region ST manager with a filter instead
> of a screen. ADR-0020 keeps both by separating region and planning unit into two
> orthogonal axes. The reasoning below about why a *separate region* is wrong still
> holds and is carried forward. Retained for the record.

## Context

[ADR-0003](0003-planning-unit-not-geography.md) made Service Transition a fourth
planning unit alongside AMER, EMEA and APAC, on the reasoning that one person plans ST
across all regions, so the planning boundary should match the access boundary.

The real implementation does something different: ST staff belong to their region and
appear inside that region's grid as one of three org-category groups — Support, Service
Transition, Management. ST roles belong to the region too: `ST Amer` is an AMER role,
and `ST` is an AMER weekend role.

Both readings are defensible, and they optimize for different things. Region membership
is right for coverage — an ST person in Hartford works AMER hours, against AMER
requirements, on the AMER handover. A separate unit is right for the planner, who wants
one screen with all ST people regardless of region.

## Decision

Model ST as a **category**, and solve the planner's problem with a **view**.

- `Person.orgCategory: SUPPORT | SERVICE_TRANSITION | MANAGEMENT`.
- ST people belong to their region. ST roles are region roles and appear in that
  region's day configurations.
- Region grids group by category: `SUPPORT`, `SERVICE TRANSITION`, `MANAGEMENT`, each
  with an uppercase full-width header and a person count.
- A **cross-region Service Transition view** filters to `orgCategory =
  SERVICE_TRANSITION` across all regions and groups by region. It is a filter over the
  same grid, not a second screen.

## Consequences

- Coverage stays correct without special cases: an ST person counts toward their
  region's requirements, in their region's timezone.
- Management is expressible: `orgCategory = MANAGEMENT` plus `isIncluded = false` keeps
  managers out of the planning rows while leaving them in the roster. This replaces the
  earlier ad-hoc `isPlannerOnly` flag.
- The ST planner gets one screen, as they would have with a separate unit.
- **Open cost:** editing across regions from that view requires either Admin access or a
  cross-region planner scope. Which one is an access-model decision that is still open —
  see [14-open-questions.md](../14-open-questions.md), item 7.
- Adding a fourth category later is a data change, not a migration.

## Alternatives considered

- **A separate ST planning unit** (the original decision). Requires ST roles to be
  duplicated per region anyway (`ST_AMER`, `ST_EMEA`, `ST_APAC`), and either duplicates
  regional coverage requirements or leaves ST people outside the coverage they actually
  contribute to.
- **Category only, with no cross-region view.** Correct data model, but the person who
  plans ST would have to visit three regions to do one job.
