# ADR-0018. A shift is a person's contracted window; a role carries the duty window

**Status:** accepted — amends [ADR-0001](0001-role-carries-time.md)

## Context

[ADR-0001](0001-role-carries-time.md) established that a role carries its own time in a
fixed timezone. The real data confirms it: `Crew` is documented as
"09:00–18:00 CT / 10:00–19:00 ET", which is one absolute window rendered in two
locations.

But the same data also carries a second time-bearing concept the model had no place
for. People are described as being on the "Pune EMEA shift, 13:00–21:30 IST" or the
"Pune APAC shift, 06:30–15:00 IST". That is not a role — it is the window the person is
contracted to work, and it stays the same whichever role they hold that day.

Collapsing the two loses information. A Pune engineer on the EMEA shift who covers `BM`
one day and `E` the next is on the same contracted hours both days.

## Decision

Two separate concepts.

```
ShiftDefinition {          a person attribute
  regionId, code, name
  timeZone, start, end, breakMinutes
}

ShiftRole {                what is done that day
  regionId, code, label
  timeZone, start, end, crossesMidnight, breakMinutes
}
```

- `Person.defaultShiftId` records the contracted window. It appears in the People
  table, in grid row tooltips, and as a grouping dimension.
- The **role window drives coverage, the timeline and the ICS export**. ADR-0001 is
  unchanged in that respect.
- A day-group `timingOverride` on a role requirement handles the case where a role runs
  at a different time on Friday.
- Where a role has no explicit window, the person's shift window applies.

## Consequences

- The People screen can show "Shift" as a real column rather than deriving something
  approximate from roles.
- Net hours are computable per person from the shift, and per duty from the role.
  `breakMinutes` lives on both; the AMER weekday pattern carries 60 minutes, and paid
  hours must not be inferred from start and end alone.
- Rows can be grouped by shift where that is more useful than location.
- Cost: two windows exist for the same person on the same day, and the UI must be clear
  about which one it is showing. The rule is: **coverage and timelines show role time;
  People and roster context show shift time.**

## Alternatives considered

- **Shift only, roles as untimed labels.** Breaks the handover model — the whole point
  of `Lead` is that the EMEA handover happens at a specific time, independent of who
  holds it.
- **Role only** (the original model). Cannot express a person's contracted hours, which
  the roster genuinely tracks and reports on.
