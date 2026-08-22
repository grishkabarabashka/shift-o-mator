# ADR-0003. A planning unit is an organizational, not a geographic, boundary

**Status:** accepted — amended by
[ADR-0020](0020-planning-unit-and-region.md). The core claim holds: a region is a rule
boundary, and AMER includes Pune. What this ADR got wrong was collapsing *rules* and
*planning* into one entity. They are two orthogonal axes: a person has a region (which
rules apply) and a planning unit (whose screen). Service Transition is a cross-region
planning unit whose people keep their own regions.

## Context

In conversation, the team calls units "regions": AMER, EMEA, APAC. But Americas
includes Pune, and Service transition isn't a region at all: its people are scattered
across every location, and one planner plans all of them at once.

## Decision

In code, the entity is called `PlanningUnit` and is defined organizationally: a set of
roles, coverage rules, absence limits, a comp day policy, and a list of planners
allowed to edit it.

In the UI, the word "region" stays — it's familiar to users.

## Consequences

- Adding a fifth unit ("Automation", "ST Global") doesn't break the model or require
  a migration.
- Period locking is taken on a (unit, period) pair — see
  [ADR-0011](0011-checkout-instead-of-realtime.md).
- A person belongs to exactly one unit; cross-unit assignments aren't supported in the
  MVP.

## Alternatives considered

- **Unit equals geographic region.** Doesn't describe either Pune within AMER or
  service transition.
- **A hierarchy of units.** Overkill at four units and 80 people.
