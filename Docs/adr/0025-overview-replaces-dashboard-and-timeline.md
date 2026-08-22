# ADR-0025. One Overview screen; all units by default

**Status:** accepted — supersedes the two-screen split in
[07-ux-shell](../07-ux-shell.md), extends [ADR-0020](0020-planning-unit-and-region.md);
the timeline's bar grammar and density are amended by [ADR-0027](0027-overview-reuses-day-detail.md)

## Context

Dashboard and Timeline were separate routes because the prototype had them
separate. Both answered the same question — *are we covered* — at different
zoom levels, and using them meant reading a number on one screen, switching to
the other, and re-finding the region and the day the number referred to.

The timeline itself made this worse. It stacked one day above another, each
with its own 0–24 axis. To see that APAC hands over to EMEA cleanly on Tuesday,
a reader had to compare two percentages in two different coordinate systems.
Time ran *down* the page, which is the one direction time does not run in any
other scheduling tool.

Separately, the default view was one planning unit — AMER. But the question
people open this product to answer is global: *are we covered, anywhere*. A
default that shows one third of the roster answers it wrong, and ADR-0020
already established that a unit is a filter and not a boundary. The default was
contradicting the model.

## Decision

**One screen, `Overview`.** Three layers, in descending order of urgency:
period statistics, the attention list, and the coverage timeline.

**The timeline is one continuous horizontal axis** across the selected period.
Days are vertical rules on it, regions are lanes stacked vertically, and
scrolling right is scrolling forward in time. A density control (Compact /
Normal / Wide) sets pixels per day; region names stay pinned while time scrolls.

**Each region lane collapses.** Collapsed, it shows one cell per day —
`filled/required`, colored by the worst level that day. Expanded, it shows the
role blocks on the same axis. Both states share the day geometry, so "where is
the gap" reads identically in either.

**`ALL_UNITS` is the default** everywhere — Overview, Schedule and People.
Choosing a unit narrows the list; it never was, and now does not look like, a
permission boundary. With no unit selected the schedule grid groups by region
rather than by location, because a flat list of eight locations across three
regions is unreadable.

## Consequences

- Handovers become visible as what they are — a physical overlap between two
  lanes at the same instant — rather than two numbers that happen to match.
- The "Whole region" toggle is hidden when `ALL` is selected, where it is a
  tautology. It still matters when a single unit is chosen, as the middle
  ground between one unit and everybody.
- `buildTimelineRange` is composed from `buildTimelineDay` rather than written
  beside it, so the day drill-down and the range view cannot disagree about
  role windows, gaps or handovers.
- A month at Normal density is about 5900 px wide. That is intended: horizontal
  scroll is the point. Compact exists for when the whole period must be seen at
  once.
- **Cost:** Overview does more work on one screen and computes a timeline for
  every visible day. It is memoized on the range and the published plan; if it
  becomes slow at 90 days, the range control already caps what is asked for,
  and the 3/6-month zooms are heatmap territory anyway.

## Alternatives considered

- **Keep both screens, fix only the timeline.** Preserves a split that costs a
  navigation and delivers nothing. The Dashboard's own content — summary,
  attention list — is the natural header for the timeline, not a separate page.
- **Vertical timeline, days as rows.** What was there. Compact for many days,
  and it makes cross-region overlap — the whole reason the timeline exists —
  impossible to see.
- **Keep AMER as the default unit and add an "All" option.** Leaves the wrong
  answer as the one most users see, and keeps the unit reading as a boundary.
