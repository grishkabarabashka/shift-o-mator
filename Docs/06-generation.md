# Rotation, suggestions and auto-generation

Three related capabilities on one engine: rank candidates for a shift on a date, fill
one gap, or fill a whole period.

## Candidate ordering

The ordering below comes from the validated prototype and is the shared basis for
Suggest and Auto-populate:

1. **Eligibility** — the shift is in the person's eligibility list.
2. **Availability** — not on leave, not a confirmed comp day, not a blackout date, the
   weekday is in their availability, and they hold no conflicting duty that day.
3. **Fairness over 90 days** — fewest assignments of this shift in the trailing 90 days
   first.
4. **Recency** — the most recent holder of this shift is pushed down.
5. **Personal targets** — `maxWeekendsPerQuarter` and `maxPerWeek` push a person down
   or out.

Steps 1 and 2 are hard filters. Steps 3–5 are ordering.

**Target share as the fairness metric.** Raw counts treat everyone as
interchangeable, which is wrong when qualification differs
([ADR-0006](adr/0006-eligibility-target-shares.md)). The displayed fairness figure is
the deviation of actual share from `targetShare`; the candidate ordering uses the
prototype's counts because they are what planners recognize. Both are shown in the
suggestion list so the ranking can be argued with.

## Suggest — fix one gap

A coverage cell in the `GAP` state exposes a Suggest action. It opens a ranked
candidate list showing, per candidate: name, shift count in the last 90 days, days since
they last held the shift, weekend load against target, and any warning that would be
created by choosing them.

Choosing a candidate **stages a draft change**. It never publishes.

If no candidate passes the hard filters, the list explains why the gap cannot be
closed — "3 eligible, all on leave" — rather than showing an empty box.

## Auto-populate — fill a period

Constraints:

- one unit, one period, at most **92 days**;
- runs into a draft, never into published data;
- **locked cells are never touched** — the planner locks the assignments they have
  already decided, and generation receives those IDs.

Sequence:

1. load the day configuration for each date in the period;
2. place each included person's `defaultRoleId` on their ordinary working days;
3. rotate specialist roles by the candidate ordering;
4. rotate weekend roles, honoring `weekendEligible` and `maxWeekendsPerQuarter`;
5. apply holidays;
6. generate comp days for the weekend and holiday work just created;
7. return the ordered set of draft changes.

Where a requirement cannot be met, generation leaves a **visible gap with a stated
reason**. Silently under-filling is worse than an honest hole.

## Explainability

Every generated assignment can explain itself:

> Person 06 assigned Saturday 15 Aug as Primary: 3 weekend shifts in the last 12 weeks
> against a team average of 4.2. Alternatives: Person 07 (would exceed 2 weekends per
> quarter), Person 08 (on leave 12–19 Aug).

Without this, planners stop trusting auto-generation within a month and go back to
doing it by hand. Explainability is not a nice-to-have; it is what makes the feature
survive contact with users.

## Preview and acceptance

The result is a **preview**, accepted or rejected as a whole or day by day. Individual
people can be frozen from re-planning. Accepting stages draft changes, which then go
through the normal review and publish flow.

## Determinism

The algorithm is greedy construction plus local search over a penalty sum, with a
deterministic seed: the same inputs produce the same schedule. A planner who reruns
generation after a small edit must not see the whole month reshuffle.

If a solver library (OR-Tools CP-SAT or equivalent) is available in the target
environment, prefer it — the problem is small and solves in a fraction of a second. The
interface is the same either way ([ADR-0012](adr/0012-schedule-repository-boundary.md)).

## When to build it

Not before two or three months of real data exist. Fairness computed over an empty
history is noise, and a generator that suggests nonsense on its first run does not get
a second one. See [13-roadmap.md](13-roadmap.md).
