# ADR-0023. Editing arms itself; there is no Edit mode to enter

**Status:** accepted — refines [ADR-0015](0015-optimistic-drafts-and-publication.md)

## Context

The prototype had an explicit read/draft switch: the grid did nothing until **Edit** was
pressed, at which point a draft session opened and cells became interactive.

That is a defensible model for a system where a stray click is expensive. It is not
this system. Observed behaviour on the rebuilt screen: a user right-clicks a cell, gets
nothing, and has no way to find out why. The cell looks identical in both modes; the
only signal is a button in a toolbar that reads "Edit", which is not where anyone looks
after a click failed. The mode was invisible and the failure was silent — the worst
combination.

The safety argument for the switch is also weaker than it appears. Nothing a planner
does in the grid touches published data: every change lands in a draft and stays there
until an explicit Review and Publish. The mode was not protecting the plan; it was
protecting the *draft* from existing.

## Decision

**Any edit opens the draft.** The first assignment, marker, absence or clear checks for
an open session and starts one if there is none, then applies the change. The Edit
button is gone.

Draft state remains fully visible once it exists: a `Draft · N` badge in the product
header, and Undo / Discard / Review & publish in the schedule toolbar.

The right-click picker opens in every state, including before a draft exists. It is the
discoverable path and must never be the thing that is silently disabled.

## Consequences

- The failure mode inverts: instead of "nothing happens and you don't know why", the
  worst case is an empty draft that a single Discard removes. An empty draft publishes
  nothing and blocks nobody.
- Draft creation is asynchronous, so the guard is `await` before apply. Every mutation
  path in the grid — picker, paint drag, hotkey, paste, delete — goes through one
  `withDraft` helper rather than each checking for itself.
- Concurrent-draft detection ([ADR-0015](0015-optimistic-drafts-and-publication.md))
  now fires on first edit rather than on pressing Edit. The informational banner
  appears slightly later, which is if anything better: it appears when the planner has
  shown intent to change something.
- Diverges from the prototype spec §4.2, deliberately. Recorded here so it is not
  "fixed" back later by someone reading the spec as authority.

## Alternatives considered

- **Keep the switch, make the mode obvious** — dim the grid in read mode, label it
  loudly. Honest, and still costs every user one wasted click plus a hunt for the
  button, forever, to protect against a risk that does not exist.
- **Auto-open a draft on page load.** Removes the guard entirely, but creates a draft
  session for anybody who merely opens the schedule, including viewers. That turns the
  concurrent-draft banner into noise, which is the one signal that has to stay
  trustworthy.
