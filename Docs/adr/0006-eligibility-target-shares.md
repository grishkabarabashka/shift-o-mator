# ADR-0006. Eligibility holds target shares, not booleans

**Status:** accepted, with candidate ordering clarified

> **Clarification.** Target share is the **fairness metric** — what People and
> Analytics display, and what "this person is skewed" means. Candidate **ordering** for
> Suggest and auto-generation uses the prototype's proven sequence: eligibility →
> availability → fewest assignments of that role in the trailing 90 days → recency →
> personal targets such as `maxWeekendsPerQuarter`. Both figures appear in the
> suggestion list so the ranking can be argued with.
> See [06-generation.md](../06-generation.md).

## Context

The simplest model is "can / can't." It doesn't describe a real case: this person
should get the shift-lead role more often than others, while that one should get it
occasionally, just to keep the skill fresh. With boolean flags, rules like this end up
as special cases in the generator's code or stuck in a planner's head.

## Decision

`RoleEligibility` stores a desired distribution:

```
{ roleId: SL,    targetShare: 0.4, minPerWeek: 2, maxPerWeek: 6 }
{ roleId: BATCH, targetShare: 0.2 }
{ roleId: CAVA,  targetShare: 0.4 }
```

## Consequences

- Fairness is computed not as equality, but as the **deviation of actual share from
  target share**. A person targeted at 0.4 for shift lead who's actually at 0.15 is
  skewed, even if their absolute numbers put them in the middle of the team.
- Analytics show bars with a target marker, not a table of numbers.
- A missing role in the list is equivalent to "can't" — the boolean case is a special
  instance of this one.
- A person's shares don't have to sum to 1: they're weights, not probabilities.

## Alternatives considered

- **A boolean flag plus a separate "preferences" table.** The same thing, just spread
  across two places.
