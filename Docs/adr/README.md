# Architecture Decision Records

All decisions that constrain the design or reject a plausible alternative are
recorded here. An ADR is not a design document; it answers "why did we do this and
not something else?"

## Active decisions

| # | Title | Status |
|---|---|---|
| [0002](0002-location-is-calendar-only.md) | A location is responsible only for calendar and display timezone | narrowed by 0032 (rule-owning entity is PlanningUnit, not Region) |
| [0005](0005-no-work-pattern-entity.md) | No work-pattern entity; `defaultShiftId` and `availableWeekdays` are person fields | narrowed by 0038 (the day configuration owns the default shift) |
| [0006](0006-eligibility-target-shares.md) | Eligibility holds target shares; candidate ordering is eligibility → availability → 90-day fairness → recency | accepted |
| [0007](0007-comp-day-as-balance.md) | A comp day is an accrual with a balance placed by a search window, not a fixed offset | accepted |
| [0008](0008-events-are-dated-coverage-rules.md) | Events (DR test, training) are dated day configurations, not absences | accepted |
| [0009](0009-three-severity-levels.md) | Three validation levels: BLOCKING, WARNING, INFO; soft rules never block | narrowed by 0024, 0035, 0037 |
| [0010](0010-absence-limits-by-role-pool.md) | Absence limits apply per unit and per shift pool | scope updated by 0032 (per unit); the approval-time check it assumes exists only since 0047 |
| [0012](0012-schedule-repository-boundary.md) | ScheduleRepository is the single data boundary; every method async from day one | accepted |
| [0013](0013-headless-ui-layer.md) | Headless UI (Radix) so the shell can be swapped for a corporate component library | accepted |
| [0014](0014-own-grid-and-timeline.md) | Grid and timeline are hand-built, not AG Grid or Gantt charts | accepted |
| [0015](0015-optimistic-drafts-and-publication.md) | Optimistic drafts and atomic publication (supersedes 0011) | accepted |
| [0016](0016-day-configuration-groups.md) | Day configurations carry shift sets, not just minimums; events are dated configs | scope moved to unit by 0032 |
| [0017](0017-absence-range-cell-projection.md) | Absence is a range; the grid cell is a projection; training is not an absence | accepted, generalised by 0049 |
| [0021](0021-effective-dated-configuration.md) | Configuration is effective-dated; raising a minimum today must not break past dates | accepted |
| [0022](0022-tailwind-for-tokens-and-layout.md) | Tailwind v4 for tokens and layout; check new class names against utility namespace | accepted |
| [0023](0023-editing-arms-itself.md) | Any edit opens the draft; there is no Edit mode to enter (refines 0015) | accepted |
| [0024](0024-conflicts-do-not-block.md) | A conflict is acknowledged, not blocked (amends 0009) | accepted; the "gaps block" half was reversed by 0035 |
| [0025](0025-overview-replaces-dashboard-and-timeline.md) | Dashboard and Timeline merge into Overview; `/dashboard` and `/timeline` redirect | accepted |
| [0026](0026-suggest-and-auto-populate.md) | Suggest and auto-populate share a candidate ranker; suggests one, generates zero or more | accepted |
| [0027](0027-overview-reuses-day-detail.md) | Overview reuses the day drill-down timeline for consistency | accepted |
| [0028](0028-absence-import.md) | Absence import: one pure engine module, one diff engine, one batch | accepted |
| [0029](0029-http-cutover-and-server-persistence.md) | HTTP cutover: published and draft data move to the server | accepted |
| [0030](0030-domain-logic-server-single-implementation.md) | Domain logic lives on the server as the single implementation | accepted |
| [0031](0031-stubbed-real-auth-scaffold.md) | Stubbed-but-real auth scaffold: bearer token, role claims, no region scoping | accepted; 0039 makes the resolved identity authoritative for writes |
| [0032](0032-planning-unit-single-rule-axis.md) | PlanningUnit is the single rule axis (supersedes 0004, 0020) | accepted |
| [0033](0033-one-shift-entity-absolute-window.md) | One Shift entity with absolute window (supersedes 0001, 0018) | accepted |
| [0034](0034-zero-minimum-legal-coverage-state.md) | Zero minimums are a legal coverage state | accepted |
| [0035](0035-coverage-gap-does-not-block-publication.md) | Coverage gap does not block publication (narrows 0009) | accepted |
| [0036](0036-overview-and-schedule-independent-periods.md) | Overview and Schedule hold independent periods | accepted |
| [0037](0037-warnings-do-not-block-publication.md) | Warnings do not block publication (narrows 0009) | accepted |
| [0038](0038-day-configuration-owns-the-default-shift.md) | The day configuration owns the default shift, not the person (narrows 0005) | accepted |
| [0039](0039-actor-identity-from-the-token.md) | Actor identity comes from the token, never the request body | accepted |
| [0040](0040-one-change-history-for-every-entity.md) | One append-only change history, for every entity | accepted |
| [0041](0041-scoped-dataset-loading.md) | Dataset loading is scoped by date range (narrows 0012) | accepted |
| [0042](0042-concurrency-tokens-for-absences-and-comp-days.md) | Optimistic-concurrency tokens for absences and comp days (amends 0015) | accepted |
| [0043](0043-presence-is-an-orthogonal-range-entity.md) | Presence is an orthogonal range entity | accepted; its rendering half amended by 0050 |
| [0044](0044-in-app-inbox-first.md) | An in-app inbox first; the same table becomes an outbox later | accepted |
| [0045](0045-generic-request-envelope-typed-materialization.md) | A generic request envelope, a typed outcome | accepted; `ApprovalRoute` deleted by 0051 |
| [0046](0046-routing-is-not-authorization.md) | Routing is not authorization; the role hierarchy is not extended (extends 0032) | title holds; role model superseded by 0051 |
| [0047](0047-absorb-the-self-service-portal.md) | Absorb the self-service portal | accepted |
| [0048](0048-ai-explains-the-plan-never-decides-it.md) | AI explains the plan and never decides it | accepted |
| [0049](0049-event-types-are-data.md) | Event types are data; anything that counts as coverage is a Shift (generalises 0017) | accepted |
| [0050](0050-one-grid-half-days-and-the-split-cell.md) | One grid for everybody; half-days; the split cell; layers (amends 0043) | accepted |
| [0051](0051-roles-are-a-scoped-set.md) | Roles are a set, granted per planning unit (supersedes the role model in 0046, narrows 0032) | accepted |
| [0052](0052-two-flows-drafts-for-shifts-approval-for-everything-else.md) | Two flows: drafts for shifts, approval for everything else (deletes the markers in 0017, narrows 0015, amends 0049/0050) | accepted |
| [0053](0053-presence-types-are-reference-data.md) | Presence types are reference data; the kind stays a closed enum (narrows 0043) | accepted, **reopened by 0054** |
| [0054](0054-presence-types-are-an-open-set.md) | Presence types are an open set; the two branches become columns (reopens 0053) | accepted |
| [0055](0055-a-personal-calendar-and-a-feed.md) | A personal calendar, and a feed anybody can subscribe to (extends 0050) | accepted |
| [0056](0056-one-live-comp-day-request.md) | At most one live comp-day placement request (narrows 0052) | accepted |

## Superseded decisions (archive)

These decisions were replaced by later ones. They are retained for the historical
record — the reasoning in the Alternatives section often influenced the replacement
decision.

| # | Title | Superseded by |
|---|---|---|
| [0001](0001-role-carries-time.md) | A role carries its own time in the role's fixed timezone | 0033 (one Shift entity with absolute window) |
| [0003](0003-planning-unit-not-geography.md) | Planning unit is organizational, not geographic | 0020 → 0032 (PlanningUnit single rule axis) |
| [0004](0004-roles-belong-to-unit.md) | Roles belong to a unit; no global role catalog | 0032 (PlanningUnit single rule axis) |
| [0011](0011-checkout-instead-of-realtime.md) | Period locking via check-out | 0015 (optimistic drafts) |
| [0018](0018-shift-distinct-from-role.md) | Shift is distinct from role | 0033 (one Shift entity with absolute window) |
| [0019](0019-service-transition-as-category.md) | Service Transition as category with cross-region view | 0020 → 0032 (PlanningUnit single axis) |
| [0020](0020-planning-unit-and-region.md) | Region and planning unit are orthogonal axes | 0032 (PlanningUnit single rule axis) |
