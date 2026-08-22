# ADR-0033. One Shift entity carries an absolute window; ShiftDefinition is deleted

**Status:** accepted — **supersedes [ADR-0001](0001-role-carries-time.md) and [ADR-0018](0018-shift-distinct-from-role.md)**, narrowing [ADR-0016](0016-day-configuration-groups.md)

## Context

[ADR-0018](0018-shift-distinct-from-role.md) introduced two separate time-bearing concepts to capture the operational reality:

1. **ShiftRole** — what work is done that day, in a fixed timezone (the "duty window"). `Crew` is 09:00–18:00 America/Chicago, one absolute window.
2. **ShiftDefinition** — the person's contracted working window, independent of the role. A Pune engineer is on the "EMEA shift, 13:00–21:30 IST" and the "APAC shift, 06:30–15:00 IST" separately.

Phase 8 production data revealed a second defect: a Pune AMER employee had two disagreeing sources of working time.

| Entity | Window | Interpretation |
|---|---|---|
| `Person.ShiftDefinition` | 13:00–21:30 IST | EMEA shift (contracted) |
| `Assignment.RoleId → ShiftRole` | 09:00–18:00 CT → 19:30–04:30 IST | AMER role, converted to IST |
| Delta | 90 minutes |  **Off by one shift** |

The model allowed both to exist without requiring agreement. Neither was wrong in isolation, but they disagreed operationally.

## Decision

**Delete ShiftDefinition.** Keep **one entity, `Shift`**, carrying **one absolute time window** — a shift created as 11:00–20:00 New York is that same absolute interval for everyone holding it, with no location-specific bending.

```
Shift {
  id, unitId, code, label
  timeZone, start, end, crossesMidnight
  breakMinutes, countsAsCoverage, editableTime
  … (no location-specific override)
}

Person {
  defaultShiftId           pinned to one unit's shift
  … (no ShiftDefinition)
}
```

When a person needs to work at a contracted window (e.g., "Pune EMEA shift"), that is captured as `Person.defaultShiftId` — a pointer to a unit's shift. When auto-populate runs, it offers assignments in the person's default shift first, respecting their contracted hours.

## Consequences

- **Coverage, timeline, and person-roster context all use the same window** — no more question of which one wins. A person assigned to a shift works that shift's absolute interval, period.
- The 90-minute discrepancy cannot happen: one source of truth per shift, per person.
- Day-configuration `timingOverride` (ADR-0016) remains for the case where a shift runs at a different time on a specific day group (e.g., Friday has a different lead-shift window). That is an override within the same unit's rule set, not a separate definition.
- **Renaming side effects:** `ShiftRole` → `Shift`, `RoleEligibility` → `ShiftEligibility`, `Assignment.RoleId` → `Assignment.ShiftId`, `RoleRequirement` → `ShiftRequirement`, `/api/admin/roles` → `/api/admin/shifts`, `IssueCode.*Role*` → `IssueCode.*Shift*`.
- A person's "contracted window" is now visible only in their `defaultShiftId` assignment, not as a separate field. The People page displays it by dereferencing the shift to show the window, making the relationship explicit rather than implicit in field names.

## Alternatives considered

- **Keep both ShiftRole and ShiftDefinition, but require agreement.** Adds a validation check; does not simplify the model or make disagreement impossible if validation is bypassed during migration or data import.
- **Keep ShiftDefinition, make ShiftRole a subtype of it.** Conflates roles and contracted hours; the model still allows them to disagree.
- **Shift only, no contracted hours.** Loses the operational fact that a Pune person on the AMER roster is contracted to AMER hours, not APAC. Auto-populate loses the signal to prefer the person's contracted shift.
