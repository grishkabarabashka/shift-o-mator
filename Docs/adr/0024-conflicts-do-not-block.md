# ADR-0024. A conflict is acknowledged, not blocked

**Status:** accepted — amends [ADR-0009](0009-three-severity-levels.md)

## Context

ADR-0009 put five checks at `BLOCKING`: double assignment, unknown or
out-of-region role, role outside eligibility, assignment during an absence, and
assignment on a confirmed comp day. It called them all "invalid data".

Three of them are not invalid data. They are decisions:

- somebody comes in during their own leave, or the leave record is stale;
- a role goes to someone outside their eligibility because it is 03:00 and the
  person who is eligible is not answering;
- a comp day is moved because the week changed.

The prototype spec already conceded the point for eligibility — rule 1 permits
the assignment "unless an authorized override exists and is recorded". An
acknowledgement with a comment *is* that record.

The same ADR-0009 states the principle this violates: "Soft rules do not block.
In reality they are sometimes broken deliberately, and the system must not stand
in the way." Conflicts were being held to a different standard than every other
rule for no reason other than the label on them.

The practical damage was worse than a blocked publish. The grid's edit path
silently discarded any assignment onto a cell the projection considered blocked:
the planner right-clicked, chose a role, and nothing happened — the same
invisible-failure defect as [ADR-0023](0023-editing-arms-itself.md), one layer
down.

## Decision

**Conflicts are recorded, highlighted and acknowledged. They do not block.**

`WARNING` / `CONFLICT`, requiring an acknowledgement with a comment before
publication:

- `ROLE_NOT_ELIGIBLE`
- `ASSIGNED_DURING_ABSENCE`
- `ASSIGNED_DURING_COMP_DAY`

`BLOCKING` / `CONFLICT`, because no decision can make them true:

- `DOUBLE_ASSIGNMENT` — one assignment per (person, date) is a hard constraint
  of the model, not a policy;
- `ROLE_OUTSIDE_REGION` and an unknown role — corrupt data, reachable only
  through import.

Consequently:

- the grid applies the edit and lets the validator speak, rather than dropping
  it. The one exception is drag-painting, which still skips blocked cells: a
  mouse slip across twenty rows is not a decision;
- the assignment picker no longer disables anything. It warns *before* the
  click ("On leave — assigning is allowed and will be flagged as a conflict")
  and offers the region's other roles behind a disclosure;
- `Issue.category` now drives the issue list's grouping ahead of `level`, so
  conflicts keep their own list. A gap is fixed by finding somebody; a conflict
  is fixed by removing an assignment. Merging them would undo what ADR-0009 got
  right.

## Consequences

- Publication is blocked only by gaps and by corrupt data. Everything else is a
  conversation the plan carries with it.
- The acknowledgement log becomes the interesting artifact: six months of "who
  worked during their leave, and why" is the evidence for a headcount argument.
  Blocking produced no such record — planners simply deleted the absence.
- `summarizeIssues` counts conflicts by category rather than by level, so the
  count does not silently drop to zero.
- **Cost:** it is now possible to publish a schedule with somebody rostered
  during their holiday. That is the intended trade: the system reports reality
  instead of forbidding it, and the comment says who decided.

## Alternatives considered

- **Keep conflicts blocking, allow the edit.** The planner could make the
  change and then be unable to publish anything until they undid it. Worse than
  both alternatives — it wastes the work and still gives no way through.
- **Add an explicit "override" flag on the assignment.** A second mechanism
  with the same meaning as an acknowledgement, needing its own storage, its own
  audit and its own UI. The acknowledgement already carries a comment, an
  author and a timestamp against a stable issue key.
