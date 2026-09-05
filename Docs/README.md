# shift-o-mator documentation

Shift planning and coverage for a global application support team.

> An earlier corporate implementation of this product informed the original design —
> real shift codes, coverage minimums, status vocabulary and the draft/publish model
> all trace back to it. That prototype's own spec document is gone from the repository
> (Phase 0); [adr/](adr/) is now the authority on why the model looks the way it does,
> including every place the design has diverged since — ADR-0015 onward, especially
> ADR-0032–0034 for the Phase 8 model change, ADR-0039–0048 for Phase 9 (production
> readiness, presence, self-service and AI), ADR-0049–0050 for Phase 10 (configurable
> event types, half-days, and one grid for everybody), ADR-0051–0056 for Phase 11 (roles
> as a scoped set, and the two write paths), ADR-0057 for Phase 12 (the design language),
> ADR-0058 and ADR-0060 for Phase 13 (Entra ID, a deployable app, and a model that is a
> deployment rather than a vendor) and ADR-0059 and ADR-0061 for Phase 14 (first-run setup,
> and Settings saving people as one unit).

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
| [15-self-service.md](15-self-service.md) | Presence, requests, comp-day placement, My calendar and the ICS feed, who approves, and the inbox |
| [16-workflows.md](16-workflows.md) | **Start here for "who does what"** — every workflow end to end, and the role each step needs |

## Delivery

