# ADR-0054. Presence types are an open set; the two branches become columns

**Status:** accepted, reopening [ADR-0053](0053-presence-types-are-reference-data.md).

## Context

ADR-0053 made a presence type's *presentation and policy* data — label, glyph, colour,
order, whether it is offered, whether it needs approving — and deliberately kept
`PresenceKind` a closed enum. It priced that decision rather than assuming it, and named
the cost: "adding a genuinely new kind is still a schema change, and should be."

The owner asked for it twice. That settles the *whether*; what is left is doing it without
losing the thing the enum was protecting.

The argument for keeping it was that, unlike `EventType`, there **is** behaviour attached
to particular members. That was true, and it was exactly two things:

- `Office` is the only kind that points at a `Location` row; the rest carry free text.
- The coverage strip counts "on site / remote / away", which is a partition of the four
  members.

Everything else — colour, glyph, label, approval, ordering — was already a column. Two
branches is not an enum's worth of justification; it is two columns nobody had written yet.

## Decision

**`PresenceKind` is deleted. `PresenceRecord.TypeId` names a `PresenceType` row.**

The two branches become columns on that row:

```
PresenceType {
  id, label, glyph, color, requiresApproval, isActive, sortOrder
  namesALocation   does recording it pick one of our offices, or is it free text?
  countsAs         OnSite | Remote | Away — which headcount on the coverage strip
}
```

`Person.DefaultPresenceTypeId` and `RequestType.PresenceTypeId` follow. The admin screen
gains create and delete.

**`CountsAs` stays a closed set, and the difference is the point.** It is a *readout*, not
a property of the work: one row of a strip cannot grow a column per type an administrator
invents, and "how many people are in a building on Friday" has exactly three answers. A new
type defaults to `Away`, because claiming somebody is on site is the answer that would
mislead.

**Deleting is refused once anything points at the type.** A presence record names its type
and carries nothing else, so removing the row would leave days on the grid describing a way
of working nobody can name. `IsActive = false` is the ordinary answer: it drops the type
from the cell menu and leaves history readable. The refusal says so.

**A type that needs approving owns a request type**, created, renamed and retired with it.
Without that, ticking the box on a new type would produce a menu item with nowhere to send
the request — a dead end an administrator can reach in two clicks and diagnose in none.
This is the same class of defect as ADR-0053's own finding, where "remote needs approval"
lived only in the cell menu.

## Consequences

- "Standby", "at a conference", "a customer's office" are rows. This is the kind of thing a
  team invents without asking anybody here, which is the test ADR-0049 applied to leave.
- The projection can meet a record whose type it does not hold — a type an administrator
  deleted, or one that has not loaded. It draws `?` in the type's place rather than
  nothing: a blank glyph reads as "nothing recorded", which is the one thing it is not.
  The old per-kind fallback table is gone, because a guessed colour and name per id would
  be a different wrong answer in every installation.
- Presence still never affects coverage, and there is still no field here that could make
  it — the same guarantee, for the same reason, as `EventType` having no coverage flag.
- The schema is regenerated, as it is for every model change while there is no production
  data. Existing databases need `--reset-db`.
