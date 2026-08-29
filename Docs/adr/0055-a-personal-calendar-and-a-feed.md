# ADR-0055. A personal calendar, and a feed anybody can subscribe to

**Status:** accepted. Extends [ADR-0050](0050-one-grid-half-days-and-the-split-cell.md)
(one grid, editability by role) rather than narrowing it.

## Context

ADR-0050 made the grid one grid for everybody: a non-planner reads it and acts on their
own row through the cell menu. That was right, and it is not the whole answer.

An engineer who wants a day off in November has to find their own row in a horizontal sheet
of twenty-seven people, then scroll to November — through a view whose columns are 45px
because it is sized for a planner comparing a month across a team. Nothing about that is
broken; it is simply a planner's instrument being shown to somebody who is not planning.

Two things follow from what that person is actually doing:

- They look at **one row**, so the space a planner spends on eighty others is free. A day
  can be a box with `Crew 09:00–18:00` in it instead of a 45px chip.
- They look **forward**, further than a rota exists for. "Book next summer" is ordinary,
  and the shifts will not be published for months. A planning window is the wrong shape
  for it.

Separately: people asked for their shifts in Outlook. `Person.CalendarToken` has existed
since Phase 1 for exactly this and nothing had ever read it.

## Decision

**A `/me` screen: the caller's own months, vertically, growing as it is scrolled.**

- One person, one query, a window that extends forward automatically and backwards on a
  button. Two years is the cap — the server refuses more, because a scroll is not a query.
- **It reuses the grid's projections.** `projectCells` is the precedence chain,
  `projectPresence` and `projectRequests` are the two independent maps beside it
  (ADR-0043, ADR-0045). This screen builds a dataset of one person and runs the same three
  functions. A second answer to "what does this day say" is exactly the duplication those
  modules exist to prevent.
- **It reuses the cell menu.** `CellSelfServiceMenu` in a floating shell, unchanged. One
  menu means one set of rules about what needs approving and one route per thing — the
  property the single `AssignmentPicker` was built for, applied again.
- Empty months are **normal and shown as empty**. A rota that has not been published is not
  an error, and a person can put leave on a day that has no shift yet.

**A subscription feed at `/api/calendar/{token}.ics`.**

This is the **only anonymous route in the product**, and it has to be: Outlook and Google
subscribe by URL and cannot carry a bearer token. So the token in the path is the whole of
the authentication, and three things follow from that rather than being optional extras:

- It is **256 bits of randomness**. The fixture wrote `tok-{personId}`, which is a
  guessable credential; the seed replaces any it finds, on every start, because telling
  the owner of an existing database to drop it is not a fix.
- It is **never serialized**. `Person` goes out whole on `/api/reference`, so without
  `[JsonIgnore]` every signed-in person would be handed everybody else's feed URL. It is
  read back only through the caller's own `/api/me/calendar-feed`.
- It is **rotatable**, from the screen that shows it. A URL that has been pasted into a
  shared document cannot be un-pasted; resetting the token is the revoke button, and it is
  next to the copy button because that is the day somebody needs it.

A wrong token answers 404, identically to an unknown route. A distinguishable "wrong token"
would make the address space searchable.

**What is in the feed:** shifts as timed events in the shift's own timezone, leave and comp
days as all-day entries. **Presence is not**, and that is a choice: a subscription lands in
the calendar colleagues use to find each other, and "remote on Tuesday" as an event in it
fills that calendar with notes about days rather than commitments.

Every entry carries a stable UID. That is what makes a subscription an update rather than a
growing pile of duplicates — and it is why an absence is written as one event per day
rather than one spanning event: a range that is later trimmed (ADR-0052) drops the days it
lost, instead of leaving a stale block in the subscriber's calendar.

## Consequences

- The Requests screen stays as it is. It is the approver's inbox and the record of what was
  asked; the calendar is where you look at your own time. They answer different questions,
  and merging them was considered and rejected on that basis.
- Managers get no special view here. A manager is an ordinary person with their own
  calendar; looking at the team is what the Schedule screen is for
  (`Person.isIncluded` decides who is *planned*, never who is *drawn*).
- Writes made from the calendar have to reach it. It reads its own long window through its
  own query, so `useSchedule`'s direct writes and every request mutation invalidate
  `['my-calendar']` — the same failure as an approval never reaching the grid, in a second
  place.
- An unauthenticated endpoint returning a person's schedule is a real exposure with a real
  control, not an absent one. If that trade ever stops being acceptable, the answer is to
  drop the feed, not to add a second weaker credential to it.
