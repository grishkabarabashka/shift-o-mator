# ADR-0013. A headless UI layer for a cheap shell swap later

**Status:** accepted

## Context

The MVP is built outside the corporate perimeter; production runs on the corporate
component library (React). So the criterion for choosing a UI library isn't looks —
it's the cost of swapping the shell later.

## Decision

Radix UI primitives plus custom styling. Radix provides behavior, accessibility, and
focus management; the look is entirely custom. When the product moves, only the
presentation layer changes — the logic stays.

Design direction: a dense operational console, not a dashboard. A neutral cool base,
a single accent for active state, a monospace font for role codes and times, zero
decoration. Red and amber are reserved for coverage violations, nowhere else — so gaps
in the schedule catch the eye peripherally.

## Consequences

- Custom primitives live in `src/ui/` as a thin wrapper around Radix — there's exactly
  one place to swap.
- Color tokens are CSS variables: swapping in a corporate palette doesn't require
  touching components.
- Red and amber are reserved for coverage. Form errors and other states use different
  cues.
- Cost: some visual states have to be built by hand.

## Alternatives considered

- **Material UI, Ant Design.** Impose their own visual system and theming model;
  moving off them means a rewrite.
- **Plain HTML with no Radix.** Would mean hand-building focus traps, ARIA roles, and
  menu keyboard navigation — exactly what Radix already does.
