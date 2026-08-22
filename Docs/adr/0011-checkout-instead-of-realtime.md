# ADR-0011. Period locking via check-out, no real-time collaboration

**Status:** ~~accepted~~ — **superseded by
[ADR-0015](0015-optimistic-drafts-and-publication.md)**

> Pessimistic locking is not used. The product allows concurrent draft sessions and
> resolves conflicts at publish time. The rejection of real-time collaborative editing
> below still holds and is carried into ADR-0015; the locking decision does not.
> Retained for the record.

## Context

There are one or two planners per unit, they usually work only within their own unit,
and they work infrequently — sitting down every 2–4 weeks to lay out a period.
Real-time collaborative editing (CRDTs, operational transforms, presence) is a whole
separate subsystem with its own conflict model.

## Decision

Check-out on a (planning unit, period) pair. One person takes EMEA for September;
everyone else sees it read-only with a "Maria is editing since 14:20" banner.

- Auto-release on an inactivity timeout.
- Force-release by an administrator — otherwise someone goes on vacation with
  September locked.

## Consequences

- The edit model stays simple: a local draft, patches, undo/redo, saved in batches.
- Merge conflicts don't exist by construction.
- In the MVP without a backend, locking is emulated in the repository:
  `acquireLock` / `releaseLock` / `getLock` exist from day one, so the UI is written
  against the real contract.
- Cost: two planners can't simultaneously edit the same period of the same unit. At
  the current number of editors, that's not a real constraint.

## Alternatives considered

- **Real-time collaborative editing.** With this many editors, adds more complexity
  than it saves.
- **Optimistic locking at the record level.** Produces conflicts at save time — right
  after the planner has already spent half an hour on it.