| File | Contents |
|---|---|
| [11-integrations.md](11-integrations.md) | Absence import, status vocabulary, HR reverse flow, holiday feed import, the ICS feed, export |
| [12-architecture.md](12-architecture.md) | Stack, layering, engines, data boundary, the API surface, setup and deployment, scale, testing |
| [13-roadmap.md](13-roadmap.md) | What exists, what changes, and the stage sequence |
| [14-open-questions.md](14-open-questions.md) | What the prototype closed, and what is still open |
| [../deploy/README.md](../deploy/README.md) | The operator guide: running locally, container images, Entra ID registration, AKS and Helm |

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
| [0004](adr/0004-roles-belong-to-unit.md) | Shifts belong to a unit; no global catalog | **superseded by 0032** |
| [0005](adr/0005-no-work-pattern-entity.md) | No separate work-pattern entity | narrowed by 0038 |
| [0006](adr/0006-eligibility-target-shares.md) | Eligibility holds target shares | clarified |
| [0007](adr/0007-comp-day-as-balance.md) | A comp day is an accrual with a balance | amended: window, not offset |
| [0008](adr/0008-events-are-dated-coverage-rules.md) | Events are dated configuration | amended by 0016 |
| [0009](adr/0009-three-severity-levels.md) | Three validation levels; soft rules don't block | narrowed by 0024, 0035, 0037 |
| [0010](adr/0010-absence-limits-by-role-pool.md) | Absence limits per unit and per shift pool | scope updated by 0032; the approval-time check exists only since 0047 |
| [0011](adr/0011-checkout-instead-of-realtime.md) | Period locking via check-out | **superseded by 0015** |
| [0012](adr/0012-schedule-repository-boundary.md) | `ScheduleRepository` is the single data boundary | **superseded by 0067**; the async rule survives |
| [0013](adr/0013-headless-ui-layer.md) | Headless UI layer for a cheap shell swap | amended by 0022 |
| [0014](adr/0014-own-grid-and-timeline.md) | Timeline and grid built in-house | accepted |
| [0015](adr/0015-optimistic-drafts-and-publication.md) | Optimistic drafts and atomic publication | amended by 0042 |
| [0016](adr/0016-day-configuration-groups.md) | Day configurations carry shift sets | scope moved to unit by 0032 |
| [0017](adr/0017-absence-range-cell-projection.md) | Absence is a range; the cell is a projection | accepted |
| [0018](adr/0018-shift-distinct-from-role.md) | A shift is contracted hours; a role is the duty window | **superseded by 0033** |
| [0019](adr/0019-service-transition-as-category.md) | Service Transition is a category with a cross-region view | **superseded by 0020** |
| [0020](adr/0020-planning-unit-and-region.md) | Planning unit ⊥ region; unrestricted access with audit | **superseded by 0032** |
| [0021](adr/0021-effective-dated-configuration.md) | Configuration is effective-dated | accepted |
| [0022](adr/0022-tailwind-for-tokens-and-layout.md) | Tailwind for tokens and layout; Radix keeps behavior | accepted |
| [0023](adr/0023-editing-arms-itself.md) | Editing arms itself; no Edit mode to enter | accepted |
| [0024](adr/0024-conflicts-do-not-block.md) | A conflict is acknowledged, not blocked | accepted; its "gaps block" half reversed by 0035 |
| [0025](adr/0025-overview-replaces-dashboard-and-timeline.md) | One Overview screen; all units by default | accepted |
| [0026](adr/0026-suggest-and-auto-populate.md) | Suggest and auto-populate share one candidate ranker | accepted |
| [0027](adr/0027-overview-reuses-day-detail.md) | Overview's timeline reuses the day-detail view; date strip gets click-click | amends 0025 |
| [0028](adr/0028-absence-import.md) | Absence import: one diff engine, one batch | accepted |
| [0029](adr/0029-http-cutover-and-server-persistence.md) | Published and draft data move to the server (HTTP cutover) | accepted |
| [0030](adr/0030-domain-logic-server-single-implementation.md) | Domain logic runs server-side only, one implementation | accepted |
| [0031](adr/0031-stubbed-real-auth-scaffold.md) | Stubbed-but-real auth: real middleware, fixed identity in dev | extended by 0039 |
| [0032](adr/0032-planning-unit-single-rule-axis.md) | Region deleted; PlanningUnit is the single rule axis | accepted |
| [0033](adr/0033-one-shift-entity-absolute-window.md) | One `Shift` entity, one absolute time window | accepted |
| [0034](adr/0034-zero-minimum-legal-coverage-state.md) | A zero-minimum shift requirement is legal, never a gap | accepted |
| [0035](adr/0035-coverage-gap-does-not-block-publication.md) | A coverage gap does not block publication | accepted |
| [0036](adr/0036-overview-and-schedule-independent-periods.md) | Overview and Schedule hold independent periods | accepted |
| [0037](adr/0037-warnings-do-not-block-publication.md) | Warnings do not block publication | accepted |
| [0038](adr/0038-day-configuration-owns-the-default-shift.md) | The day configuration owns the default shift, not the person | accepted |
| [0039](adr/0039-actor-identity-from-the-token.md) | Actor identity comes from the token, never the request body | accepted |
| [0040](adr/0040-one-change-history-for-every-entity.md) | One append-only change history, for every entity | accepted |
| [0041](adr/0041-scoped-dataset-loading.md) | Dataset loading is scoped by date range | accepted |
| [0042](adr/0042-concurrency-tokens-for-absences-and-comp-days.md) | Optimistic-concurrency tokens for absences and comp days | accepted |
| [0043](adr/0043-presence-is-an-orthogonal-range-entity.md) | Presence is an orthogonal range entity | accepted; rendering amended by 0050 |
| [0044](adr/0044-in-app-inbox-first.md) | An in-app inbox first; the same table becomes an outbox later | accepted |
| [0045](adr/0045-generic-request-envelope-typed-materialization.md) | A generic request envelope, a typed outcome | accepted |
| [0046](adr/0046-routing-is-not-authorization.md) | Routing is not authorization; the role hierarchy is not extended | title holds; role model superseded by 0051 |
| [0047](adr/0047-absorb-the-self-service-portal.md) | Absorb the self-service portal | accepted |
| [0048](adr/0048-ai-explains-the-plan-never-decides-it.md) | AI explains the plan and never decides it | accepted |
| [0049](adr/0049-event-types-are-data.md) | Event types are data; anything that counts as coverage is a Shift | accepted |
| [0050](adr/0050-one-grid-half-days-and-the-split-cell.md) | One grid for everybody; half-days; the split cell; layers | accepted |
| [0051](adr/0051-roles-are-a-scoped-set.md) | Roles are a set, granted per planning unit | accepted |
| [0052](adr/0052-two-flows-drafts-for-shifts-approval-for-everything-else.md) | Two flows: drafts for shifts, approval for everything else | accepted |
| [0053](adr/0053-presence-types-are-reference-data.md) | Presence types are reference data; the kind stays a closed enum | accepted, reopened by 0054 |
| [0054](adr/0054-presence-types-are-an-open-set.md) | Presence types are an open set; the two branches become columns | accepted |
| [0055](adr/0055-a-personal-calendar-and-a-feed.md) | A personal calendar, and a feed anybody can subscribe to | accepted |
| [0056](adr/0056-one-live-comp-day-request.md) | At most one live comp-day placement request | accepted |
| [0057](adr/0057-a-language-of-surfaces.md) | A language of surfaces: light, measure, elevation | accepted |
| [0058](adr/0058-entra-id-identity-is-linked-by-email.md) | An Entra ID sign-in is linked to a person by email, by hand | accepted; its bootstrap replaced by 0059 |
| [0059](adr/0059-setup-is-a-screen-not-a-flag.md) | Setup is a screen, not a flag | accepted |
| [0060](adr/0060-the-model-is-a-deployment-not-a-vendor.md) | The model is a deployment, not a vendor | accepted |
| [0061](adr/0061-settings-saves-people-as-one-unit.md) | Settings saves people as one unit | accepted |
| [0062](adr/0062-one-source-of-roles-by-default.md) | One source of roles by default: the database | accepted; the switch moved to a row by 0063 |
| [0063](adr/0063-runtime-settings-are-rows.md) | A setting that takes effect per request is a row, not configuration | accepted |
| [0064](adr/0064-a-notification-policy-and-a-log.md) | What gets sent is a matrix; what was sent is a log | accepted |
| [0065](adr/0065-the-calendar-allowlist-is-rows-not-a-key.md) | The holiday-import allowlist is rows, not a settings key | accepted |
| [0066](adr/0066-the-wire-writes-enums-the-way-the-client-does.md) | The wire writes enums the way the client already does | accepted |
| [0067](adr/0067-one-owner-for-each-kind-of-state.md) | One owner for each kind of state | accepted |
