# ADR-0007. A comp day is an accrual with a balance, not an event on the schedule

**Status:** accepted, with the placement mechanism amended

> **Amendment 1 — placement.** The original decision placed a comp day by a **fixed
> offset** per trigger day: Saturday −2, Sunday +2, holiday +3. That produces a wrong
> date whenever the target day is already occupied, excluded, or itself non-working.
> The real policy is a **search window**: `windowBeforeDays` / `windowAfterDays`, a
> list of excluded weekdays (Monday and Friday by default), and the **nearest** free
> eligible date, searching outward from the earned date and preferring days after at
> equal distance. When no valid date exists the entry becomes `PENDING_APPROVAL`
> rather than being dropped.
>
> The original offsets turn out to be a *consequence* of this policy rather than a
> competing rule: Saturday lands on the Thursday before (−2) and Sunday on the Tuesday
> after (+2), because everything between is a weekend or an excluded Monday or Friday.
> The fixed offsets were right for the common case and wrong the moment the day was
> occupied.
>
> **Amendment 2 — comp days do not expire.** The owner confirmed there is no expiry.
> `expiresOn` and the `EXPIRED` status are removed. Instead the policy carries a
> configurable `agingThresholdDays`; an entry still untaken past that age is flagged —
> an alert for the manager, and a standing "you have unused comp days" for the person.
> Age is measured from `earnedForDate`. The status set is
> `PROPOSED | SCHEDULED | TAKEN | DECLINED | PENDING_APPROVAL`.
>
> Everything else below stands. Full mechanics: [05-comp-days.md](../05-comp-days.md).

## Context

Time off for working a weekend or holiday is currently marked in a third place and
carried over by hand. A forgotten comp day means a person drops out of a shift
unexpectedly, with no warning to the planner. The temptation to model a comp day as
just another calendar absence is strong — and it loses the one thing that matters:
the unused balance.

## Decision

Two entities:

- `CompDayPolicy` on the planning unit: offsets by type of day worked (Saturday −2,
  Sunday +2, holiday +3) and an expiry period;
- `CompDayEntry`: which assignment it was earned for, the proposed date, the actual
  date, status `PROPOSED | SCHEDULED | TAKEN | EXPIRED | DECLINED`, expiry date, and a
  flag for whether it's been recorded in the corporate system.

Mechanics:

1. The planner assigns someone to a Saturday. The system checks that person's
   **location** calendar — Saturday is a day off, so a `CompDayEntry` is created with
   status `PROPOSED` and a date from the policy.
2. A tentative comp-day marker immediately appears on the schedule — light, dashed.
   The planner sees the consequence of their assignment in the same moment, not a
   week later.
3. The default day gets moved by dragging — in practice it almost always gets moved.
   The status changes to `SCHEDULED`, and the deviation from the default is recorded.
4. A confirmed comp day blocks assignment and counts toward coverage checks the same
   way a vacation does.
5. Unscheduled comp days sit in the person's balance.

**Accrual is a proposal, not a fact.** The planner confirms it. Otherwise a mistake in
the holiday calendar would quietly corrupt a balance — and that's money and
relationships with people.

## Consequences

- An accumulated 6 unused days becomes a visible management signal.
- Deleting an assignment should drop the linked accrual if it's still `PROPOSED`, and
  require an explicit decision if it's already `SCHEDULED`.
- A balance screen appears: accrued, taken, scheduled, expiring.
- The expiry period is an open question — see
  [10-open-questions.md](../10-open-questions.md).

## Alternatives considered

- **A comp day as a regular absence.** Loses the balance and the link to the
  assignment that earned it.
- **Auto-confirming accruals.** One mistake in the holiday calendar quietly corrupts
  people's pay-adjacent data.
