# ADR-0002. A location is responsible only for the calendar and display

**Status:** accepted

## Context

The natural first instinct is to tie shift time to a person's geography. It breaks
immediately: people in Pune cover Americas shifts, and service transition engineers
are scattered across every region.

## Decision

`Location` is responsible for exactly two things:

1. the calendar of weekends and public holidays — which day counts as a day off for a
   given person;
2. the timezone used to display that person's schedule to them.

A location has nothing to do with shift time.

One-sentence rule: **the role defines when to work; the location defines when that
work counts as falling on a day off.**

## Consequences

- A comp day is accrued based on the person's **location** calendar, not the
  assignment date in the role's timezone. A one-day mismatch here is possible and is
  correct behavior.
- Swiss holidays don't block a Londoner.
- Which weekdays count as weekend is a location attribute, not a global constant.
- The display-timezone switcher (own / region / UTC) is always visible in the header.

## Alternatives considered

- **Location determines shift time.** Falls apart on the first cross-regional case.
- **Holidays as a global lookup table.** Produces false blocks and false comp-day
  accruals.
