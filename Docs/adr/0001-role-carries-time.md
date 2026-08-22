# ADR-0001. A role carries its own time

**Status:** accepted — amended by
[ADR-0018](0018-shift-distinct-from-role.md), which adds a person's contracted shift
window as a separate concept. Role time still drives coverage, timelines and exports.

## Context

In the current spreadsheet, a shift code (`SL`, `BATCH LATE`) carries no time
information. Knowledge of "which code means which window" exists only in planners'
heads. A new hire can't plan without a mentor, and answering "who's on shift right
now" without mental timezone math is impossible.

## Decision

`ShiftRole` stores `timeZone`, `start`, `end`, `crossesMidnight`. The window is
defined in the role's fixed timezone — not the person's timezone, and not a UTC
offset.

Shift lead in Americas is a New York window, because the handoff between regions
happens at a specific time. A person in Pune assigned to this role works that New
York window; for them it's a night shift, and the system computes that on its own.

Overrides are possible at two levels: personal (this person's window for this role is
always an hour later) and one-off (on a specific day). Both are visibly flagged in the
UI.

## Consequences

- Assigning a person to a role fully determines the shift interval — coverage
  computation and the timeline become trivial.
- Storing the window as local time in a named timezone gives correct behavior across
  DST transitions: when the US switches to daylight saving time, a Pune person's
  shift shifts automatically.
- The assignment date is interpreted in the role's timezone — this removes ambiguity
  for shifts that cross midnight.
- This requires discipline in date handling — see
  [ADR-0002](0002-location-is-calendar-only.md) and
  [02-time.md](../02-time.md).

## Alternatives considered

- **A window in UTC offset.** Breaks twice a year on DST transitions.
- **A window in the person's local time.** Defeats the purpose of a handoff: two
  people on the same role from different locations would work at different times.
  This seems needed for service transition, but there the problem is solved by a set
  of roles — `ST_AMER` / `ST_EMEA` / `ST_APAC` — each with its own window: one branch
  instead of two.
