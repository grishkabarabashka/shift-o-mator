# ADR-0067. One owner for each kind of state

**Status:** accepted — **supersedes [ADR-0012](0012-repository-boundary.md)** (the
`ScheduleRepository` boundary). Narrows [ADR-0015](0015-optimistic-drafts.md): the split
between published data and the draft is unchanged, but where each lives is now decided.

## Context

The client held server data twice.

TanStack Query cached `GET /api/schedule` and `GET /api/reference`. `useSchedule`
(Zustand) also held `reference`, `published`, `plan` and `index` as its own fields, seeded
by `load()`. The two were kept in step by a subscription at the bottom of `useSchedule.ts`:
~55 lines that compared query keys element by element on every successful fetch and
re-seeded the store from the result.

The bridge worked. The problem was that everything upstream had to know it existed:

- A direct write (absence, presence) patched `published` **and** recomputed `plan` **and**
  rebuilt the index, in `applyAbsences`/`applyPresence`, while leaving the query cache
  holding the older answer.
- An approval — a write the *server* made on our behalf — could only reach the grid by
  invalidating exactly the key the subscription was watching. CLAUDE.md had to state
  "invalidating `['schedule']` is the whole contract; do not add a second path", which is
  a rule that exists because the mechanism was not self-evident.
- "Which of these two is true right now" had no single answer, and the subscription's key
  comparison was the only thing that decided.

Beside it sat a second boundary that had stopped being one. `ScheduleRepository`
(ADR-0012, "the single data boundary") had one implementation, one consumer
(`useSchedule`), and nine sibling modules in `api/` — `admin`, `requests`, `planning`,
`myCalendar`, `insights`, `setup`, `notificationAdmin`, `roleAssignments`, `stagedCells` —
that called `client.ts` directly. The second implementation it was written for
(`MemoryScheduleRepository`, IndexedDB) was deleted in the Phase 5 HTTP cutover, and the
tests it also served now intercept `fetch()` at the network boundary (`testUtils/mockApi.ts`),
which exercises the real code rather than replacing it. Three of its methods —
`loadReference`, `loadPublished` and `history` — had no callers at all, because
`api/queries.ts` had grown its own `fetchReference`/`fetchSchedule`.

## Decision

**TanStack Query owns server state. Zustand owns the draft and the screen's own state.**

**1. `reference`, `published`, `plan` and `index` leave the store.** `useDataset()`
(`store/useDataset.ts`) is where the two meet and the only place they do: it reads the
reference and schedule queries, takes `changes` from the store, and derives
`plan = applyChanges(published, changes)` plus the index over it. `useReference()` is the
narrow version, for the many callers that want a list of event types and must not
re-render on every painted cell.

**2. `useSchedule` keeps what is genuinely local**: `session`, `changes`, `undoStack`,
`redoStack`, `overlappingDrafts`, `pendingSync`, `syncError`, `actionError`, `status`,
`unitId`, `range`, `currentUserId`.

**3. The cache subscription is deleted.** Nothing has to be kept in step, because there is
only one copy. A refetch reaches the screen because the screen reads the cache.

**4. Direct writes invalidate rather than patch.** `saveAbsence`, `removeAbsence`,
`savePresence`, `removePresence` and `acknowledge` call the API and then invalidate
`['schedule']` and `['my-calendar']`. This is the path approvals already used; it is now
the only path. `applyAbsences`/`applyPresence` and `recomputeFor` are gone.

The invalidation is **awaited** and uses **`refetchType: 'all'`**. Awaited because these
actions are async and a caller that awaits one expects the write to be visible on return.
`'all'` because the default refetches only what something is currently observing, and the
screen that needs it most is often not mounted — a day recorded on My calendar has to be
right on the grid when the grid is next opened, and the grid's cache entry has no observer
while you are looking at the calendar. The cost is bounded: datasets are date-scoped
(ADR-0041), so the client holds a couple of periods.

**5. `ScheduleRepository` is deleted.** `data/httpRepository.ts` becomes `api/schedule.ts`
— a module of functions beside its nine siblings, carrying the writes only. Reads live in
`api/queries.ts`.

**6. Non-React readers go through `datasetCache.ts`.** `publishedNow`/`planNow` read the
same cache entries synchronously, for the draft-sync timer; `datasetNow()` is the same
answer for tests. They take their arguments rather than importing the store, which is what
keeps `useDataset` → store → cache from becoming a cycle.

## Consequences

The derivation is memoized at module scope on input identity, not per component: sixteen
components read `useDataset()`, and a `useMemo` in each would run `applyChanges` +
`buildIndex` sixteen times over identical inputs on every edit. This makes object identity
load-bearing — `publishedOf` memoizes the `ScheduleResponse` → `PlanData` reshape for the
same reason, and a version of it that allocated per call silently defeated the memo and
rebuilt the index on every read.

A direct write now costs a round trip before the grid updates, where it used to be
instant. That is the honest cost of having one copy, and it is the behaviour approvals
always had.

ADR-0012's actual content survives: every function is async, and published assignments are
never written directly (ADR-0015) — they go through a draft and a publish. What is deleted
is the *interface*, which claimed a single boundary that nine of ten callers walked around.

## Alternatives

**Keep the store as the read surface and replace the subscription with a mounted
sync hook.** Smaller — one `useEffect` pushing query results into the store, ~20 lines
instead of 55, and no call sites change. Rejected because it keeps two copies and only
tidies the bridge between them; the confusion this ADR removes would remain.

**Move the draft into the query cache too.** Rejected: a draft is not server state that
happens to be cached, it is local, ordered, undoable, and debounced towards the server on
its own schedule. Zustand models that; a query cache does not.
