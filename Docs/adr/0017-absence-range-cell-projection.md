# ADR-0017. Absence is a range; the grid cell is a projection

**Status:** the range-and-projection half stands. Its **roster markers are deleted** by
[ADR-0052](0052-two-flows-drafts-for-shifts-approval-for-everything-else.md) — "`0` ≠
blank" recorded a distinction nobody used, and what people actually wanted is the
`UNAVAILABLE` event type. Absence types were already generalised by ADR-0049.

> **Amendment.** `TRAINING` is **not** an absence type. In-hours training and other
> engineering activity is the `Cover` role — the person is at work and counts toward
> coverage. `AbsenceType` is `VACATION | SICK | OTHER`. A `Training` value in a
> historical spreadsheet therefore imports as the `Cover` role, not as leave, which
> changes the coverage arithmetic for those days.
>
> The prototype flagged `Training` and `sick` as an unresolved modeling question; this
> resolves it.

## Context

The source spreadsheets put working roles and non-working statuses in the same cell:
`Crew`, `Off`, `0`, `PH`, `Comp-Off`, `Training`, `sick`, `W-Off`. A planner thinks in
cells, and the assignment picker offers Roles and Non-working in one dropdown.

Two models compete.

**Status in the cell** (what the prototype does): one `Assignment` per person and date
whose code may be a role or a status. Matches the spreadsheet and the import exactly.
But a two-week vacation becomes fourteen rows with no entity representing "the
vacation", and the simultaneous-absence limits — which are inherently about overlapping
ranges — have to be reconstructed by scanning days.

**Absence as a range** (the original model here): a separate entity with `from`/`to`.
Right for the leave import, which arrives as ranges, and right for capacity rules. But
it has no answer for `Off` and `0`, which are roster decisions rather than leave, and it
leaves the grid needing to merge two sources per cell anyway.

The prototype itself flagged this as unresolved: "`sick`, `Training` and other
non-working codes need an explicit status model or a documented extensible-code
policy".

## Decision

Both, with an explicit projection between them.

**Source of truth, by kind of fact:**

- `Absence { personId, type, from, to, source }` — real leave: `VACATION`, `SICK`,
  `TRAINING`, `UNPAID`, `OTHER`. Ranges, because that is what they are and what the HR
  export contains.
- `Assignment { personId, date, content }` where content is either
  `{ kind: 'ROLE', roleId }` or `{ kind: 'MARKER', marker: 'OFF' | 'NOT_SCHEDULED' }` —
  roster decisions, per day.
- `CompDayEntry` — an accrual with its own lifecycle
  ([ADR-0007](0007-comp-day-as-balance.md)).
- `Holiday` — a date plus affected locations, independent of who works.

**Projection.** A pure function produces one `CellValue` per (person, date) with a
fixed precedence:

1. an `Assignment` with a working role — someone can be scheduled on a holiday or a
   weekend, and that must win over any non-working signal;
2. an `Absence` covering the date;
3. a `CompDayEntry` that is `SCHEDULED` or `TAKEN`;
4. a `Holiday` affecting the person's location → `PH`;
5. an `Assignment` marker → `OFF` / `NOT_SCHEDULED`;
6. otherwise `EMPTY`.

When rule 1 fires and 2, 3 or 4 would also have fired, the cell carries a **conflict**.

Setting a non-working status from the picker creates the right entity for the meaning:
`Off` and `0` create markers; `Leave`, `Sick` and `Training` create a one-day `Absence`
that can later be extended; `Comp-Off` schedules a `CompDayEntry`.

## Consequences

- `0` and blank stay distinct: `NOT_SCHEDULED` is an explicit decision, `EMPTY` is the
  absence of one. The spreadsheet distinguishes these and so must the product.
- Capacity rules and the absence import work on ranges, unchanged.
- The grid, the coverage engine and the export all read one projection, so precedence
  is defined in exactly one place instead of being re-derived per view.
- Cost: an extra layer between storage and render, and a bulk range edit has to know
  which entity it is creating.
- Import maps each source code to the right entity rather than to a single code column.

## Alternatives considered

- **Status in the cell only.** Loses the vacation as an entity; makes capacity limits
  and HR sync awkward.
- **Range-only, with `Off` as a one-day absence.** Conflates a rostered day off with
  leave. They mean different things to a person and to a fairness calculation.
