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

**Roles are a set, granted per planning unit, with no ordering between them**
([ADR-0051](adr/0051-roles-are-a-scoped-set.md)). Holding two grants both; a grant names a
unit, or is global — and global widens *scope*, never *privilege*. Grants live in the
database, edited on Settings → Roles, because planning units are ours and no directory
knows them. [16-workflows.md](16-workflows.md) is the authority on which role each step of
each workflow needs.

| Role | What they need | Product behavior | Cannot |
|---|---|---|---|
| **Viewer** | Understand coverage, find personal duties, ask for things | Reads published data, picks a display timezone, browses Overview / Schedule / People / My calendar / Requests. Records **their own** presence, raises **their own** requests, places **their own** comp days, reads any cell's history. **Everyone signed in holds it.** | Touch anybody else's row |
| **Planner** | Build and maintain a valid rota | Opens a draft, paints eligible shifts, watches gaps and issues, undoes, generates suggestions, reviews and publishes — in the units they hold it for. Records presence and raises requests on behalf of their unit's people | **Approve anything**, including leave they raised themselves |
| **Approver** | Decide what people ask for | Decides requests raised by people in the units they hold it for; an approval writes the real `Absence` or `PresenceRecord` | Touch the rota |
| **Admin** | Maintain the scheduling model | People, eligibility, shifts, day configurations, requirements, colors, event and presence types, holidays, comp-off policy and role grants, in the units they hold it for. A **global** grant also covers what belongs to no unit — locations, holidays, units — and Settings → Maintenance | **Assign shifts** |

An Admin being unable to plan is the point, not an oversight: policies used to compare
roles by ordinal, so `Admin > Planner` made every administrator a planner of every unit —
a right nobody granted and nobody could withhold.

**What happened to "no unit scoping".** [ADR-0032](adr/0032-planning-unit-single-rule-axis.md)
removed unit-scope claims from the model entirely, on the argument that the team is small
and the control is a **complete audit trail** — who changed what, when, and what it was
before — rather than a permission matrix. That argument held for the rota and stopped
holding once approvals existed: whose leave you may sign off is not a question an audit
trail answers after the fact. ADR-0051 therefore scoped the grant to a unit and kept the
global grant for the planner who genuinely covers everywhere. The audit trail is still
load-bearing, and two things had to become true for it to be: it has to name the person
who actually acted ([ADR-0039](adr/0039-actor-identity-from-the-token.md)), and it has to
cover everything, not just assignments
([ADR-0040](adr/0040-one-change-history-for-every-entity.md)).

Identity comes from the token, never from anything the client sends
([ADR-0039](adr/0039-actor-identity-from-the-token.md)) — otherwise the audit trail this
model rests on would be forgeable by the people it constrains. A real sign-in is Entra ID,
linked to a person by their work email, by hand
([ADR-0058](adr/0058-entra-id-identity-is-linked-by-email.md)); the in-app identity
switcher exists only in stub mode, picks a **person** and never a role, and is gated on the
server saying it is in stub mode.

**Everyone is also an employee.** Recording where you are working and asking for leave is
available to every authenticated person and is not a role
([ADR-0046](adr/0046-routing-is-not-authorization.md)): "can I edit my own record" is a
per-resource question, answered by `subjectPersonId == principal.personId`.

**And approval is a property of the thing, not of who asks.** A planner recording leave on
somebody else's row raises a request like anybody else; `EventType.requiresApproval` and
`PresenceType.requiresApproval` decide, and the server enforces it
([ADR-0052](adr/0052-two-flows-drafts-for-shifts-approval-for-everything-else.md)).

## Vocabulary

| Term | Meaning |
|---|---|
| Published schedule | The authoritative rota visible to everyone. |
| Draft | A private set of proposed changes owned by a planner for a unit and period. |
| Planning unit | A scheduling and **planning** boundary (`unit-amer`, `unit-emea`, `unit-apac`, `unit-st`). Owns all rules that apply: shifts, requirements, policies and comp-off policy. Defines whose screen a person appears on (a default filter, not a permission boundary). |
| Shift | Work performed that day: `Lead`, `Crew`, `E`, `BM`, `M`, `Primary`, `ST:AMER`. `Cover` is engineering work, including in-hours training. Shifts belong to a planning unit and carry an absolute time window. |
| Event type | A kind of time off, as a row rather than an enum arm — vacation, sick, floating holiday, `UNAVAILABLE`. Its columns (`blocksAssignment`, `countsTowardCapacity`, `requiresApproval`, `allowsHalfDay`) are the behaviour ([ADR-0049](adr/0049-event-types-are-data.md)). |
| Presence type | A way of working, as a row — office, remote, travel, a customer site, anything an admin adds. `namesALocation` says whether it points at a `Location`; `countsAs` (`OnSite`, `Remote`, `Away`) is the only thing the coverage strip counts ([ADR-0054](adr/0054-presence-types-are-an-open-set.md)). |
| Portion | `FULL`, `MORNING` or `AFTERNOON` on an absence or a presence record. Never a time — coverage stays whole-day ([ADR-0050](adr/0050-one-grid-half-days-and-the-split-cell.md)). |
| Status | The resolved non-working state of a cell: `PH`, `Comp-Off`, or an absence carrying its event type. The `Off` / `0` roster markers are deleted; an empty cell means no shift, and "do not schedule me" is the `UNAVAILABLE` event type ([ADR-0052](adr/0052-two-flows-drafts-for-shifts-approval-for-everything-else.md)). |
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
| Approver | Who a request goes to: the `Approver`s of the subject's planning unit, falling through to admins when a unit has none. `ApprovalRoute` and multi-step approval are **deleted** — routing is the grant ([ADR-0051](adr/0051-roles-are-a-scoped-set.md)). |
| Layer | What the grid draws — Shifts / Time off / Presence / Requests — toggled in the toolbar and masked at render, never in the projection ([ADR-0050](adr/0050-one-grid-half-days-and-the-split-cell.md)). |
| Setup | The one-time choice a fresh database asks for: **Bare** or **Demo**. `SystemSetup` is the row that records it, and its absence is what the gate refuses on ([ADR-0059](adr/0059-setup-is-a-screen-not-a-flag.md)). |

## What a system starts as

A fresh database has no content and says so: everything except `/health/*`,
`/api/setup/*` and the OpenAPI document answers `503 SETUP_REQUIRED`, and the browser
shows a first-run wizard ([ADR-0059](adr/0059-setup-is-a-screen-not-a-flag.md)). It offers
**Bare** — one location, one planning unit, and the caller from their own token as the
global Admin — or **Demo**, the fixture entire. Afterwards Settings → Maintenance carries
the same two operations. There is no configuration key that decides content, and there must
not be one again.

Deployment is two container images and a Helm chart on AKS: SQL and the optional model are
both reached by workload identity, which is why neither environment needs a Key Vault
([ADR-0060](adr/0060-the-model-is-a-deployment-not-a-vendor.md)). The operator guide is
[../deploy/README.md](../deploy/README.md).

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
