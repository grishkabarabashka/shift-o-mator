# shift-o-mator documentation

Shift planning and coverage for a global application support team.

> This design was revised against `SHIFT-O-MATOR-desc-anonymized.md` — the
> specification of an earlier corporate implementation of the same product. That
> document is the authority on operational reality: real role codes, real coverage
> minimums, real status vocabulary and the draft/publish model. Where this design
> disagreed with it, the decisions were revisited; see ADR-0015 through ADR-0019.

## Product and model

| File | Contents |
|---|---|
| [00-overview.md](00-overview.md) | The problem, users and access, goals, scope, vocabulary |
| [01-domain-model.md](01-domain-model.md) | Every entity and how they relate; real role codes and minimums |
| [02-time.md](02-time.md) | Storage and display of time, DST, handovers |
| [03-drafts-and-publication.md](03-drafts-and-publication.md) | Draft lifecycle, concurrency, atomic publish, audit |
| [04-coverage-and-validation.md](04-coverage-and-validation.md) | Coverage levels, gaps vs conflicts, three severity levels, rules |
| [05-comp-days.md](05-comp-days.md) | Window-based accrual, lifecycle, links, balance |
| [06-generation.md](06-generation.md) | Candidate ordering, Suggest, auto-populate, explainability |

## User experience

| File | Contents |
|---|---|
| [07-ux-shell.md](07-ux-shell.md) | Shell, navigation, global controls, visual language, widgets, states, accessibility |
| [08-ux-schedule.md](08-ux-schedule.md) | The planning grid: layout, grouping, cells, coverage, picker, keyboard, bulk, review |
| [09-ux-dashboard-timeline.md](09-ux-dashboard-timeline.md) | Dashboard, standalone Timeline, day drill-down, reports |
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

| ADR | Decision | Status |
|---|---|---|
| [0001](adr/0001-role-carries-time.md) | A role carries its own time | amended by 0018 |
| [0002](adr/0002-location-is-calendar-only.md) | A location is only calendar and display | accepted |
| [0003](adr/0003-planning-unit-not-geography.md) | A region is an organizational boundary | amended by 0019 |
| [0004](adr/0004-roles-belong-to-unit.md) | Roles belong to a region; no global catalog | accepted |
| [0005](adr/0005-no-work-pattern-entity.md) | No separate work-pattern entity | clarified |
| [0006](adr/0006-eligibility-target-shares.md) | Eligibility holds target shares | clarified |
| [0007](adr/0007-comp-day-as-balance.md) | A comp day is an accrual with a balance | amended: window, not offset |
| [0008](adr/0008-events-are-dated-coverage-rules.md) | Events are dated configuration | amended by 0016 |
| [0009](adr/0009-three-severity-levels.md) | Three validation levels; soft rules don't block | extended: gap vs conflict, thin |
| [0010](adr/0010-absence-limits-by-role-pool.md) | Absence limits per region and per role pool | accepted |
| [0011](adr/0011-checkout-instead-of-realtime.md) | Period locking via check-out | **superseded by 0015** |
| [0012](adr/0012-schedule-repository-boundary.md) | `ScheduleRepository` is the single data boundary | accepted |
| [0013](adr/0013-headless-ui-layer.md) | Headless UI layer for a cheap shell swap | amended by 0022 |
| [0014](adr/0014-own-grid-and-timeline.md) | Timeline and grid built in-house | accepted |
| [0015](adr/0015-optimistic-drafts-and-publication.md) | Optimistic drafts and atomic publication | accepted |
| [0016](adr/0016-day-configuration-groups.md) | Day configurations carry role sets | accepted |
| [0017](adr/0017-absence-range-cell-projection.md) | Absence is a range; the cell is a projection | accepted |
| [0018](adr/0018-shift-distinct-from-role.md) | A shift is contracted hours; a role is the duty window | accepted |
| [0019](adr/0019-service-transition-as-category.md) | Service Transition is a category with a cross-region view | **superseded by 0020** |
| [0020](adr/0020-planning-unit-and-region.md) | Planning unit ⊥ region; unrestricted access with audit | accepted |
| [0021](adr/0021-effective-dated-configuration.md) | Configuration is effective-dated | accepted |
| [0022](adr/0022-tailwind-for-tokens-and-layout.md) | Tailwind for tokens and layout; Radix keeps behavior | accepted |
| [0023](adr/0023-editing-arms-itself.md) | Editing arms itself; no Edit mode to enter | accepted |
