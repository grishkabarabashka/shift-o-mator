# ADR-0053. Presence types are reference data; the kind stays a closed enum

**Status:** accepted, narrowing [ADR-0043](0043-presence-is-an-orthogonal-range-entity.md).
Its decision to keep the kind a closed enum is **reversed** by
[ADR-0054](0054-presence-types-are-an-open-set.md) — the two branches it named as the
justification became columns. Everything else here stands, including the server-side
enforcement of `requiresApproval`, which is the half that mattered.

## Context

ADR-0049 made kinds of *leave* data, on the grounds that "what counts as an absence" is a
policy question that changes without asking anybody here. Presence never got the same
treatment, and three separate things had hardened into code as a result:

- **Its labels and colours.** `engine/presence.ts` held four `Record<PresenceKind, …>`
  tables — glyph, colour, label. Changing "Travelling" to "Business trip" was a release.
- **Which kinds are offered.** `CellSelfServiceMenu` listed all four, hard-coded, in a
  fixed order. A team that does not use customer sites had a menu item that meant nothing
  to them and no way to remove it.
- **Which need approving.** One line: `if (kind === 'REMOTE') raise('REMOTE')`. This is
  the worst of the three, and not because of the maintenance. Whether remote days are
  signed off is exactly the sort of thing one unit decides differently from another — and
  because the rule lived only in the menu, the server accepted a direct write of a remote
  day from any caller who asked for one. The routing the product had decided on was a
  **client-side convention**, which is to say not a rule at all.

The obvious move is ADR-0049's: delete the enum, make the kind a row. That is wrong here,
and the difference is worth stating, because "make it data" is not free.

`EventType` has no behaviour attached to any particular row. `CoverageCalculator` never
asks "is this vacation" — it asks `blocksAssignment`, `countsTowardCapacity`. That is what
made the enum deletable: nothing branched on the member.

`PresenceKind` does have behaviour attached to particular members. `Office` is the only
kind that names a `Location` row; the others carry free text. `Person.DefaultPresenceKind`
is a baseline the grid draws deltas against. `RequestType.PresenceKind` is what an approved
request materialises into. A fifth member created from a screen would be a value that
several of those branches do not understand, and the failure would be silent.

## Decision

**Split it where the code actually splits: the kind is code, its presentation and its
policy are data.**

```
PresenceType {
  id            the PresenceKind member name — fixed, so the seed tops up by id
  kind          OFFICE | REMOTE | TRAVEL | CUSTOMER_SITE
  label, glyph, color
  requiresApproval
  isActive
  sortOrder
}
```

One row per kind. **No create and no delete** — the admin screen is update-only, and
retiring a kind is `isActive = false`, which drops it from the cell menu while every
record already written keeps its colour and its name.

`requiresApproval` becomes the **server's** rule, not the menu's: `POST /api/presence`
refuses a kind that carries it, with `APPROVAL_REQUIRED`, exactly as `/api/absences` does
for an event type. This is ADR-0052's rule applied to the other half of self-service —
what decides the write path is the thing being written, never who is writing it. The menu
reads the same row, so the client agrees with the server rather than deciding for it.

Travel and customer site gain request types they did not have. They are statements of fact
today and go in directly, but a flag an admin can flip with nowhere to send the request
would be a dead end.

`engine/presence.ts` keeps a `FALLBACK` table. Not as a leftover: the projection runs on
whatever the client happens to hold, and a record whose type row has not arrived still has
to render as *something* — a blank glyph reads as "nothing recorded", which is the one
thing it is not.

## Consequences

- Renaming, recolouring, reordering and retiring the options on a cell's right-click menu
  is a row on Settings → Presence.
- "Remote needs signing off" is enforced where it can be relied on. So is its opposite: a
  team that trusts remote days unticks one box, and the server starts accepting them.
- Adding a genuinely new kind of presence is still a schema change — a migration, the
  office-versus-site branch, and a decision about what the baseline means. That is the
  honest cost, and this ADR is the record that it was priced rather than forgotten.
- Presence still never touches coverage. Nothing here changes that, and there is still no
  `countsAsCoverage` field to change it with (ADR-0049's guarantee, same reasoning).
