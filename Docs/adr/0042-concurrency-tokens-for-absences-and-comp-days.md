# ADR-0042. Optimistic-concurrency tokens for absences and comp days

**Status:** accepted, amends ADR-0015

## Context

ADR-0015 made publication all-or-nothing against the state of the plan *now*, not when the
draft was opened. `Assignment` carries an `int Version` for that: a version that moved
since the draft snapshot is a conflict.

`Absence` and `CompDayEntry` carried no such column, so `DraftService` detected concurrent
edits a different way — it reserialized the live row through `DraftJson` and compared the
result **byte for byte** against the snapshot captured when the change was appended.

That is brittle in both directions:

- **False conflicts.** Any change to `DraftJson.Options` — a naming policy, a converter, a
  new property on the entity, even property *order* — makes every open draft's snapshot
  stop matching. The failure looks like "the schedule changed underneath you", which is a
  lie, and there is no way for the planner to resolve it.
- **Missed conflicts.** Two different edits that happen to serialize identically report no
  conflict at all.

It also quietly froze `DraftJson`. A serialization convention that doubles as a
concurrency token cannot be changed, and its own doc comment said so.

Self-service (ADR-0045) makes absences a frequently-written entity — an approved leave
request creates one directly — so the odds of a genuine concurrent edit stop being
theoretical.

## Decision

**`Absence` and `CompDayEntry` get `int Version`, defaulting to 1, and publish compares
versions exactly as it does for assignments.**

`DraftService.ApplyGeneric` becomes `ApplyVersioned`, which additionally emits audit rows
(ADR-0040) — a published absence change previously left no history at all.

`PresenceRecord` (ADR-0044) carries the same token from the start, checked directly at its
own endpoint since presence does not pass through a draft.

## Consequences

- The migration sets `defaultValue: 1`, not 0, so existing rows agree with the entity's
  own default. A row at 0 would report a phantom conflict on its first edit.
- `DraftJson` is free to evolve again, and its doc comment says so.
- The client must round-trip `version` untouched through a draft change. `domain/types.ts`
  carries it on `Absence` and `CompDayEntry`, the wire mapping reads and writes it, and
  every construction site sets it: 1 for a new record, the existing value for an edit
  (`AbsenceDialog`, `engine/absenceImport.ts`). A payload that dropped it would look like
  an edit against version 0 and conflict every single time.
- `PUT /api/presence/{id}` returns `409 PRESENCE_VERSION_CONFLICT` when the token has
  moved, matching the draft path's semantics without the draft.

## Alternatives considered

- **SQL Server `rowversion` / EF `IsConcurrencyToken`.** The natural answer for a direct
  write, and the wrong shape here: the token has to survive a round trip through a JSON
  draft payload and back, which an opaque binary stamp does not do gracefully. An `int`
  the client can carry is the same guarantee in a form that fits the existing mechanism.
- **Keep snapshot comparison but normalize the JSON first** (sorted keys, canonical form).
  Removes the property-order fragility and none of the rest; still freezes the format, and
  still misses the identical-serialization case.
- **Version only absences, since comp days are system-generated.** Comp days are edited by
  planners through `CompDayDialog` — confirm, reschedule, decline — so they are exposed to
  the same race.
