# ADR-0008. Events are dated coverage rules, not a separate entity

**Status:** accepted — amended by
[ADR-0016](0016-day-configuration-groups.md). An event is now a `DayConfiguration` with
a `date` and a `label` rather than a `CoverageRule` with `appliesTo: DATE`. The
principle is unchanged: an event is configuration on a date, not a new entity.

> **Deferred.** The owner confirmed how events actually work: for a DR test or
> month-end close the planners simply know the event is happening and staff up. Distinct
> minimums per event are a custom case and are **not built now**. The `date` variant
> stays in the `DayConfiguration` type — the shape is right — but there is no UI, no
> fixture and no engine branch for it until a real event needs one.

## Context

A DR test, a month-end close, a major release all require heavier coverage on a
specific day. The natural instinct is to build an "event" entity with participants and
requirements.

## Decision

`CoverageRule` has an `appliesTo: WEEKDAY | WEEKEND | HOLIDAY | DATE` field. For
`DATE`, `date` and `label` are set ("DR test", "Month end"). Rules for a specific date
override the general ones.

An event is described as a set of such rules.

## Consequences

- The validator and the generator know nothing about events — they only see coverage
  rules. One code path instead of two.
- The rule's label shows up in the coverage strip and in the generator's
  explanations: it's clear why requirements are higher that day.
- Conflict resolution: a `DATE` rule outranks `HOLIDAY`, which outranks `WEEKEND`,
  which outranks `WEEKDAY`.
- An event that needs specific people, not just specific coverage numbers, isn't
  expressible in this model. That case hasn't come up yet; if it does, it needs a new
  ADR.

## Alternatives considered

- **An `Event` entity with its own requirements.** A second constraint mechanism that
  the validator, the generator, and every report would have to account for.
