# Architecture Decision Records

All decisions that constrain the design or reject a plausible alternative are
recorded here. An ADR is not a design document; it answers "why did we do this and
not something else?"

## Active decisions

| # | Title | Status |
|---|---|---|
| [0001](0001-role-carries-time.md) | A role carries its own time in the role's fixed timezone | accepted |
| [0002](0002-location-is-calendar-only.md) | A location is responsible only for calendar and display timezone | accepted |
| [0003](0003-planning-unit-not-geography.md) | Planning unit is not geography; a unit is a default filter | accepted |
| [0004](0004-roles-belong-to-unit.md) | Roles belong to a region (later: planning unit and region are orthogonal) | accepted |
| [0005](0005-no-work-pattern-entity.md) | No work-pattern entity; defaultRoleId and availableWeekdays are person fields | accepted |
| [0006](0006-eligibility-target-shares.md) | Eligibility holds target shares; candidate ordering is eligibility → availability → 90-day fairness → recency | accepted |
| [0007](0007-comp-day-as-balance.md) | A comp day is an accrual with a balance placed by a search window, not a fixed offset | accepted |
| [0008](0008-events-are-dated-coverage-rules.md) | Events (DR test, training) are dated day configurations, not absences | accepted |
| [0009](0009-three-severity-levels.md) | Three validation levels: BLOCKING, WARNING, INFO; soft rules never block | accepted |
| [0010](0010-absence-limits-by-role-pool.md) | Absence limits apply per region and per role pool | accepted |
| [0012](0012-schedule-repository-boundary.md) | ScheduleRepository is the single data boundary; every method async from day one | accepted |
| [0013](0013-headless-ui-layer.md) | Headless UI (Radix) so the shell can be swapped for a corporate component library | accepted |
| [0014](0014-own-grid-and-timeline.md) | Grid and timeline are hand-built, not AG Grid or Gantt charts | accepted |
| [0015](0015-optimistic-drafts-and-publication.md) | Optimistic drafts and atomic publication (supersedes 0011) | accepted |
| [0016](0016-day-configuration-groups.md) | Day configurations carry role sets, not just minimums; events are dated configs | accepted |
| [0017](0017-absence-range-cell-projection.md) | Absence is a range; the grid cell is a projection; training is not an absence | accepted |
| [0018](0018-shift-distinct-from-role.md) | Shift is distinct from role; a person's contracted window ≠ a role's time window | accepted |
| [0020](0020-planning-unit-and-region.md) | Region and planning unit are orthogonal axes; no regional scoping of write access | accepted |
| [0021](0021-effective-dated-configuration.md) | Configuration is effective-dated; raising a minimum today must not break past dates | accepted |
| [0022](0022-tailwind-for-tokens-and-layout.md) | Tailwind v4 for tokens and layout; check new class names against utility namespace | accepted |
| [0023](0023-editing-arms-itself.md) | Any edit opens the draft; there is no Edit mode to enter (refines 0015) | accepted |
| [0024](0024-conflicts-do-not-block.md) | A conflict is acknowledged, not blocked; gaps and corrupt data block publication (amends 0009) | accepted |
| [0025](0025-overview-replaces-dashboard-and-timeline.md) | Dashboard and Timeline merge into Overview; `/dashboard` and `/timeline` redirect | accepted |
| [0026](0026-suggest-and-auto-populate.md) | Suggest and auto-populate share a candidate ranker; suggests one, generates zero or more | accepted |
| [0027](0027-overview-reuses-day-detail.md) | Overview reuses the day drill-down timeline for consistency | accepted |
| [0028](0028-absence-import.md) | Absence import: one pure engine module, one diff engine, one batch | accepted |
| [0029](0029-http-cutover-and-server-persistence.md) | HTTP cutover: published and draft data move to the server | accepted |
| [0030](0030-domain-logic-server-single-implementation.md) | Domain logic lives on the server as the single implementation | accepted |
| [0031](0031-stubbed-real-auth-scaffold.md) | Stubbed-but-real auth scaffold: bearer token, role claims, no region scoping | accepted |

## Superseded decisions (archive)

These decisions were replaced by later ones. They are retained for the historical
record — the reasoning in the Alternatives section often influenced the replacement
decision.

| # | Title | Superseded by |
|---|---|---|
| [0011](0011-checkout-instead-of-realtime.md) | Period locking via check-out | 0015 (optimistic drafts) |
| [0019](0019-service-transition-as-category.md) | Service Transition as category with cross-region view | 0020 (planning unit and region axes) |
