# Open questions

**All eight original questions are closed.** This page is the record of how, so they
are not reopened by accident.

## Closed by the prototype specification

The earlier prototype's own spec document — since removed from the repository
(Phase 0); this page is the surviving record of what it settled — answered five of
them outright.

| Question | Answer |
|---|---|
| Real role codes and times per region | §13 of the prototype spec, reproduced in [01-domain-model.md](01-domain-model.md) |
| Does a late shift-lead role exist | Yes: `Crew-L` carries late lead duty; `Batch-L`, `CH-Late` and `Lead-E` are the other late/early variants |
| Real coverage minimums | §13 "Coverage requirements", reproduced in [01-domain-model.md](01-domain-model.md) |
| Comp day offset for a holiday | Dissolved — placement is a search window with excluded weekdays, not an offset ([05-comp-days.md](05-comp-days.md)) |
| How absences and comp days are marked in the sheet | §20 canonical status vocabulary, reproduced in [11-integrations.md](11-integrations.md) |

## Closed by the owner

| Question | Decision | Consequence |
|---|---|---|
| **Comp day expiry** | They never expire. A configurable aging threshold flags anything outstanding longer than roughly one to two weeks: an alert for the manager, a standing notice for the person. | `EXPIRED` status and `expiresOn` removed; `agingThresholdDays` added; `COMP_DAY_EXPIRING` → `COMP_DAY_AGING`. ([ADR-0007](adr/0007-comp-day-as-balance.md)) |
| **Workbook exceptions** | There are none. The scheme is even; every row behaves the same way. | No special-case modeling. If one turns up later it is a genuine surprise, not an oversight. |
| **On-call plus an ordinary duty** | Does not happen. One duty per person per day. | Hard uniqueness on (person, date). On-call is an ordinary role code. The prototype's unresolved constraint problem disappears. |
| **`Training` semantics** | Not an absence. In-hours training and other engineering activity is the **`Cover`** shift — `Cover` is engineering work. | A `Training` cell imports as `Cover` and **counts toward coverage** ([ADR-0017](adr/0017-absence-range-cell-projection.md)). The `AbsenceType` enum this row once named is gone: a kind of leave is an `EventType` row ([ADR-0049](adr/0049-event-types-are-data.md)). |
| **Dated event rules** | Planners know an event is happening and staff up. Event-specific minimums are a custom case; not built now. | `DayConfiguration.key = 'date'` stays in the type; no UI, no fixture, no engine branch. ([ADR-0008](adr/0008-events-are-dated-coverage-rules.md)) |
| **Effective dating** | Do not touch the past. Raising a minimum today must not make last March fail. | Coverage-affecting configuration is versioned by effective date. ([ADR-0021](adr/0021-effective-dated-configuration.md)) |
| **Who plans Service Transition** | A manager plans cross-regionally. Planning units should be first-class and may be regions *or* cross-region teams. Write access for everyone everywhere is fine — the team is small — provided there is an audit trail. | At the time: region and planning unit became two orthogonal axes, with regional authorization scoping removed entirely (ADR-0020). **Superseded by Phase 8** ([ADR-0032](adr/0032-planning-unit-single-rule-axis.md)): Region turned out to duplicate PlanningUnit for 65 of 76 people, so it was deleted outright — Service Transition is simply `unit-st`, a planning unit like any other, with its own (zero-minimum) coverage rules. No write-access scoping either way. |
| **Absence capacity limits** | Needed. This was done by hand before and is not in the prototype. | Kept. 3 long / 4 short per unit as confirmed defaults, configurable. ([ADR-0010](adr/0010-absence-limits-by-role-pool.md), scope updated by [ADR-0032](adr/0032-planning-unit-single-rule-axis.md)) |

## Closed by the owner during Phase 9

| Question | Decision |
|---|---|
| **What to do about the separate self-service portal** — absorb it, integrate with it, or model the concepts and defer | **Absorb.** Presence, requests and approvals live here; the portal is retired ([ADR-0047](adr/0047-absorb-the-self-service-portal.md)). The analysis had recommended splitting at the entitlement line — keep leave upstream, absorb only what is rota-local — and the owner chose to take leave as well. The cost is stated in the ADR: availability becomes a people problem, and sick-leave data brings GDPR Article 9 obligations. Entitlement is still **not** modelled, and that is the boundary the decision does not cross. |
| **How far to take AI** | **L1: explanations only** ([ADR-0048](adr/0048-ai-explains-the-plan-never-decides-it.md)). A deterministic digest computes the answer; a model phrases it. Natural-language *editing* (L3) is pre-authorised in shape — it would go through the existing draft/publish gate — but is not built. Natural-language *queries* (L2) are blocked on a security decision about PII in prompts, not on engineering. |

## Resolved: the Phase 8 known gap

**Overview's date range was not decoupled from Schedule's.** Both screens shared one
selected range, so changing it on Schedule moved Overview too. Closed by
[ADR-0036](adr/0036-overview-and-schedule-independent-periods.md): each screen now
remembers its own slice in `useUi` and writes the single active range on mount, so every
other consumer still just reads `range`.

## Remaining assumptions

Not open questions, but values chosen without confirmation. Each is marked `ASSUMPTION`
in fixtures and is cheap to change:

- `agingThresholdDays` — seeded at 14.
- Shift-pool absence limits — seeded at 1 for the lead-type pools. The unit-wide 3/4
  is confirmed; which specific pools need their own limit is not.
- `windowBeforeDays` / `windowAfterDays` for comp-off placement — seeded to span the
  surrounding two weeks.
- Shift colors and hotkeys.
- `unit-st`'s `primaryLocationId` — New York, the largest ST location, chosen rather than
  sourced. It decides holiday-ness for that unit's day-configuration resolution.
- The seeded role grants — every manager is Planner, Approver and Admin **of their own
  unit**, plus one global Admin so the configuration that belongs to no unit has an owner.
  A starting point an admin narrows on Settings → Roles, not a claim about how the team is
  really organised ([ADR-0051](adr/0051-roles-are-a-scoped-set.md)).

## What would reopen this list

Real usage. The first month of real planning will surface things no specification
predicted — that is expected, and it is why the model keeps configuration in data
rather than in code.
