# Technical design

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Frontend** | React 19 + Vite + TypeScript (strict) | target environment has a corporate React component library |
| Client state | Zustand (draft/UI only) | TanStack Query owns server state; Zustand holds draft session metadata and UI ephemera |
| Server state | TanStack Query v5 | separates "data from the server" from "unsaved edits", prevents the top source of editor bugs |
| Dates | Luxon | one date library to avoid DST bugs across frontend and backend |
| UI primitives | Radix UI + Tailwind v4 | behavior and accessibility without imposed look; CSS variables drop in a corporate palette |
| Tests | Vitest (frontend), xUnit (backend) | engines covered on both; parity test proves frontend and backend implementations match |
| **Backend** | .NET 10 + EF Core 10 | organizational standard; minimal APIs, code-first schema |
| Storage | SQL Server (LocalDB for dev) | `rowversion` for optimistic concurrency; EF Core migrations |
| Identity | Stubbed (Phase 4) | bearer token with role claims; production deploys Entra ID. No unit scoping (ADR-0032). |
| Solver | Backend (C#) | candidate ranker runs server-side for fairness and history; not portable to frontend |

**Phases 0–6 completed the HTTP cutover:** frontend now makes REST calls to a real
backend over `/api/*` endpoints; domain logic is the single server implementation in C#;
published and draft data both live server-side.

## Frontend layering

```
features/          screens and components
    ↓
store/             Zustand: draft session metadata, UI state (range, unit, selection)
    ↓
api/               TanStack Query hooks and OpenAPI-generated types
    ↓
data/              HttpScheduleRepository, speaks to /api/* endpoints
    ↓
engine/            client-side utilities: date math, timeline layout, cell display logic
    ↓
domain/            types and types only — fixtures are backend-only now
```

Frontend does not compute coverage, validation, or candidate ranking — those are
server responsibilities. The `engine/` directory now contains only layout and display
logic, not domain logic.

## Backend layering

```
ShiftOMator.Api                    minimal APIs, DTOs, auth, OpenAPI document
    ↓
ShiftOMator.Application            domain services and engines
    ├─ CoverageCalculator           coverage snapshots per region/date
    ├─ Validator                    issues and validation rules
    ├─ CandidateRanker              eligible person ranking for Suggest and auto-populate
    ├─ CompDayService               accrual window search and balance computation
    ├─ AutoPopulateService          range generator using CandidateRanker
    ├─ DraftService                 session lifecycle, change batching
    └─ DateHelpers, DayConfigurationResolver, others
    ↓
ShiftOMator.Infrastructure         EF Core DbContext, migrations, seeding
    └─ ScheduleDbContext            all entities, configured for LocalDB or SQL Server
    ↓
ShiftOMator.Domain                 entities and enums — mirrors frontend's domain/types.ts
```

Domain logic is implemented once, on the server, in C#. No client-side shadow
implementation. Coverage and validation run server-side in `CoverageCalculator` and
`Validator`; results are cached briefly and reflected immediately on draft changes
via optional `draftId` parameter to `GET /api/schedule`.

## Data boundary

`ScheduleRepository` is the single point of access from the frontend
([ADR-0012](adr/0012-schedule-repository-boundary.md)). The implementation is now
`HttpScheduleRepository`, every method async and making REST calls.

The backend exposes the same logical interface over HTTP; see "Target API shape" below.

```javascript
// Frontend ScheduleRepository interface (HttpScheduleRepository)
loadReference()                                 GET /api/reference
loadPublished(unitId, range, draftId?)          GET /api/schedule
openDraft(regionId, range)                      POST /api/drafts (200 existing | 201 new)
appendDraftChange(sessionId, change)            POST /api/drafts/{id}/changes
removeDraftChange(sessionId, changeId)          DELETE /api/drafts/{id}/changes/{changeId}
publishDraft(sessionId)                         POST /api/drafts/{id}/publish
discardDraft(sessionId)                         POST /api/drafts/{id}/discard
listOpenDrafts(regionId, range)                 GET /api/drafts?regionId=...&overlapping=...
suggest(date, shiftId)                          GET /api/coverage/suggest?date=...&shiftId=...
autoPopulate(regionId, range, lockedIds)        POST /api/auto-populate (rate-limited)
```

## API surface (implemented, Phase 2–6)

Base path `/api`, OpenAPI document at `/swagger.json`. RFC 7807 `ProblemDetails` for
errors. All responses validated via OpenAPI type generation (`npm run api:schema:check`).

| Endpoint | Method | Purpose |
|---|---|---|
| `/auth/me` | GET | Current identity (stub in dev, Entra in production) |
| `/reference` | GET | Planning units, locations, shifts, day configs, people, holidays |
| `/schedule` | GET | Published assignments, absences, comp days for a range; optional `draftId` overlays |
| `/drafts` | POST | Create or return existing open session for (editor, region, range) |
| `/drafts/{id}` | GET | Fetch a draft session and its changes |
| `/drafts` | GET | List open drafts overlapping a range (for concurrency banner) |
| `/drafts/{id}/changes` | POST | Add a `DraftChange` (ASSIGNMENT, ABSENCE, or COMP_DAY) |
| `/drafts/{id}/changes/{changeId}` | DELETE | Remove a draft change (undo) |
| `/drafts/{id}/publish` | POST | Atomic publish: applies changes, runs validation server-side, returns created/updated/deleted and `remainingGaps` |
| `/drafts/{id}/discard` | POST | Mark session discarded, audit retention |
| `/coverage/snapshot` | GET | Per-region coverage snapshot for a date or range |
| `/coverage/suggest` | GET | Ranked candidates for a shift on a date |
| `/auto-populate` | POST | Generate assignments for a range; rate-limited 5/min per user |
| `/people/{id}` | PUT | Update person eligibility and preferences |
| `/admin/*` | *various* | Gated by Admin role: units, shifts, day configs, locations, absence limits, people |
| `/history` | GET | Append-only audit log of published changes |

Rules:

- **Published assignments are immutable** — all mutations go through drafts and publish.
- Publish revalidates against current `rowversion`; a stale change returns 409 with a
  conflict result (published vs. draft comparison for client reconciliation).
- Server validation runs on `POST /api/drafts/{id}/publish` and returns `issues` and
  `remainingGaps` in the publish result.
- A failed publish preserves the draft and every change — never discards on error.
- Bearer token auth with role claims; `[Authorize]` gates endpoints; no unit scoping.

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

## Frontend directory structure

```
src/
  domain/                types only (no fixtures — seeded on backend)
  engine/                dates, period math, timeline layout, cellValue projection
  data/                  ScheduleRepository interface and HttpScheduleRepository
  store/                 Zustand: useSchedule (draft metadata), useUi (selection, range)
  api/                   TanStack Query hooks, OpenAPI-generated schema
  features/              planning grid, coverage strip, timeline, people, shell, settings
  ui/                    Radix UI wrappers, theme tokens, shared styles
  auth/                  AuthProvider, stub identity
  pages/                 routed screens: Overview, Schedule, People, Settings, DayDrilldown
api/
  src/
    ShiftOMator.Domain/              entities, enums — mirrors frontend domain/types.ts
    ShiftOMator.Application/         engines and services
    ShiftOMator.Infrastructure/      EF Core DbContext, migrations, seed data
    ShiftOMator.Api/                 minimal APIs, DTOs, auth, OpenAPI emission
  tests/
    ShiftOMator.Application.Tests/   xUnit, parity with frontend Vitest
    ShiftOMator.Api.Tests/           WebApplicationFactory integration tests
```

## Testing

**Backend (xUnit):** engines are the primary unit-test target with complete coverage.

- Coverage: single and multiple gaps, over-coverage, thin state, shift counts.
- Validation: blocking gaps, warnings/conflicts that don't block, acknowledgements.
- CandidateRanker: eligibility, absences, 90-day fairness, recency, weekend targets.
- CompDayService: before/after windows, excluded weekdays, occupied dates, separate
  Saturday/Sunday earnings, pending approval, aging.
- AutoPopulateService: defaults, rotating shifts, weekends, holidays, locked cells,
  92-day rejection, rate limiting.
- DraftService: session lifecycle, change ordering, undo, publish atomicity,
  version conflicts.
- Seeding: shared fixture data loads correctly via EF Core.

**Frontend (Vitest):** integration and interaction tests.

- Draft lifecycle: undo, cancel, review, failed publish retains the draft, version
  reconciliation.
- Page states, keyboard operation, filter and selection persistence.
- Grid interaction: cell selection, picker, drag/drop, hotkeys.

**Parity test:** backend and frontend share fixture data via JSON export; both
implementations compute identical coverage results — a proof, not an aspiration.
