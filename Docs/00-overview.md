# Overview

## What the product is

A shared planning and coverage portal for a multi-region application support
organization (~80 people across APAC, EMEA and AMER). It replaces several spreadsheet
views with one model:

- a people-by-day schedule;
- role requirements and coverage health;
- weekend and specialist rotations;
- live regional coverage across time zones;
- weekend-work-to-comp-off links;
- public-holiday staffing;
- eligibility, availability and fairness statistics;
- configurable roles, shifts, timings, colors and handovers;
- planner drafts and controlled publication;
- a traceable history of schedule changes.

The central object is an **assignment**: one person, one calendar date, one working
shift or one roster marker. Assignments are shown in a calendar grid, interpreted
against unit requirements, and turned into coverage information.

## What's wrong with the spreadsheet today

- **Shift time is written down nowhere.** The planner remembers that `Lead` means one
  window and `Batch-L` another. A new hire cannot plan without a mentor.
- **Coverage requirements are recorded nowhere.** "A weekend needs a Primary" is tribal
  knowledge. A gap is caught by eye, or not at all.
- **Vacations live in another system** with no API, retyped by hand. Double entry.
- **Comp days** are tracked in a third place and carried over manually. A forgotten
  comp day drops someone out of a shift with no warning.
- **The simultaneous-absence limit isn't enforced.** Every summer this produces
  last-minute scrambling.
- **There's no operational view.** "Who's the lead in APAC right now and when is the
  EMEA overlap" needs the file, the date, the role window and timezone math.
- **There's no fairness data.** Who worked more weekends is a matter of feeling.
- **There's no draft.** Editing the shared file *is* editing the published rota.

## Goals

1. Anyone can answer "who is working, where, in which shift" without opening several
   spreadsheets.
2. A planner can build a schedule without touching the published rota until they
   choose to.
3. Missing coverage and invalid assignments are visible while planning, not after.
4. Weekend and specialist duties are distributed fairly among eligible people.
5. Comp-off earned by weekend work is visible, linked and auditable.
6. Any user can view the same shifts in a chosen display timezone.
7. Regional patterns stay configurable; they are not hard-coded into the UI.
8. Historical spreadsheet patterns are representable without losing the distinction
   between `0`, `Off`, `PH`, `Comp-Off`, on-call, training and sickness.

## Scope

Out of scope: time tracking, payroll, replacing the corporate leave system, ticketing,
incident alerting.

## Users and access

| User | What they need | Product behavior |
|---|---|---|
| **Viewer** | Understand coverage, find personal duties | Reads published data, filters to Only Me, changes display timezone, browses Overview / Schedule / People. Cannot alter the published plan. |
| **Planner** | Build and maintain a valid rota | Opens a draft, assigns eligible shifts, marks non-working states, checks gaps, undoes, generates suggestions, reviews and publishes — **in any planning unit**. |
| **Administrator** | Maintain the scheduling model | Everything a planner can, plus people, eligibility, shifts, day configurations, shift requirements, colors, holidays, comp-off rules and handovers. May force-publish, explicitly and audited. |

**There is no unit scoping of write access**
([ADR-0032](adr/0032-planning-unit-single-rule-axis.md)). The team is small and nobody edits
another team's rota without reason; the control is a **complete audit trail** — who
changed what, when, and what it was before — not a permission matrix. This removes
unit-scope claims and permission checks from the model entirely.

Identity comes from authenticated access rules. Any in-app role switcher is a
development convenience and must not ship to ordinary users.

## Vocabulary

| Term | Meaning |
|---|---|
| Published schedule | The authoritative rota visible to everyone. |
| Draft | A private set of proposed changes owned by a planner for a unit and period. |
| Planning unit | A scheduling and **planning** boundary (`unit-amer`, `unit-emea`, `unit-apac`, `unit-st`). Owns all rules that apply: shifts, requirements, policies and comp-off policy. Defines whose screen a person appears on (a default filter, not a permission boundary). |
| Shift | Work performed that day: `Lead`, `Crew`, `E`, `BM`, `M`, `Primary`, `ST:AMER`. `Cover` is engineering work, including in-hours training. Shifts belong to a planning unit and carry an absolute time window. |
| Marker | A roster state that is not work and not leave: `Off`, `0`. |
| Status | The resolved non-working state of a cell: `Off`, `PH`, `Comp-Off`, `Vacation`, `Sick`, `0`. |
| Day configuration | The set of shift requirements that applies to a group of weekdays (or a specific date for events). |
| Requirement | Minimum and optional maximum people for a shift on a day type. Zero minimum is legal (e.g., Service Transition optional shifts). |
| Coverage | Comparison of actual assignments against requirements. |
| Gap | Fewer eligible assignments than the shift minimum (never reported for zero-minimum shifts). |
| Thin | Minimum met, no spare capacity. |
| Conflict | Invalid data: ineligible shift, double booking, assignment during absence. |
| Handover | The overlap between two units' shift windows on the timeline — computed on the fly, not stored. |
| Comp-off | A compensatory non-working day earned by weekend or holiday work. |
| Rotation | Fair ordering of eligible people for specialist or weekend work. |

## Scale

80 people, 4 planning units (3 regional + 1 cross-regional). That's small, and the technical consequences
are spelled out in [12-architecture.md](12-architecture.md): the whole quarter loads
into the browser at once, there's no server-side pagination, and no virtualization.

## Relationship to the earlier prototype

A previous corporate implementation of this product exists and is described in
`SHIFT-O-MATOR-desc-anonymized.md` at the repository root. That document is the
**authority on operational reality**: real role codes, real coverage minimums, real
status vocabulary, and the draft/publish model. Where this design once disagreed with
it, the decisions were revisited — see [adr/](adr/) and in particular ADR-0015 through
ADR-0019, which supersede or amend earlier decisions.
