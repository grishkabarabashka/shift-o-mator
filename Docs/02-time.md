# Time

The one area where the project can quietly fall apart. These rules are fixed and not
revisited per-feature.

## Storage and display

- Everything is stored in UTC as half-open intervals `[start, end)`.
- Schedule **dates** are calendar dates (`2026-08-15`), stored without time, and
  interpreted in the role's timezone.
- A shift or role window is defined as "local 09:00–18:00 in `America/Chicago`", never
  as "UTC−5". The conversion happens at render time, so DST is handled for free.
- Displayed in the timezone the user picks: their own, the region's, or UTC. The
  switcher is always visible in the header.
- Overlap between regions is computed on UTC intervals, which makes the multi-region
  timeline trivial.
- **One date library for the whole project.** Mixing in the native `Date` across eight
  locations is guaranteed to produce DST bugs.
- Holidays come from the person's location. Swiss holidays don't block a Londoner.

## What this means for the code

- No engine function calls "now" internally: the current instant is a parameter.
  Otherwise tests depend on the day they run.
- A night shift belongs to the date it **starts** on, in the role's timezone.
  `CH-OC` 18:00–08:00 CET on March 3rd runs from 17:00 UTC March 3rd to 07:00 UTC
  March 4th and sits in the March 3rd column.
- A person's non-working day comes from their location's calendar, not from the shift
  date in the role's timezone. A one-day disagreement is possible and correct.
- Net hours are `end − start − breakMinutes`. The AMER weekday pattern carries
  `breakMinutes = 60`; do not infer paid hours from start/end alone.

## DST

Local wall-clock definitions do not move across a DST boundary; their UTC position
does. Consequences:

- A Pune person on an AMER role sees their working window shift by an hour twice a
  year, automatically, with no data change.
- The **UTC gap between regions changes** across the transition, so handover overlap
  changes even though nobody edited anything.
- Historical dates must keep rendering with the rule that applied on that date. A
  handover adjustment entered for winter must not retroactively move a summer date.

Some role windows are documented with both a source duty time and a winter display
time (`Lead`: duty ≈09:45–18:45 CT, winter display 09:00–18:00 CT). Store the
configured window; keep the source note as role metadata rather than trying to model
two truths.

## Handovers

```
Handover {
  fromRegionId, toRegionId
  normalTimeUtc, overlapMinutes
  adjustments[]   { period, adjustedTimeUtc }
}
```

The timeline resolves the applicable adjustment for the selected date, annotates the
active offset/DST state, and repositions both the handover band and the connected
shift blocks. Planners may update adjustments during seasonal transitions.

Approximate zones — configuration, not constants:

| Handover | Typical UTC window |
|---|---|
| APAC → EMEA | 08:00–09:00 |
| EMEA → AMER | 14:30–16:00 |
| AMER → APAC | 22:00–00:00 |

## Display timezone

The header switcher offers: role time (as configured), UTC, and every location
timezone in view. It changes presentation only — it never rewrites stored local shift
definitions, and it never changes which calendar date an assignment belongs to.

Times shown anywhere in the product always carry a timezone label. A bare `09:00` is a
defect.
