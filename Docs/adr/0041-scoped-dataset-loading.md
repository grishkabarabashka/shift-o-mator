# ADR-0041. Dataset loading is scoped by date range

**Status:** accepted, narrows ADR-0012

## Context

`ScheduleDatasetLoader.LoadAsync` read **every** assignment, absence, comp day,
acknowledgement and history row in the database, unfiltered, and it was called from seven
endpoints:

`GET /api/schedule`, `POST /api/suggest`, `POST /api/auto-populate`,
`POST /api/insights/gap-summary`, `POST /api/drafts/{id}/changes`,
`.../changes/sync`, and `.../publish`.

Two things made this more than a tidiness problem.

**The publish path does it inside a serializable transaction.**
`DraftsEndpoints.PublishAsync` opens `IsolationLevel.Serializable` and then loads the
world, so the lock footprint of a publish was the whole plan table and grew with every
month the system stayed in service. Self-service (ADR-0045) turns publishes from a few a
day into one per approval; serializable plus a full-table read is a deadlock generator at
that rate.

**The history table rode along and was never read.** It is append-only and unbounded, and
no engine touches `ScheduleDataset.History`. It was loaded on every schedule request for
nothing.

`Docs/12-architecture.md` justified the unscoped read as "80 people, the whole quarter
loads into the browser" — which is true of the *response*, and was quietly taken to be
true of the query behind it.

## Decision

**`LoadAsync` takes an optional `(from, to)` and filters plan rows to it, widened by a
lookback margin. History is never loaded at all.**

```
LookbackDays  = 120   // ranking and validation look back, see below
LookaheadDays = 45    // comp-day placement proposes forward
```

The margin is the whole subtlety, and it is not decorative:

- `CandidateRanker` counts the last **90** days for fairness and **84** for weekend load.
- `Validator.CheckWeekendLoad` uses a rolling **91**-day window.

Trimming to the visible range would silently reset every fairness counter to zero, and
produce a ranking that is *wrong* rather than merely stale. 120 covers all three with
room to spare.

Ranges are matched by **overlap, not containment** — a vacation that started last month
still covers days in this one.

The unscoped overload survives for seeding and the Phase 8 baseline test, which genuinely
need everything and are not request paths.

## Consequences

- One accepted loss of fidelity, documented at the call site: `CandidateRanker`'s "days
  since last held" saturates at the lookback edge, so someone who last held a shift 200
  days ago now ranks as "never held it". Both mean *stale* to the ordering, and
  distinguishing them costs a full-table read.
- `ScheduleDataset.History` stays on the type but is always empty. `GET /api/history`
  queries the table directly, with its own filters and indexes (ADR-0040).
- New indexes make the filters real rather than decorative: `Assignments(Date)`,
  `Assignments(UnitId, Date)`, `Absences(PersonId, From)`, `Absences(To)`,
  `CompDayEntries(PersonId, EarnedForDate)`, `CompDayEntries(Status)`.
- Comp days are matched on *earned or placed or pending* rather than on one date, because
  the balance a planner sees is "earned, not yet taken" — an old accrual proposed for next
  week has to load.
- `POST /api/suggest` passes the same date as `from` and `to`. The lookback margin is what
  makes that correct; without it, ranking one cell would see no history at all.

## Alternatives considered

- **Scope by unit as well.** Tempting, and wrong for the `ALL_UNITS` scope the app opens
  on, which needs every unit anyway. Date is the axis that actually bounds the data.
- **Cache the dataset.** Solves the read cost, adds an invalidation problem, and does
  nothing about the serializable transaction's lock footprint — which is the part that
  bites under self-service load.
- **Leave it; eighty people is small.** True today and true of the row count. Not true of
  the history table, which is a function of time rather than headcount.
