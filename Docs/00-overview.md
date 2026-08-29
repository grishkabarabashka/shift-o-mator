# Overview

## What the product is

A shared planning and coverage portal for a multi-region application support
organization (~80 people across APAC, EMEA and AMER). It replaces several spreadsheet
views with one model:

- a people-by-day schedule;
- shift requirements and coverage health;
- weekend and specialist rotations;
- live cross-unit coverage across time zones;
- weekend-work-to-comp-off links;
- public-holiday staffing;
- eligibility, availability and fairness statistics;
- configurable shifts, timings, colors and day configurations;
- planner drafts and controlled publication;
- self-service: where people work, and what they ask for;
- a traceable history of **every** change, not only schedule ones.

The central object is an **assignment**: one person, one calendar date, one working
shift. Assignments are shown in a calendar grid, interpreted against unit requirements,
and turned into coverage information. An empty cell means no shift — the roster markers
that used to say more than that are gone
([ADR-0052](adr/0052-two-flows-drafts-for-shifts-approval-for-everything-else.md)).

## What's wrong with the spreadsheet today

- **Shift time is written down nowhere.** The planner remembers that `Lead` means one
  window and `Batch-L` another. A new hire cannot plan without a mentor.
- **Coverage requirements are recorded nowhere.** "A weekend needs a Primary" is tribal
  knowledge. A gap is caught by eye, or not at all.
- **Vacations live in another system** with no API, retyped by hand. Double entry.
  *(Closed by ADR-0047 — leave is requested and approved here now. The paste import
  survives for history and for anything still arriving from outside.)*
- **Comp days** are tracked in a third place and carried over manually. A forgotten
  comp day drops someone out of a shift with no warning.
- **The simultaneous-absence limit isn't enforced.** Every summer this produces
  last-minute scrambling. *(ADR-0010 always said this should be checked when leave is
  approved; there was no approval until ADR-0047, so it never ran there.)*
- **There's no operational view.** "Who's the lead in APAC right now and when is the
  EMEA overlap" needs the file, the date, the shift window and timezone math.
- **Nobody knows who is in which office.** Remote-versus-onsite lives in a third system
  again, and never next to the roster where the question is actually asked.
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
7. Each unit's patterns stay configurable; they are not hard-coded into the UI.
8. Historical spreadsheet patterns are representable without losing the distinction
   between `0`, `Off`, `PH`, `Comp-Off`, on-call, training and sickness.

## Scope

**In scope, since [ADR-0047](adr/0047-absorb-the-self-service-portal.md):** self-service.
People record where they are working — remote, an office, travel, a customer site — and
ask for leave here, and requests route to approvers here. The separate portal that used
to own that is retired.

Out of scope: time tracking, payroll, ticketing, incident alerting.

**And one boundary inside the absorbed scope, stated because it is the one that will be
pushed on:** leave *entitlement* is not modelled. There is no balance, no accrual of
annual leave, no carry-over and no pro-rata. The product records that leave was asked for
and granted; it does not compute how many days anyone has left, and it must not be
extended to. If a leave-balance question ever needs answering in here, integrate or buy —
statutory minima across five countries are a different product.

## Users and access

| User | What they need | Product behavior |
|---|---|---|
| **Viewer** | Understand coverage, find personal duties, ask for things | Reads published data, chooses a display timezone, browses Overview / Schedule / People / Requests. Records **their own** presence and raises **their own** requests. Cannot alter the published plan. |
| **Planner** | Build and maintain a valid rota | Opens a draft, assigns eligible shifts, marks non-working states, checks gaps, undoes, generates suggestions, reviews and publishes — **in any planning unit**. |
| **Administrator** | Maintain the scheduling model | Everything a planner can, plus people, eligibility, shifts, day configurations, shift requirements, colors, holidays and comp-off policy. May force-publish, explicitly and audited. |

**There is no unit scoping of write access**
([ADR-0032](adr/0032-planning-unit-single-rule-axis.md)). The team is small and nobody edits
another team's rota without reason; the control is a **complete audit trail** — who
changed what, when, and what it was before — not a permission matrix. This removes
unit-scope claims and permission checks from the model entirely.

Two things had to become true for that argument to hold, and neither did until recently:
the trail has to name the person who actually acted
([ADR-0039](adr/0039-actor-identity-from-the-token.md)), and it has to cover everything,
not just assignments ([ADR-0040](adr/0040-one-change-history-for-every-entity.md)).

The only writes anyone is refused are to **another person's own record** — their presence,
their requests. That is not unit scoping returning by another door: it is a question
ADR-0032 never addressed, because self-service did not exist
([ADR-0046](adr/0046-routing-is-not-authorization.md)).

Identity comes from authenticated access rules, and the acting person is resolved from
the token rather than from anything the client sends
([ADR-0039](adr/0039-actor-identity-from-the-token.md)) — otherwise the audit trail this
model rests on would be forgeable by the people it constrains. Any in-app role switcher
is a development convenience and must not ship to ordinary users.

**Everyone is also an employee.** Recording where you are working and asking for leave is
available to every authenticated person, and is not a role
([ADR-0046](adr/0046-routing-is-not-authorization.md)): "can I edit my own record" is a
per-resource question.

**Roles are a set, granted per planning unit**
([ADR-0051](adr/0051-roles-are-a-scoped-set.md)): `Viewer`, `Planner`, `Approver`, `Admin`,
with **no ordering between them**. An Admin edits configuration and cannot assign shifts; a
Planner owns the rota and cannot approve leave; holding two grants both. A grant names a
unit, or is global. This narrows ADR-0032's "a planner may edit any unit" to a default
rather than a rule — the global grant is still there for the planner who genuinely covers
everywhere.

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
| Presence | Where someone physically works on a day — remote, an office, travel, a customer site. Orthogonal to whether they work at all ([ADR-0043](adr/0043-presence-is-an-orthogonal-range-entity.md)). |
| Request | Something a person asks for about themselves — leave, remote days, a desk. Routed to approvers and, once approved, written into the plan ([ADR-0045](adr/0045-generic-request-envelope-typed-materialization.md)). |
| Approval route | Whose inbox a request lands in, in what order. **Not** a permission — the policy decides who may act ([ADR-0046](adr/0046-routing-is-not-authorization.md)). |

## Scale

80 people, 4 planning units (3 regional + 1 cross-regional). That's small, and the technical consequences
are spelled out in [12-architecture.md](12-architecture.md): the whole quarter loads
into the browser at once, there's no server-side pagination, and no virtualization.

## History

An earlier corporate implementation of this product informed the original design —
real shift codes, coverage minimums, status vocabulary, and the draft/publish model all
trace back to it. That prototype's own spec document is gone from the repository
(Phase 0); the decision record now lives entirely in [adr/](adr/), which is the
authority on why the model looks the way it does, including every place the design
later diverged from that starting point (ADR-0015 onward, and especially
ADR-0032–0034 for the Phase 8 model change: Region deleted, one absolute-time Shift
entity, zero minimums legal).
