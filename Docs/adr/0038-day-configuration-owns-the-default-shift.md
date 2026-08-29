# ADR-0038. The day configuration owns the default shift, not the person

**Status:** accepted — narrows [ADR-0005](0005-no-work-pattern-entity.md)

## Context

[ADR-0005](0005-no-work-pattern-entity.md) settled that there is no work-pattern entity,
and named two person fields that carry the ordinary-day default instead:
`defaultShiftId` and `availableWeekdays`. Only auto-populate reads them.

In practice `defaultShiftId` did not describe the team. The owner's words: engineers do
not have a default shift — they have shifts they *cannot* do. What a person brings to a
day is their eligibility; where the rest of the team goes on an ordinary Tuesday is a
property of the day, not of each individual.

The field was also actively wrong in two ways.

**It answered for the wrong day.** unit-amer's Friday carries `Lead-E` / `Crew-E` /
`Crew-L`, and every person's default was `Crew` — a shift Friday does not offer. Fridays
came out nearly empty because nobody's default matched, and no other rule filled them.

**It made a shift look like a personal fact.** Twenty-four people carrying
`defaultShiftId = Crew` is not twenty-four decisions about individuals. It is one
sentence about weekdays, written out twenty-four times, and it drifted the moment the
weekday configuration changed.

## Decision

**The shift that absorbs everyone on an ordinary working day is declared by the day
configuration**, as the requirement marked `isDefault` with no `max` ceiling. Generation
fills it last, with everyone still free and eligible.

`Person.defaultShiftId` **stays in the model as an exception mechanism** and is null for
almost everyone. Service Transition keeps it: those engineers hold exactly one shift
each, so their "default" is a statement about the person, and unit-st's configurations
declare no bulk shift of their own.

Generation therefore runs four passes, in this order:

1. minimums, by candidate ranking — a shortfall here is a real gap;
2. personal defaults, where a person has one;
3. top-up towards each requirement's `max`;
4. the day's bulk shift takes everyone still free and eligible.

**The order is load-bearing.** Every pass that takes people in bulk runs after every pass
that needs a particular person, because the scarce resource is not the shift, it is
somebody free to work it. This is the same mistake, twice avoided: defaults used to run
before minimums and consumed the whole team (`Crew` for everyone, gaps on every
specialist shift); the bulk pass would repeat it one floor down, since `AMER:Crew` sorts
alphabetically before `AMER:Crew-BC` and `AMER:Lead`.

Weekend and holiday configurations are excluded from passes 2–4: those are duty rosters,
and filling them to capacity would invent weekend work — and the comp days that come with
it ([ADR-0007](0007-comp-day-as-balance.md)).

## Consequences

- A weekday roster now comes out of the data instead of out of 60-odd person records:
  unit-amer's Tuesday fills `Lead`, `Crew-BC`, `Batch-E/L/U`, `Cover` and then `Crew`
  with the remainder — 0 gaps, where the previous arrangement produced a wall of `Crew`
  and a gap on every specialist shift.
- Changing where the team works on Fridays is one edit to Friday's configuration, not an
  edit to every person.
- `defaultShiftId` remains readable and editable in the People profile, which is correct
  for the exception it now is — but it is no longer shown as a headline fact about a
  person.
- **A unit must declare a bulk shift** (`isDefault`, no `max`) for its ordinary days, or
  those days fill only to their minimums. unit-amer's Friday currently declares
  `Crew-E` — capped at 3 — so it still cannot hold the whole team. That is a data
  question for the owner, and now it is visible as one instead of being hidden behind
  everybody's `Crew`.
