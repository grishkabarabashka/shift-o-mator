# ADR-0004. Roles belong to a unit; there is no global role catalog

**Status:** accepted

## Context

The code `SL` shows up in several units. The temptation to build a global role
catalog and reference it from everywhere is strong — and wrong: `AMER/SL` and
`EMEA/SL` have different times, different people, and different coverage
requirements. All they share is a name.

## Decision

`ShiftRole` holds a `unitId`. There is no global catalog. Matching codes across units
is normal and means nothing.

## Consequences

- Coverage rules reference `roleId` within their own unit — no ambiguity.
- Changing `EMEA/SL`'s time doesn't touch `AMER/SL`.
- A person's eligibility references roles in their own unit; moving a person to
  another unit requires revisiting their eligibility (not automated in the MVP).
- Reports like "how many SL shifts company-wide" require an explicit group-by — an
  accepted cost.

## Alternatives considered

- **Global roles with a per-unit time override.** Same outcome through an extra layer
  of indirection, plus a constant "what's overridden here" question.
