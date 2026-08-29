# Coverage and validation

## Coverage

Coverage is the comparison of actual assignments against the requirements of the day
configuration that applies to that date. It is computed, never stored by hand, and
recomputed after every draft change.

For one unit and date, per shift:

| Level | Condition | Meaning |
|---|---|---|
| `GAP` | filled < min | A hole. Shown and highlighted everywhere; does not block publication (ADR-0035). |
| `THIN` | filled == min, and min > 0 | Requirement met with zero slack. One absence breaks it. |
| `OK` | min < filled ≤ max | Healthy. |
| `OVER` | filled > max | Over-allocated. Warning, not a hole. |

`THIN` is a distinct state, not a shade of `OK`. "We are covered, but one sick day
away from not being" is the single most actionable signal for a planner and it
disappears if it's folded into green.

Only assignments whose shift has `countsAsCoverage` contribute. Non-working states never
satisfy a working-shift requirement. `ONCALL` shifts count toward their own requirements
only.

The snapshot also carries headcount, total required and total filled, so the grid can
show an aggregate `filled/required` per day alongside the per-shift detail.

## Validation levels

Three levels, which must not be blended
([ADR-0009](adr/0009-three-severity-levels.md)).

| Level | Examples | Behavior |
|---|---|---|
| **BLOCKING** | Double assignment; shift not in the person's unit; unknown shift | Publication is impossible. These are model violations, not policy — the only things that cannot be right under any decision ([ADR-0009](adr/0009-three-severity-levels.md), narrowed by [ADR-0024](adr/0024-conflicts-do-not-block.md), [ADR-0035](adr/0035-coverage-gap-does-not-block-publication.md), [ADR-0037](adr/0037-warnings-do-not-block-publication.md)). |
| **WARNING / CONFLICT** | Shift not in the person's eligibility; person assigned during their own absence; person assigned on a confirmed comp day; `max` exceeded; simultaneous-absence limit exceeded; minimum rest violated; weekend load over target; comp day with no valid slot | Shown and highlighted everywhere; acknowledging a conflict or warning with a comment writes a kept record, but it is not a precondition for publishing. |
| **INFO** | Coverage below `min` (gap); `THIN` coverage; preference violated; deviation from target shift share; comp day aging past the threshold; shift outside the day configuration | Highlighted, never blocking, never acknowledged. |

> **A gap is INFO, category `Gap`.** [ADR-0035](adr/0035-coverage-gap-does-not-block-publication.md)
> moved it out of the blocking tier: an unfilled shift is work not yet done, not data that
> is wrong. The *level* fell to INFO; the *category* stays `Gap`, which is what keeps it in
> its own bucket in the issues panel and its own counter everywhere else. Level and
> category are orthogonal, and this is the case that shows why.

> **`THIN` is INFO, not WARNING/GAP.** Running at exactly the minimum is the normal
> state of this rota, not a deviation — in the reference data it describes most days.
> The signal earns its keep as a colour in the coverage strip, where it answers "where
> is the slack" at a glance; it is not the same state as an unfilled minimum.

**Nothing but BLOCKING blocks.** A gap, a conflict, and an unacknowledged warning are
all decisions still to be made or already made in reality, not corrupt data — none of
them stand in the way of saving the rest of a valid draft. Acknowledging one with a
comment still writes a kept record; it is no longer what makes publication possible.
Six months later that record still answers "how often did we have to step outside the
rules, and why" — which is the argument for headcount.

## Gaps versus conflicts

Neither blocks publication, and the UI must still not merge them — they are fixed
differently:

- a **gap** is missing work — nobody is doing something that must be done;
- a **conflict** is invalid data — somebody is recorded doing something they cannot do.

A gap is fixed by assigning someone. A conflict is fixed by removing or correcting an
assignment. They belong in separate lists with separate badges.

## Issue shape

The validator is a pure function of a period and state, returning `Issue[]`:

```
Issue {
  key           stable across recomputations, so an acknowledgement survives
  level         BLOCKING | WARNING | INFO
  code          machine-readable rule id, for grouping and suppression
  category      GAP | CONFLICT | FAIRNESS | POLICY
  message       human-readable
  unitId
  date?, personId?, shiftId?      the anchor
  acknowledgement?
}
```

The anchor is what makes the issue list useful rather than decorative: clicking a row
jumps to the exact grid cell.

## Rules

1. A person cannot hold a shift they are not eligible for, unless an authorized override
   exists and is recorded.
2. **Exactly one assignment per person per date.** There is no split shift and no
   parallel duty; on-call is an ordinary shift code occupying the day. This is a hard
   constraint, not a soft rule.
3. Below `min` is a gap; above `max` is a warning.
4. Non-working states never satisfy a working-shift requirement.
5. Weekend-only shifts appear only on configured weekend dates.
6. Friday uses the Friday configuration, not the Monday–Thursday one.
7. Holiday applicability follows the person's location, not the planning unit.
8. Draft edits are never visible as published data before publication.
9. Publication with corrupt data (a double assignment, or a shift outside the person's
   unit) is blocked. Gaps and conflicts (shift not eligible, assigned during absence,
   assigned during comp day) do not block; acknowledging a conflict or warning is a
   kept, comment-carrying record, not a precondition.
10. A stale version produces a compare/refresh flow, never a silent overwrite.
11. Every comp day generated from weekend work keeps its link to the earning
    assignment.
12. An unknown imported code is a warning requiring mapping, never a silently accepted
    shift.
13. Dates always show weekday and date; times always show a timezone.
14. Every green/amber/red state carries text or an icon. Color alone is never the
    signal.

## Reading the list

The issue panel shows **findings, not rows**. A month of one unit produces a couple of
hundred issues, and "Cover understaffed" twelve times reads as twelve problems when it is
one: Cover, twelve days. Issues therefore collapse by (code, subject) — subject being the
shift, the person, or the unit — into a single line carrying the count and the date span,
which expands to the individual dates when someone decides to act on it.

The grouping rule is deliberately the same one `IssueDigest` applies server-side for the
plain-English summary (Docs/06). The panel and the summary have to be talking about the
same findings, or there is nothing to check the summary against.

## Acknowledgements

An acknowledgement is stored with the plan, not in UI state: a dismissed warning must
survive a reload and remain in the history. The stable `Issue.key` is what an
acknowledgement points at, so recomputation does not resurrect a settled warning or
silently transfer it to a different problem.
