# ADR-0016. Day configurations carry role sets, not just minimums

**Status:** accepted — amends [ADR-0008](0008-events-are-dated-coverage-rules.md)

## Context

The original model had one role set per region and a `CoverageRule` per role with
`appliesTo: WEEKDAY | WEEKEND | HOLIDAY | DATE`. That expresses "this role needs more
people on a weekday than at the weekend".

It cannot express what the real rota does. AMER Monday–Thursday runs `Lead`, `Crew`,
`Crew-BC`, `Batch-E`, `Batch-L`, `Batch-U`, `Cover`. AMER **Friday** runs `Lead-E`,
`Crew-E`, `Crew-L`, `Batch-E`, `Batch-L`. `Lead` and `Lead-E` are different roles with
different windows and different duties — not the same role with a different minimum.

The same applies to the weekend, which runs `Primary`, `Secondary`, `ST`, `Shadow` —
roles that exist on no other day.

## Decision

Introduce a `DayConfiguration` owned by the region:

```
DayConfiguration {
  regionId
  key            'weekday' | 'friday' | 'weekend' | 'holiday' | 'date'
  weekdays[]     for weekday-style groups
  date?, label?  for a one-off group
  roleRequirements[]   { roleId, min, max?, isDefault, timingOverride? }
}
```

Resolution for a date, most specific first: `date` → `holiday` → `weekend` → the
weekday group containing that weekday.

A role that appears in no configuration for a date is not offered in that cell's picker
and generates no requirement.

## Consequences

- The assignment picker can honor "only roles in that day's configuration for which
  this person is eligible" — which is what the design always specified and the flat
  model could not deliver.
- `CoverageRule.appliesTo` disappears; it becomes the `key` of a day configuration.
- ADR-0008 still holds: an event is a dated configuration. It is now a
  `DayConfiguration` with a `date` and a `label` rather than a special rule type.
- A weekday must belong to exactly one weekday-style group. Settings validates this.
- Replacing a region's day configuration is atomic — a half-applied configuration would
  silently misinterpret coverage.
- Per-day-group `timingOverride` covers the case where a role runs at a different time
  on Friday without becoming a different role.

## Alternatives considered

- **A role per day group with duplicated codes.** `Lead` and `Lead-Friday` as separate
  roles with separate requirements. Works, but explodes the role catalog and makes
  cross-day fairness reporting ("how often does this person lead") require manual
  grouping.
- **Keep the flat model and treat Friday as a dated exception.** Would need 52 dated
  rules a year, maintained by hand.
