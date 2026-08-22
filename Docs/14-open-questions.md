# Open questions

**All eight original questions are closed.** This page is the record of how, so they
are not reopened by accident.

## Closed by the prototype specification

`SHIFT-O-MATOR-desc-anonymized.md` answered five of them outright.

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
| **`Training` semantics** | Not an absence. In-hours training and other engineering activity is the **`Cover`** role — `Cover` is engineering work. | `AbsenceType` narrowed to `VACATION \| SICK \| OTHER`. A `Training` cell imports as `Cover` and **counts toward coverage**. ([ADR-0017](adr/0017-absence-range-cell-projection.md)) |
| **Dated event rules** | Planners know an event is happening and staff up. Event-specific minimums are a custom case; not built now. | `DayConfiguration.key = 'date'` stays in the type; no UI, no fixture, no engine branch. ([ADR-0008](adr/0008-events-are-dated-coverage-rules.md)) |
| **Effective dating** | Do not touch the past. Raising a minimum today must not make last March fail. | Coverage-affecting configuration is versioned by effective date. ([ADR-0021](adr/0021-effective-dated-configuration.md)) |
| **Who plans Service Transition** | A manager plans cross-regionally. Planning units should be first-class and may be regions *or* cross-region teams. Write access for everyone everywhere is fine — the team is small — provided there is an audit trail. | Region and planning unit become two orthogonal axes; regional authorization scoping is removed entirely. ([ADR-0020](adr/0020-planning-unit-and-region.md)) |
| **Absence capacity limits** | Needed. This was done by hand before and is not in the prototype. | Kept. 3 long / 4 short region-wide as confirmed defaults, configurable. ([ADR-0010](adr/0010-absence-limits-by-role-pool.md)) |

## Remaining assumptions

Not open questions, but values chosen without confirmation. Each is marked `ASSUMPTION`
in fixtures and is cheap to change:

- `agingThresholdDays` — seeded at 14.
- Role-pool absence limits — seeded at 1 for the lead-type pools. The region-wide 3/4
  is confirmed; which specific pools need their own limit is not.
- `windowBeforeDays` / `windowAfterDays` for comp-off placement — seeded to span the
  surrounding two weeks.
- Role colors and hotkeys.

## What would reopen this list

Real usage. The first month of real planning will surface things no specification
predicted — that is expected, and it is why the model keeps configuration in data
rather than in code.
