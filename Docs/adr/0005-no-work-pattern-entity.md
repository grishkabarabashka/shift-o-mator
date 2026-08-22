# ADR-0005. There is no separate "work pattern" entity

**Status:** accepted, with fields named

> **Clarification.** The real roster does carry a default pattern, but as **person
> fields**, not a separate entity: `defaultRoleId` (the ordinary-day default, the
> workbook's "Default Entry") and `availableWeekdays` (its "Default Week"). Only
> auto-populate reads them, and they never override an explicit assignment — so the
> decision below stands, with the fields made explicit.
>
> **Narrowed by [ADR-0038](0038-day-configuration-owns-the-default-shift.md):**
> `defaultShiftId` is no longer how an ordinary day gets filled. Engineers do not have a
> default shift — they have shifts they cannot do — so the bulk shift is now declared by
> the *day configuration*, and the person field survives only for genuine exceptions such
> as Service Transition. `availableWeekdays` is unaffected.
>
> The `isPlannerOnly` flag mentioned below is replaced by
> `orgCategory = MANAGEMENT` plus `isIncluded = false`
> ([ADR-0019](0019-service-transition-as-category.md)).

## Context

Shift-planning systems usually have an entity like "work schedule" or "weekly
template" tied to a person. That creates a second source of truth: the pattern says
one thing, the assignments say another, and now there's a question of which one wins.

## Decision

A person's participation in the rotation is determined entirely by two things: the
set of available roles (`eligibility`) and available weekdays
(`availableWeekdays`).

- a service transition engineer: a single available role, `ST_EMEA`, weekdays
  Mon–Fri. They physically cannot land in the support rotation;
- a manager: an empty role set plus `isPlannerOnly` — never appears in the grid;
- a regular engineer: several roles with target shares.

## Consequences

- Zero discrepancy between "how it should be per the pattern" and "how it's actually
  assigned."
- The generator works against a single source of constraints.
- Repeating layouts ("this week like the last one") are achieved by copying a range in
  the grid, not by a separate entity.
- If real rotation templates are needed later, they'll be added as an assignment
  source (`Assignment.source = PATTERN`), not as a parallel model.

## Alternatives considered

- **A `WorkPattern` entity with its own schedule.** A second source of truth and
  constant priority questions.
