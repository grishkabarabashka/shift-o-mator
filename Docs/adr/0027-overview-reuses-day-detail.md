# ADR-0027. Overview's timeline reuses the day-detail view; date strip gets click-click

**Status:** accepted — amends [ADR-0025](0025-overview-replaces-dashboard-and-timeline.md)

## Context

ADR-0025 gave Overview one continuous timeline, but its expanded region lanes
stayed aggregated: `TimelineBlock` per role, one bar showing `filled/required`
with everyone folded into a count. The day drill-down, built after ADR-0025,
answers a sharper question — *who, specifically* — with one bar per assigned
person. Once both existed side by side, the aggregated view read as the worse
of the two: it hid exactly the information a planner opens the expanded lane
to see.

Separately, the density control (Compact / Normal / Wide) that ADR-0025
specified turned out to answer a question nobody asked. The three settings
picked pixels-per-day; scrolling picked how much of the period was visible.
Nothing about "where's the gap" needed a second axis of choice.

## Decision

**Expanded region lanes render `buildDayDetailRange`, not `buildTimelineRange`.**
A new engine function assembles the existing per-day `buildDayDetail` across a
continuous multi-day axis, the same way `buildTimelineRange` already assembles
`buildTimelineDay` — same row-packing, same handover math, same axis
extension for a shift that crosses midnight. Overview's expanded lane now
shows the identical bar grammar as the day drill-down: solid bars with role
code and person name, dashed bars for a gap, hatched handover bands, a NOW
marker. Collapsed lanes are unchanged — one `filled/required` cell per day —
because collapsing was never the complaint.

**One density, not three.** The Compact/Normal/Wide selector is gone. A fixed
220px/day plus horizontal scroll does what the picker did, without a control
that answered nothing.

**The date strip gains click-click range selection, alongside drag.** A
planner can now select a range by clicking a start date and clicking an end
date — the same date twice is one day — instead of only dragging across the
strip. A plain click (mouse down and up on the same chip, no movement)
becomes the first click of the pair; an actual drag still commits instantly,
as before. The two are told apart by comparing the chip released-on against
the chip pressed-on, not by a separate mode toggle.

## A bug the tests found: a gap bar's key is only unique for one day

`DayDetailBar.key` for an unfilled role is `gap-${roleId}` — fine within a
single day, where `buildDayDetail` is normally called. Once `buildDayDetailRange`
put every day's bars into one list, the same unfilled role recurring across a
week produced the same React key repeatedly, and React logged duplicate-key
warnings (harmless in this exact case, but not something to ship). Fixed by
qualifying every bar's key with its date when it enters the range list —
`${date}-${bar.key}` — which also makes the assigned-bar keys (already unique
via `assignment.id`) belt-and-suspenders unique across days.

## Consequences

- Suggest/auto-populate, day drill-down and Overview's expanded lane now all
  read a gap and a person assignment through the same two engine functions
  (`buildDayDetail` for one day, `buildDayDetailRange` for a span) — a change
  to bar geometry or gap wording changes everywhere at once.
- Overview's range view is heavier per pixel than before: a month renders one
  bar per assignment instead of one block per role. Row-packing is the same
  greedy algorithm already used for the aggregate view, so the cost is the
  same order, not a new one.
- The click-click affordance and drag are not mutually exclusive UI modes;
  a planner never chooses between them, both are just always available.

## Alternatives considered

- **Keep the aggregated blocks, add person names as a tooltip.** Tried
  conceptually and rejected: the whole point of reusing the day-detail
  grammar was for the names to be *on* the timeline, not one hover away —
  that's what the day drill-down already got right.
- **Two-click range as a separate mode, toggled explicitly.** Rejected as an
  extra decision the planner has to make before making the decision they
  actually came for. Telling a click from a drag by movement, not by mode,
  needed no toggle at all.
