# Technical design

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React + Vite + TypeScript (strict) | the target environment has a corporate React component library |
| Client state | Zustand, small domain stores | no single monolithic store; edits as patches give undo/redo |
| Server state | TanStack Query, separate from client state | mixing "data from the server" with "my unsaved edits" is the top source of bugs in editors |
| Dates | Luxon | one date library for the whole project |
| Time scale | d3-scale | the scale only, not a Gantt component |
| UI primitives | Radix UI | behavior and accessibility without an imposed look |
| Tests | Vitest | the engine is covered from day one |
| Backend (target) | .NET, deployed to AKS | organizational standard |
| Storage (target) | SQL Server, EF Core code-first | `rowversion` for optimistic concurrency |
| Identity (target) | Entra ID, JWT bearer | group claims → app roles. **No region scoping** (ADR-0020) |
| Solver | backend | a JS local search would be slow and non-portable |

The MVP runs with no backend: an in-memory repository over fixtures, persisted to
IndexedDB, with JSON import/export.

## Layering

```
features/          screens and their components
    ↓
store/             Zustand: draft session, patches, undo/redo, UI state
    ↓
engine/            pure functions — no I/O, no clock, no storage
    ↓
domain/            types and fixtures
```

Dependencies run strictly downward. `engine` knows only `domain`; `domain` knows
nothing. Every engine function takes the current instant as a parameter.

### Engines

| Engine | Signature |
|---|---|
| `coverage` | assignments + the day configuration **effective on that date** + holidays → snapshot |
| `rotation` | date + role + people + history + preferences → ordered candidates |
| `compOff` | earning assignment + policy + existing schedule → date or approval flag |
| `autoPopulate` | region + range + locked IDs → draft changes |
| `validate` | period + state + snapshot → `Issue[]` |
| `cellValue` | assignments + absences + comp days + holidays → per-cell projection |

The client and server coverage engines must produce identical results for shared
fixtures. That parity is a test, not an aspiration.

## Data boundary

`ScheduleRepository` is the single point of access
([ADR-0012](adr/0012-schedule-repository-boundary.md)). No component and no engine
touches storage directly.

**Every method is async from day one**, even against local data — otherwise every place
that implicitly assumed synchronicity surfaces later, all at once.

```
loadReference()                             regions, locations, shifts, roles,
                                            day configs, people, holidays, handovers
loadPublished(regionId, range)              published assignments, absences, comp days
openDraft(regionId, range, editorId)        returns existing open session or creates one
appendDraftChange(sessionId, change)
removeDraftChange(sessionId, changeId)
publishDraft(sessionId)                     → created/updated/deleted/compOffs/gaps
                                              or a conflict result
discardDraft(sessionId)
listOpenDrafts(regionId, range)             for the informational banner
suggest(date, roleId)                       ranked candidates
autoPopulate(regionId, range, lockedIds)
exportJson() / importJson() / reset()
```

The generator sits behind the same interface: a greedy client implementation in the
MVP to validate the preview and explanation UX, a solver on the backend later.

## Target API shape

When the backend lands, the repository maps onto it directly. Base path `/api`,
RFC 7807 `ProblemDetails` for every error.

| Route | Operations |
|---|---|
| `/auth/me` | current identity, app role, region scope |
| `/people` | list, get, create, update, update eligibility, deactivate |
| `/regions` | list, get, update metadata, shifts, day configs, handovers |
| `/schedule` | read published range; **no direct write** |
| `/drafts` | open (200 existing / 201 new), get, list mine, add/remove change, publish, discard |
| `/coverage` | snapshot, range, gaps, `now`, `suggest` |
| `/auto-populate` | POST, ≤92 days, rate-limited |
| `/holidays` | list by year and location, create, update, delete |
| `/admin/role-mappings` | identity group → Viewer/Planner/Admin. No region scope. |
| `/units` | planning units: list, create, update |
| `/history` | append-only audit of published changes |

Rules:

- **published assignments are never written directly** — every mutation goes through a
  draft and a publish;
- publish revalidates against current state in one serializable transaction and returns
  created / updated / deleted / generated comp-offs / remaining gaps;
- a stale `rowversion` returns 409 and the client enters reconciliation;
- validation failures return 400 with `errors: { field: string[] }`;
- health liveness always returns 200; readiness returns 200 only when the database is
  reachable.

Generate TypeScript types from the OpenAPI document in CI and fail the build when they
drift.

## Visual layer

The MVP is built outside the corporate perimeter; production runs on the corporate
component library. The selection criterion is therefore not looks but **the cost of
swapping the shell** ([ADR-0013](adr/0013-headless-ui-layer.md)).

Radix primitives plus custom styling, wrapped thinly in `src/ui/` so there is exactly
one place to swap. Color tokens are CSS variables, so a corporate palette drops in
without touching components.

## Grid and timeline

Both hand-built ([ADR-0014](adr/0014-own-grid-and-timeline.md)). The prototype chose AG
Grid and then had to add `@dnd-kit` separately for the drag interactions, which never
shipped — the evidence supports the decision rather than undermining it. The prototype's
proven dimensions are adopted: 185px person column, 62px date columns, 26px rows,
pinned first column and coverage rows, full-width group headers.

## Scale

80 people, 3 regions. Consequences, stated so nobody optimizes for a problem that
doesn't exist:

- a whole quarter (~7,200 assignments, ~1 MB JSON) loads in one request;
- no server-side pagination and no lazy loading while scrolling time;
- no virtualization in the timeline;
- a month solves in a fraction of a second, so instant preview on weight changes is
  affordable.

Performance targets worth keeping: a 13-week coverage query under 200 ms p95; coverage
and schedule endpoints under 250 ms p95; `/coverage/now` cached for at most 30 seconds;
auto-populate limited to 5 requests per minute per user, publish to 10.

## Directory structure

```
src/
  domain/     types, fixtures, patch model — depends only on luxon
  engine/     coverage, rotation, compOff, autoPopulate, validate, cellValue, dates
  data/       ScheduleRepository and implementations
  store/      schedule draft, UI state
  features/   dashboard, schedule, people, settings, timeline, shell
  ui/         Radix wrappers, tokens, shared styles
```

## Testing

- Engines are the primary unit-test target: complete coverage, single and multiple
  gaps, over-coverage, duplicate person/date, ineligible role, invalid comp day.
- Rotation: eligibility, absence, 90-day fairness, recency, weekend targets.
- Comp days: before/after windows, excluded weekdays, occupied dates, separate
  Saturday/Sunday earnings, pending approval.
- Auto-populate: defaults, rotating roles, weekends, holidays, locked cells, 92-day
  rejection.
- Draft lifecycle: undo, cancel, review, failed publish retains the draft, conflict
  reconciliation.
- UI: page states, keyboard operation, filter persistence across navigation.
- Shared fixtures execute against both the client and server coverage engines.
