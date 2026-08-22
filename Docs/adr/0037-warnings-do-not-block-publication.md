# ADR-0037. Warnings do not block publication

**Status:** accepted

## Context

ADR-0009 put WARNING-level issues behind a publish gate: "soft rules never block; they
require an acknowledgement with a comment" — in practice, `canPublish` returned false
for any unacknowledged WARNING, and the Review dialog's Publish button stayed disabled
until every one of them was acknowledged with a written reason.

This was the last standing publish gate that wasn't about literally impossible data.
ADR-0024 already carved conflicts out of BLOCKING (a person coming in during their own
leave is a decision, not corrupt data). ADR-0035 did the same for coverage gaps (an
unfilled shift is a decision still to be made, not corrupt data). WARNING-level issues
— over-max coverage, assigned during a comp day, unavailable weekday, exceeding
consecutive-days or weekend-load limits — sit in exactly the same place: real signals
worth surfacing, not data the system has any business refusing to save.

In practice this meant a planner who assigned one person on their day off, or ran one
shift over its soft maximum, could not publish *any* draft change until they'd written
a justification for that one warning — even when the rest of the draft was uncontested.
Owner review: this stops the planner over things that don't need stopping for.

## Decision

**`CanPublish` only checks for BLOCKING.** Acknowledgement — the "why are we stepping
outside the rule" comment (`IssuePanel.tsx`) — remains exactly as it was: still
available, still writes a record with the acknowledger and their reason, still visible
in the issue's history. It simply stops being a precondition for publishing.

```
CanPublish(issues) = !issues.Any(i => i.Level == Blocking)
```

The only two things left that can block a publish are the two ADR-0009 already named
as impossible under any decision: a double assignment, and a shift that doesn't exist
or belongs to another unit.

## Consequences

- `Validator.CanPublish` (C#) and `canPublish` (TS, `engine/issues.ts`) drop their
  `acknowledged` parameter — acknowledgement state is no longer an input to the
  publish decision, only to `Summarize`'s `UnacknowledgedWarnings` count and to the
  issue panel's checkmark.
- `ReviewDialog`'s "unacknowledged warnings" chip changes tone from `bad` (implying a
  blocker) to `warn` (a count worth noticing, not a rejection reason). The "not
  publishable" message under the change list now only ever names the double-assignment
  / wrong-shift case, because that's the only case left that can produce it.
- `IssuePanel`'s WARNING bucket hint drops "needs an acknowledgement with a comment"
  (which read as a requirement) for language that says the comment is worth writing
  but never blocks.
- Nothing changes about what triggers a WARNING, what `acknowledge()` does, or how the
  audit trail reads six months later — "how often did we have to break the rule, and
  why" is still answered the same way. Only the gate is gone.

## Alternatives considered

- **Keep blocking only for warnings created or worsened by the current draft**, same
  shape as an alternative considered and rejected for ADR-0035: still needs a
  before/after diff per issue, and still blocks a planner on an unrelated pre-existing
  warning they didn't create.
- **Make acknowledgement optional but keep the button disabled without it, with a
  "publish anyway" override.** Same objection as ADR-0035's rejected override: an extra
  click every time is functionally a bigger version of the same friction, not a
  removal of it.
