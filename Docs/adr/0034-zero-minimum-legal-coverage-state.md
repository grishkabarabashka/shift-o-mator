# ADR-0034. Zero minimums are a legal coverage state

**Status:** accepted

## Context

A `DayConfiguration` carries `ShiftRequirement` entries for the shifts that apply to a group of days, each with `min` (hard requirement below which is a gap) and optional `max` (above which is a warning).

The design has always assumed `min ≥ 1` for requirements that actually matter. But Service Transition (now `unit-st`) carries shifts that are genuinely *optional* — `ST:AMER`, `ST:EMEA`, `ST:APAC` are available for coverage when needed, not required every day.

In Phase 8, `unit-st` was built with all its shift requirements at `min=0`. This was intentional: the owner confirmed that a unit may carry shifts with no coverage obligation. **This must never render as a gap** — a cell showing 0 of 0 is not understaffed; it is working as intended.

## Decision

**A `min=0` requirement is a legal, binding state, not an error or a default that got left in.**

```
DayConfiguration {
  shifts: [
    { shiftId: 'ST:AMER', min: 0, max: ∞, isDefault: false },
    // Zero staffing is neither a gap nor a violation.
  ]
}
```

The coverage engine must:
- Never report a gap when actual count equals requirement, even if both are 0.
- Never report "thin" coverage for a 0-minimum shift.
- Accept 0 as a valid value in the coverage state machine.

The UI must represent zero-minimum shifts correctly:
- Do not show a zero-minimum cell as red (gap), yellow (thin), or any alert state.
- If a 0-minimum shift has staff assigned, it is counted as "over" or "ok" depending on `max`, not as a violation.

## Consequences

- An entire unit (Service Transition) can operate with no hard coverage obligations.
- Adding a new shift type that is purely optional (e.g., "On-call shadow" with zero baseline requirement) requires only configuration, not special-case code.
- A regression-test invariant: `A_zero_minimum_never_produces_a_coverage_gap_or_thin_issue` must pass.
- The coverage snapshot never contains a gap row for a 0-minimum shift, even if that shift is part of the day configuration.

## Alternatives considered

- **Treat 0-minimum shifts as "not in the requirement set."** Requires omitting them from DayConfigurations, which then cannot track whether they are available on that day. Makes the optional-shift concept implicit rather than explicit.
- **Make 0-minimum an error and rebuild unit-st with min=1.** Does not align with the owner's decision and creates artificial gaps on Service Transition days.
