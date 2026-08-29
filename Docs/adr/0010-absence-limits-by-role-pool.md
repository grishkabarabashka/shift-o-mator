# ADR-0010. Absence limits apply both unit-wide and per role pool

**Status:** accepted — scope updated by
[ADR-0032](0032-planning-unit-single-rule-axis.md) (per **unit** and per **shift** pool,
not region and role). This ADR assumes the limit is checked when leave is *approved*;
there was no approval anywhere in the product until
[ADR-0047](0047-absorb-the-self-service-portal.md), so until then the check only ever ran
at plan time.

## Context

The rule "no more than three on long leave, no more than four on short leave" lives
in people's heads; everyone checks who's already out. Every summer this regularly
leads to last-minute scrambling to cover shifts.

But an overall count of absent people by unit misses the main case.

## Decision

`AbsenceCapacityRule` has `scope: UNIT | SHIFT_POOL(shiftId)` and
`durationBucket: SHORT | LONG` with a threshold in workdays.

```
AbsenceCapacityRule {
  unitId
  scope: UNIT | SHIFT_POOL(shiftId)
  durationBucket: SHORT | LONG
  longThresholdWorkdays: 5
  maxConcurrent
  countsTypes: [VACATION, ...]
  countsCompDays: bool
}
```

> **As shipped.** Written as `ROLE_POOL(roleId)`; roles and shifts were collapsed into
> one entity by [ADR-0033](0033-one-shift-entity-absolute-window.md), so the scope is
> `SHIFT_POOL(shiftId)`. The original also listed `TRAINING` among `countsTypes`, which
> [ADR-0017](0017-absence-range-cell-projection.md) removed — in-hours training is the
> `Cover` shift and counts toward coverage, so it is not an absence at all. Comp days are
> counted by their own flag rather than by being an absence type.

## Consequences

- Three people on vacation isn't a problem. Three out of the four people who can be
  shift lead is a problem, and a regular leave system will never catch it. This rule
  gives the biggest practical payoff.
- The check runs not at shift-planning time but earlier — when a vacation is
  approved — and lives on the absence overview screen as a second ribbon.
- A person counts toward every pool whose role is in their eligibility — the counters
  overlap, and that's correct.
- Exceeding the limit is a `WARNING`: reality sometimes requires breaking it.

## Alternatives considered

- **A unit-wide limit only.** Doesn't see a scarce skill being drained — exactly what
  breaks planning every summer.
