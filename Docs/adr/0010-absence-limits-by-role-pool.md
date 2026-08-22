# ADR-0010. Absence limits apply both unit-wide and per role pool

**Status:** accepted

## Context

The rule "no more than three on long leave, no more than four on short leave" lives
in people's heads; everyone checks who's already out. Every summer this regularly
leads to last-minute scrambling to cover shifts.

But an overall count of absent people by unit misses the main case.

## Decision

`AbsenceCapacityRule` has `scope: UNIT | ROLE_POOL(roleId)` and
`durationBucket: SHORT | LONG` with a threshold in workdays.

```
AbsenceCapacityRule {
  unitId
  scope: UNIT | ROLE_POOL(roleId)
  durationBucket: SHORT | LONG
  longThresholdWorkdays: 5
  maxConcurrent
  countsTypes: [VACATION, COMP_DAY, TRAINING]
}
```

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
