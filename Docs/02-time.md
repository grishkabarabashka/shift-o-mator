# Time

The one area where the project can quietly fall apart. These rules are fixed and not
revisited per-feature.

## Storage and display

- Everything is stored in UTC as half-open intervals `[start, end)`.
- Schedule **dates** are calendar dates (`2026-08-15`), stored without time, and
  interpreted in the shift's timezone.
- A shift window is defined as "local 09:00–18:00 in `America/Chicago`", never as
  "UTC−5". The conversion happens at render time, so DST is handled for free.
- Displayed in the timezone the user picks: a location's, shift time as configured, or
  UTC. The picker lives in the **Display** menu beside the avatar; the header carries a read-only strip
  of location clocks.
- Overlap between units is computed on UTC intervals, which makes the cross-unit
  timeline trivial.
- **One date library for the whole project.** Mixing in the native `Date` across eight
  locations is guaranteed to produce DST bugs.
- Holidays come from the person's location. Swiss holidays don't block a Londoner.

## What this means for the code

- No engine function calls "now" internally: the current instant is a parameter.
  Otherwise tests depend on the day they run.
- A night shift belongs to the date it **starts** on, in the shift's timezone.
  `CH-OC` 18:00–08:00 CET on March 3rd runs from 17:00 UTC March 3rd to 07:00 UTC
  March 4th and sits in the March 3rd column.
- A person's non-working day comes from their location's calendar, not from the shift
  date in the shift's timezone. A one-day disagreement is possible and correct.
- Net hours are `end − start − breakMinutes`. The AMER weekday pattern carries
  `breakMinutes = 60`; do not infer paid hours from start/end alone.

## DST

Local wall-clock definitions do not move across a DST boundary; their UTC position
does. Consequences:

- A Pune person on an AMER shift sees their working window move by an hour twice a
  year, automatically, with no data change.
- The **UTC gap between units changes** across the transition, so handover overlap
  changes even though nobody edited anything.
- Historical dates must keep rendering with the rule that applied on that date. A
  handover adjustment entered for winter must not retroactively move a summer date.

Some shift windows are documented with both a source duty time and a winter display
time (`Lead`: duty ≈09:45–18:45 CT, winter display 09:00–18:00 CT). Store the
configured window; keep the source note as shift metadata rather than trying to model
two truths.

## Handovers

Not a stored entity. A handover is the intersection of two units' shift windows on the
timeline — computed on the fly by `engine/timeline.ts` from each unit's actual shifts,
not cached or configured separately. Storing an "expected" handover window would let it
drift from reality on the first DST transition, since the two units' real shift
timezones are the only source of truth. As shifts move between the DST and standard
offsets of their own timezones over the year, the computed overlap band shifts with
them automatically — nothing needs to be "adjusted per season."

Approximate zones, for orientation (derived from today's seeded shifts, not configured):

| Handover | Typical UTC window |
|---|---|
| unit-apac → unit-emea | 08:00–09:00 |
| unit-emea → unit-amer | 14:30–16:00 |
| unit-amer → unit-apac | 22:00–00:00 |

## Display timezone

The picker offers: shift time (as configured), UTC, and every location timezone in
view. It changes presentation only — it never rewrites stored local shift definitions,
and it never changes which calendar date an assignment belongs to.

> **Where it lives.** Originally specified as an always-visible header switcher. After
> owner review it moved out of the header, and then out of Settings when Settings became
> admin-only (ADR-0051): it now sits in the **Display** menu beside the avatar, where
> everybody has it. The header shows a read-only
> strip of location clocks instead — one pill per distinct timezone in scope, with the
> active display zone marked. Switching zone is a preference set once, not a control
> reached for on every screen.

Times shown anywhere in the product always carry a timezone label. A bare `09:00` is a
defect.
