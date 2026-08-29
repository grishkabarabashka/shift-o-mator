# ADR-0043. Presence is an orthogonal range entity

**Status:** accepted; its rendering half amended by
[ADR-0050](0050-one-grid-half-days-and-the-split-cell.md) — the corner glyph became a
band, and the draw-only-a-delta rule was reversed

## Context

The product had no notion of **where** a person physically works. ADR-0002 narrowed
`Location` to exactly two responsibilities — the weekend/holiday calendar and the display
timezone — and said nothing about offices, because at the time nothing needed to.

A separate corporate portal owned that: employees self-recorded remote days and which
office they were in. Absorbing it (ADR-0047) means this product has to model presence,
and the modelling question is not obvious, because presence is **orthogonal to work**. A
person on the `Crew` shift is *also* either remote or in an office. Both facts are true at
once, which is exactly what the existing cell model cannot express: `engine/cellValue.ts`
resolves a *precedence chain* — shift beats absence beats comp day beats holiday beats
marker — and produces one winner per cell.

## Decision

### A separate entity, shaped like `Absence`

```
PresenceRecord {
  id, personId
  kind            OFFICE | REMOTE | TRAVEL | CUSTOMER_SITE
  siteLocationId?   when kind = OFFICE
  siteLabel?        free text for TRAVEL / CUSTOMER_SITE
  from, to          inclusive
  source          MANUAL | REQUEST | IMPORT | PORTAL
  requestId?, externalId?, lastSeenInSyncAt?
  note?, version
}
Person.defaultPresenceKind : PresenceKind = OFFICE
Person.defaultSiteLocationId : LocationId?
```

Not a field on `Assignment`, for three reasons:

1. **Presence exists on days with no assignment.** An empty cell means "no roster decision
   recorded" (ADR-0017). Minting an assignment to carry "remote" would make that cell
   non-empty and collide with the unique `(personId, date)` index.
2. **Different owner, different write path.** Assignments are planner-owned and published
   through a draft. An employee flipping "remote next Tuesday" would bump
   `Assignment.Version` and turn every open planner draft into a publish conflict.
3. **Presence is declared in blocks** — "remote Mon–Wed", "customer site next week" —
   which is the shape of `Absence`, not of a cell.

`Location` is reused as a *place* via `siteLocationId` without widening ADR-0002:
Pune-the-holiday-calendar and Pune-the-office are the same real thing, and the calendar
responsibility is unchanged.

### A second projection, not a `CellValue` variant

`engine/presence.ts` produces its own map over the same `cellKey(personId, date)`, built
alongside `projectCells` in `usePlanningView`. **`engine/cellValue.ts` is not modified at
all** — that is the test of the design. Folding presence into that union would force every
`switch` on `CellValue.kind` to grow a case that means something unrelated.

### Rendered in the cell, coloured by kind

> **Superseded in part by [ADR-0050](0050-one-grid-half-days-and-the-split-cell.md).**
> This ADR originally put presence in an 8px corner glyph, drawn **only when it departed
> from the person's baseline**. Both halves of that were wrong and are recorded here
> because the mistake is instructive.
>
> The delta rule assumed presence would be *derived* for every day from the baseline, in
> which case rendering it would indeed fill 2500 cells. It is not: presence records are
> **sparse**, one exists only where somebody said so. So the rule suppressed the only
> records there were — marking "in the office" on your own office day appeared to do
> nothing at all.
>
> **Every recorded day is drawn.** The baseline still earns its place: it picks the office
> when you record one, and a to-baseline day is drawn quieter than an away day. Each kind
> gets its own hue, because "where is everyone" is answered by scanning, not reading — four
> kinds in the same grey looked like one fact.

Two rules that survive unchanged:

- Suppressed entirely on non-working cells. "Remote while on vacation" is noise.
- The mark carries its meaning in the tooltip **and** the cell's `aria-label`, never in
  colour or shape alone.

The real per-day readout is a **coverage strip row** ("on site / remote"), because "is
anyone in the Chicago office on Friday" is a per-day question, and reading it off eighty
cells is not reading.

### Presence never affects coverage

A remote person on `Crew` covers `Crew`. If on-site staffing ever becomes a requirement it
belongs on `ShiftRequirement`, which is already effective-dated (ADR-0021) — not on
presence, and not on the coverage engine.

### Direct writes, not draft changes

Presence goes straight to the server: it is not a roster decision, never blocks a publish,
and is owned by the person it describes. Staging it in a planner's draft would mean an
employee's "remote on Tuesday" stayed invisible until someone else published. The two
properties the draft was providing — a version token and an audit row — are provided
directly (ADR-0042, ADR-0040).

Write access is per-resource: your own record, or you are a Planner (ADR-0046).

## Consequences

- `GET /api/schedule` carries `plan.presence` for the window, so the grid needs one round
  trip rather than two. It is deliberately not *part of* the plan: nothing in it affects
  coverage or blocks a publish.
- `GridCell` takes presence as **separate primitives**, not a `PresenceMark` object. The
  component is memoized on primitives across ~2500 instances; an object prop would be a
  new reference on every render of every cell.
- The migration seeds `defaultSiteLocationId` from each person's `locationId`, so
  "in the office" means something without anybody configuring it first.
- `Location` keeps exactly the responsibilities ADR-0002 gave it. Adding a "site" flag to
  it would have reversed that ADR for no gain.

## Alternatives considered

- **A field on `Assignment`.** The three reasons above. It also fails the first test:
  presence on an unassigned day.
- **A member of the `CellValue` union.** A category error — presence has no precedence
  relationship with anything in that chain — and it would make every consumer of
  `CellValue` handle a case that is not about what the person is doing.
- **Render presence for every cell, not just deltas.** Rejected here on the arithmetic —
  2500 glyphs conveying one bit each — and then adopted anyway by ADR-0050, because the
  arithmetic was wrong: there is no glyph where there is no record, and records are rare.
- **Extend `Location` with an `isOffice` flag and put presence on the person.** Presence
  varies by day; a person-level field cannot express "remote Monday, office Tuesday".
