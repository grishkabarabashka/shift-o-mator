# Coverage and validation

## Coverage

Coverage is the comparison of actual assignments against the requirements of the day
configuration that applies to that date. It is computed, never stored by hand, and
recomputed after every draft change.

For one unit and date, per shift:

| Level | Condition | Meaning |
|---|---|---|
| `GAP` | filled < min | A hole. Blocks publication. |
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
| **BLOCKING** | Coverage below `min` (gap); double assignment; shift not in the person's unit; unknown shift | Publication is impossible. These are model violations, not policy. |
| **WARNING / CONFLICT** | Shift not in the person's eligibility; person assigned during their own absence; person assigned on a confirmed comp day; `max` exceeded; simultaneous-absence limit exceeded; minimum rest violated; weekend load over target; comp day with no valid slot | Requires a deliberate acknowledgement with a comment before publication. Conflicts are decisions, not invalid data — a person may work during their leave, and an eligible override is recorded. |
| **INFO** | `THIN` coverage; preference violated; deviation from target shift share; comp day aging past the threshold; shift outside the day configuration | Highlighted, never blocking. |

> **`THIN` is INFO, not WARNING.** Running at exactly the minimum is the normal
> state of this rota, not a deviation — in the reference data it describes most days.
> Treating it as a warning would demand a written justification for roughly a hundred
> cells per month and make publication effectively impossible. The signal earns its
> keep as a colour in the coverage strip, where it answers "where is the slack" at a
> glance; it does not earn a blocker.

**Soft rules do not block.** In reality they are sometimes broken deliberately, and the
system must not stand in the way. It shows the issue, demands an acknowledgement with a
comment, and remembers it. Six months later that record answers "how often did we have
to step outside the rules, and why" — which is the argument for headcount.

## Gaps versus conflicts

Both are `BLOCKING`, and the UI must not merge them:

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
  regionId
  date?, personId?, roleId?      the anchor
  acknowledgement?
}
```

The anchor is what makes the issue list useful rather than decorative: clicking a row
jumps to the exact grid cell.

## Rules

1. A person cannot hold a role they are not eligible for, unless an authorized override
   exists and is recorded.
2. **Exactly one assignment per person per date.** There is no split shift and no
   parallel duty; on-call is an ordinary role code occupying the day. This is a hard
   constraint, not a soft rule.
3. Below `min` is a gap; above `max` is a warning.
4. Non-working states never satisfy a working-role requirement.
5. Weekend-only roles appear only on configured weekend dates.
6. Friday uses the Friday configuration, not the Monday–Thursday one.
7. Holiday applicability follows the person's location, not the region.
8. Draft edits are never visible as published data before publication.
9. Publication with unresolved gaps or corrupt data is blocked. Conflicts (role not
   eligible, assigned during absence, assigned during comp day) require acknowledgement
   but do not block. An Admin force on a gap is explicit and audited.
10. A stale version produces a compare/refresh flow, never a silent overwrite.
11. Every comp day generated from weekend work keeps its link to the earning
    assignment.
12. An unknown imported code is a warning requiring mapping, never a silently accepted
    role.
13. Dates always show weekday and date; times always show a timezone.
14. Every green/amber/red state carries text or an icon. Color alone is never the
    signal.

## Acknowledgements

An acknowledgement is stored with the plan, not in UI state: a dismissed warning must
survive a reload and remain in the history. The stable `Issue.key` is what an
acknowledgement points at, so recomputation does not resurrect a settled warning or
silently transfer it to a different problem.
