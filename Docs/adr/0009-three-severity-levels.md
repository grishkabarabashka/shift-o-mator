# ADR-0009. Three validation levels; soft rules don't block

**Status:** accepted, narrowed three times — by
[ADR-0024](0024-conflicts-do-not-block.md) (a conflict is acknowledged, not blocked),
[ADR-0035](0035-coverage-gap-does-not-block-publication.md) (a gap is INFO and does not
block) and [ADR-0037](0037-warnings-do-not-block-publication.md) (an unacknowledged
warning does not block). What remains of the publish gate is exactly two things: a double
assignment, and an unknown or wrong-unit shift.

> **Extension.** Two additions from the validated prototype:
>
> 1. **Gap and conflict are separate categories** within `BLOCKING`. A gap is missing
>    work — nobody is doing something that must be done. A conflict is invalid data —
>    somebody is recorded doing something they cannot do. They are fixed differently
>    and are listed separately in the UI.
> 2. **`THIN` is a distinct coverage state**, not a shade of OK: the minimum is met
>    with zero slack. It is the most actionable signal a planner gets and it disappears
>    if folded into green.
>
> See [04-coverage-and-validation.md](../04-coverage-and-validation.md).

## Context

If every rule is hard, the planner hits a wall on the first unusual day and goes back
to Excel. If every rule is soft, coverage gaps ship to production.

## Decision

| Level | Meaning | Behavior |
|---|---|---|
| **BLOCKING** | `min` coverage not met; person assigned during an absence; double assignment; role not eligible for this person | publishing is impossible |
| **WARNING** | below `target`; simultaneous-absence limit exceeded; too many weekends; minimum rest violated; a role pool is exhausted | requires a deliberate acknowledgement with a comment |
| **INFO** | preferences violated; deviation from target role share; an expiring comp day | highlighted, not blocking |

## Consequences

- `WARNING` acknowledgements are stored with the plan, not in UI state: a dismissed
  warning survives a page reload and stays in the history.
- Six months later you can see how many times and why the team had to step outside
  the rules — a ready-made argument for a headcount conversation.
- The validator is a pure function returning `Issue[]` with anchors (date, person,
  role), so a click in the side panel jumps to the specific grid cell.
- Severity is fixed per rule, not a user setting: otherwise everything quickly becomes
  INFO.

## Alternatives considered

- **Two levels (error / warning).** INFO-grade signals like preferences would drown
  among warnings and stop being read.
- **Configurable severity per rule.** A guaranteed path to disabling everything that's
  inconvenient.
