# shift-o-mator documentation

Shift planning and coverage for a global application support team.

> An earlier corporate implementation of this product informed the original design —
> real shift codes, coverage minimums, status vocabulary and the draft/publish model
> all trace back to it. That prototype's own spec document is gone from the repository
> (Phase 0); [adr/](adr/) is now the authority on why the model looks the way it does,
> including every place the design has diverged since (ADR-0015 onward, and especially
> ADR-0032–0034 for the Phase 8 model change).

## Product and model

| File | Contents |
|---|---|
| [00-overview.md](00-overview.md) | The problem, users and access, goals, scope, vocabulary |
| [01-domain-model.md](01-domain-model.md) | Every entity and how they relate; real shift codes and minimums |
| [02-time.md](02-time.md) | Storage and display of time, DST, handovers (computed, not stored) |
| [03-drafts-and-publication.md](03-drafts-and-publication.md) | Draft lifecycle, concurrency, atomic publish, audit |
| [04-coverage-and-validation.md](04-coverage-and-validation.md) | Coverage levels, gaps vs conflicts, three severity levels, rules |
| [05-comp-days.md](05-comp-days.md) | Window-based accrual, lifecycle, links, balance |
| [06-generation.md](06-generation.md) | Candidate ordering, Suggest, auto-populate, explainability |

## User experience

| File | Contents |
|---|---|
| [07-ux-shell.md](07-ux-shell.md) | Shell, navigation, global controls, visual language, widgets, states, accessibility |
| [08-ux-schedule.md](08-ux-schedule.md) | The planning grid: layout, grouping, cells, coverage, picker, keyboard, bulk, review |
| [09-ux-dashboard-timeline.md](09-ux-dashboard-timeline.md) | Overview (merged dashboard + timeline), day drill-down, reports |
| [10-ux-people-settings.md](10-ux-people-settings.md) | People roster and fairness; Settings and administration |

## Delivery

| File | Contents |
|---|---|
| [11-integrations.md](11-integrations.md) | Absence import, status vocabulary, HR reverse flow, ICS, export |
| [12-architecture.md](12-architecture.md) | Stack, layering, engines, data boundary, target API, scale, testing |
| [13-roadmap.md](13-roadmap.md) | What exists, what changes, and the stage sequence |
| [14-open-questions.md](14-open-questions.md) | What the prototype closed, and what is still open |

## Decisions

[adr/](adr/) — each closes off a specific problem. Revisiting one requires a new ADR
that supersedes or amends it, not a quiet edit.

See also [adr/README.md](adr/README.md) for the same list split into active vs.
superseded, if you only want what's still true today.

| ADR | Decision | Status |
|---|---|---|
| [0001](adr/0001-role-carries-time.md) | A role carries its own time | **superseded by 0033** |
| [0002](adr/0002-location-is-calendar-only.md) | A location is only calendar and display | narrowed by 0032 |
| [0003](adr/0003-planning-unit-not-geography.md) | A region is an organizational boundary | **superseded by 0032** |
| [0004](adr/0004-roles-belong-to-unit.md) | Roles belong to a region; no global catalog | **superseded by 0032** |
| [0005](adr/0005-no-work-pattern-entity.md) | No separate work-pattern entity | clarified |
| [0006](adr/0006-eligibility-target-shares.md) | Eligibility holds target shares | clarified |
| [0007](adr/0007-comp-day-as-balance.md) | A comp day is an accrual with a balance | amended: window, not offset |
| [0008](adr/0008-events-are-dated-coverage-rules.md) | Events are dated configuration | amended by 0016 |
| [0009](adr/0009-three-severity-levels.md) | Three validation levels; soft rules don't block | extended: gap vs conflict, thin |
| [0010](adr/0010-absence-limits-by-role-pool.md) | Absence limits per region and per role pool | scope updated by 0032 (per unit) |
| [0011](adr/0011-checkout-instead-of-realtime.md) | Period locking via check-out | **superseded by 0015** |
| [0012](adr/0012-schedule-repository-boundary.md) | `ScheduleRepository` is the single data boundary | accepted |
| [0013](adr/0013-headless-ui-layer.md) | Headless UI layer for a cheap shell swap | amended by 0022 |
| [0014](adr/0014-own-grid-and-timeline.md) | Timeline and grid built in-house | accepted |
| [0015](adr/0015-optimistic-drafts-and-publication.md) | Optimistic drafts and atomic publication | accepted |
| [0016](adr/0016-day-configuration-groups.md) | Day configurations carry role sets | scope moved to unit by 0032 |
| [0017](adr/0017-absence-range-cell-projection.md) | Absence is a range; the cell is a projection | accepted |
| [0018](adr/0018-shift-distinct-from-role.md) | A shift is contracted hours; a role is the duty window | **superseded by 0033** |
| [0019](adr/0019-service-transition-as-category.md) | Service Transition is a category with a cross-region view | **superseded by 0020** |
| [0020](adr/0020-planning-unit-and-region.md) | Planning unit ⊥ region; unrestricted access with audit | **superseded by 0032** |
| [0021](adr/0021-effective-dated-configuration.md) | Configuration is effective-dated | accepted |
| [0022](adr/0022-tailwind-for-tokens-and-layout.md) | Tailwind for tokens and layout; Radix keeps behavior | accepted |
| [0023](adr/0023-editing-arms-itself.md) | Editing arms itself; no Edit mode to enter | accepted |
| [0024](adr/0024-conflicts-do-not-block.md) | A conflict is acknowledged, not blocked | accepted |
| [0025](adr/0025-overview-replaces-dashboard-and-timeline.md) | One Overview screen; all units by default | accepted |
| [0026](adr/0026-suggest-and-auto-populate.md) | Suggest and auto-populate share one candidate ranker | accepted |
| [0027](adr/0027-overview-reuses-day-detail.md) | Overview's timeline reuses the day-detail view; date strip gets click-click | amends 0025 |
| [0028](adr/0028-absence-import.md) | Absence import: one diff engine, one batch | accepted |
| [0029](adr/0029-http-cutover-and-server-persistence.md) | Published and draft data move to the server (HTTP cutover) | accepted |
| [0030](adr/0030-domain-logic-server-single-implementation.md) | Domain logic runs server-side only, one implementation | accepted |
| [0031](adr/0031-stubbed-real-auth-scaffold.md) | Stubbed-but-real auth: real middleware, fixed identity in dev | accepted |
| [0032](adr/0032-planning-unit-single-rule-axis.md) | Region deleted; PlanningUnit is the single rule axis | accepted |
| [0033](adr/0033-one-shift-entity-absolute-window.md) | One `Shift` entity, one absolute time window | accepted |
| [0034](adr/0034-zero-minimum-legal-coverage-state.md) | A zero-minimum shift requirement is legal, never a gap | accepted |
