# Technical design

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Frontend** | React 19 + Vite + TypeScript (strict) | target environment has a corporate React component library |
| Client state | Zustand (draft/UI only) | TanStack Query owns server state; Zustand holds draft session metadata and UI ephemera |
| Server state | TanStack Query v5 | separates "data from the server" from "unsaved edits", prevents the top source of editor bugs |
| Dates | Luxon | one date library to avoid DST bugs across frontend and backend |
| UI primitives | Radix UI + Tailwind v4 | behavior and accessibility without imposed look; CSS variables drop in a corporate palette |
| Tests | Vitest (frontend), xUnit (backend) | engines are tested where they live — server-side, in C#. The API tests run against a real LocalDB, not an in-memory provider, because half of what they prove is that the EF model and the seed pipeline work. |
| **Backend** | .NET 10 + EF Core 10 | organizational standard; minimal APIs, code-first schema |
| Storage | SQL Server (LocalDB for dev) | an `int` version column per mutable entity for optimistic concurrency ([ADR-0042](adr/0042-concurrency-tokens-for-absences-and-comp-days.md)); EF Core migrations |
| Identity | Stubbed (Phase 4) | bearer token with role claims; production deploys Entra ID. No unit scoping (ADR-0032). |
| Solver | Backend (C#) | candidate ranker runs server-side for fairness and history; not portable to frontend |
| Explanations | Optional LLM behind `IChatClient` | phrases a pre-computed digest and nothing else; unconfigured is a supported state ([ADR-0048](adr/0048-ai-explains-the-plan-never-decides-it.md)) |

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
    ├─ CoverageCalculator           coverage snapshots per unit/date
    ├─ Validator                    issues and validation rules
    ├─ CandidateRanker              eligible person ranking for Suggest and auto-populate
    ├─ CompDayService               accrual window search and balance computation
    ├─ AutoPopulateService          range generator using CandidateRanker
    ├─ DraftService                 session lifecycle, change batching, publish
    ├─ RequestService               request state machine and approval routing
    ├─ IssueDigest, CandidateDigest deterministic input for explanations
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
loadPublished(unitId, range, draftId?)          GET /api/schedule?unitId=...&from=...&to=...&draftId?
openDraft(unitId, range)                        POST /api/drafts
syncChanges(sessionId, items)                   POST /api/drafts/{id}/changes/sync
removeDraftChange(sessionId, changeId)          DELETE /api/drafts/{id}/changes/{changeId}
publishDraft(sessionId)                         POST /api/drafts/{id}/publish
discardDraft(sessionId)                         POST /api/drafts/{id}/discard
listOverlappingDrafts(unitId, range, exclude)   GET /api/drafts?unitId=...&from=...&to=...
savePresence(record) / deletePresence(id)       POST|PUT /api/presence, DELETE /api/presence/{id}
saveAbsence(record) / deleteAbsence(id)         POST|PUT /api/absences, DELETE /api/absences/{id}
history(range)                                  GET /api/history
```

`openDraft` takes an `editorId` parameter that it deliberately does **not** send: the
server takes the editor from the token ([ADR-0039](adr/0039-actor-identity-from-the-token.md)),
and the caller keeps the value only to filter *other people's* overlapping drafts.

Requests, approvals and notifications sit **outside** this boundary, as TanStack Query
Presence and absences sit on the repository but **outside the draft**: they are direct
writes (ADR-0043, ADR-0052), and an absence whose event type needs approval is refused by
the server so it has to go through `/api/requests` instead.

hooks in `api/requests.ts`. `ScheduleRepository` is the boundary for *the plan*
([ADR-0012](adr/0012-schedule-repository-boundary.md)); a request is a conversation about
a future change, and only its approved outcome ever reaches the schedule — through the
ordinary schedule query, like any other server-side write.

## API surface (implemented, Phase 2–8)

Base path `/api`, OpenAPI document generated by `Microsoft.AspNetCore.OpenApi`
(`/openapi/v1.json` in development). Every response is a named record in
`ShiftOMator.Api.Contracts` — no anonymous objects — so the OpenAPI document and the
generated `schema.d.ts` (`npm run api:schema:check`) actually describe what the wire
sends.

| Endpoint | Method | Purpose |
|---|---|---|
| `/auth/me` | GET | Current identity (stub in dev, Entra ID in production) |
| `/reference` | GET | Planning units (with their shifts/day-configs/absence-capacity-rules), locations, people, holidays |
| `/schedule` | GET | Coverage, issues and the plan slice for a unit + range; optional `draftId` overlays that draft's uncommitted changes without publishing |
| `/drafts` | POST | Open a new draft session |
| `/drafts` | GET | List open drafts overlapping a unit/range (concurrency banner) |
| `/drafts/{id}/changes` | GET | List a draft's changes, in order |
| `/drafts/{id}/changes` | POST | Append a `DraftChange` (Assignment, Absence, or CompDay) |
| `/drafts/{id}/changes/sync` | POST | **Declarative**: the client sends desired cell state for a whole painted range, the server derives create/update/delete and keeps one change per cell. Repainting a cell the draft already created is a replacement, not an UPDATE against a row that does not exist yet |
| `/drafts/{id}/changes/{changeId}` | DELETE | Remove a draft change (undo) |
| `/drafts/{id}/discard` | POST | Mark the session discarded |
| `/drafts/{id}/publish` | POST | One serializable transaction: revalidates against current state, applies changes, writes history, returns real `remainingGaps`; 409 with typed conflicts on a stale version |
| `/suggest` | POST | Ranked candidates for one shift on one date (preview only, no write) |
| `/auto-populate` | POST | Generate assignments for a range, up to `AutoPopulateService.MaxDays` (preview only, no write) |
| `/acknowledgements` | POST | Record or update an acknowledgement for a soft-rule issue key |
| `/people/{id}` | PUT | Update person eligibility, availability, preferences (not identity/roster fields) |
| `/history` | GET | Append-only audit log of **every** change, filterable by date range, `personId` and entity type ([ADR-0040](adr/0040-one-change-history-for-every-entity.md)) |
| `/presence` | GET | Presence records overlapping a range, optionally for one person |
| `/presence` | POST | Record where someone works. Own record, or Planner ([ADR-0043](adr/0043-presence-is-an-orthogonal-range-entity.md)) |
| `/presence/{id}` | PUT/DELETE | Amend or remove one. 409 on a stale version |
| `/request-types` | GET | The request types an admin has defined |
| `/requests` | GET | `?scope=mine` (yours) or `?scope=inbox` (waiting on you) |
| `/requests` | POST | Raise a request. Refused with `NO_APPROVER` if the route resolves to nobody |
| `/requests/{id}/decide` | POST | Approve, decline or return. A final approval materializes and notifies |
| `/requests/{id}/cancel` | POST | Withdraw — and undo whatever an approved one created |
| `/notifications` | GET | The caller's inbox and unread count ([ADR-0044](adr/0044-in-app-inbox-first.md)) |
| `/notifications/read` | POST | Mark all read |
| `/insights/gap-summary` | POST | Plain-English summary over a validator digest. 503 when no model is configured |
| `/insights/candidate-explanation` | POST | Why the ranker put this person first. Answers **with or without** a model — the deciding factor is computed |
| `/admin/{locations,holidays,units,shifts,absence-capacity-rules,people}` | GET/POST/PUT/DELETE | Admin-only CRUD |
| `/admin/day-configurations` | GET/POST/DELETE | Create-only for structural fields (ADR-0021); `PUT .../label` edits only the display label |

Rules:

- **Published assignments are immutable** — all mutations go through drafts and publish.
- Publish re-reads the plan fresh inside the transaction and revalidates every change
  against it; a stale or conflicting change fails the whole publish (nothing partial),
  returns 409, and the draft stays open for compare/refresh/reapply.
- A failed publish never touches the draft — every change is still there afterward.
- Bearer token auth establishes **who you are**; what you may do comes from
  `RoleAssignment` rows, projected into claims per request by `RoleClaimsTransformation`
  ([ADR-0051](adr/0051-roles-are-a-scoped-set.md)). Roles are a **set**
  (`Viewer`/`Planner`/`Approver`/`Admin`) with no ordering — an Admin is not a Planner.
- Endpoint policies check only "holds this role **somewhere**", because a policy runs
  before the body is read and cannot know which unit is being written to. The decision is
  the unit-scoped `Capabilities` check in the handler. A policy alone is never sufficient
  authorization for a write.
- **Self-service endpoints sit at `Authenticated` on purpose.** Every employee writes their
  own presence and their own requests, and "employee" is not a role. Ownership is a
  per-resource check ([ADR-0046](adr/0046-routing-is-not-authorization.md)).
- **The actor is the authenticated principal, never a request field**
  ([ADR-0039](adr/0039-actor-identity-from-the-token.md)).
- Unhandled exceptions become a typed `ErrorResponse` with the same shape the
  hand-caught ones use, and every response carries an `X-Correlation-Id`.

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

80 people, 4 planning units. Consequences, stated so nobody optimizes for a problem that
doesn't exist:

- a whole quarter (~7,200 assignments, ~1 MB JSON) loads in one request;
- no server-side pagination and no lazy loading while scrolling time;
- no virtualization in the timeline;

One thing this argument did **not** license, and used to be taken to:

- **the query behind the response is scoped** ([ADR-0041](adr/0041-scoped-dataset-loading.md)).
  `ScheduleDatasetLoader` used to read every plan row and the entire unbounded history
  table on seven endpoints, one of which does it inside a serializable transaction. Row
  counts scale with headcount; the history table scales with time.

And one that still holds:

- a month solves in a fraction of a second, so instant preview on weight changes is
  affordable.

Performance targets worth keeping: a 13-week coverage query under 200 ms p95; coverage
and schedule endpoints under 250 ms p95; auto-populate limited to 5 requests per minute
per user, publish to 10. **Rate limiting is not implemented** — worth doing before
self-service traffic makes it matter.

## Frontend directory structure

```
apps/web/src/
  domain/                types only (no fixtures — seeded on backend)
  engine/                dates, period math, timeline layout, cellValue and presence projections
  data/                  ScheduleRepository interface and HttpScheduleRepository
  store/                 Zustand: useSchedule (draft metadata), useUi (selection, range)
  api/                   TanStack Query hooks, OpenAPI-generated schema
  features/              planning grid, coverage strip, issues, absences, comp days,
                         presence, requests, shell, settings
  ui/                    Radix UI wrappers, theme tokens, shared styles
  auth/                  AuthProvider, stub identity
  pages/                 routed screens: Overview, Schedule, People, Requests,
                         Settings, DayDrilldown
apps/api/
  src/
    ShiftOMator.Domain/              entities, enums — mirrors frontend domain/types.ts
    ShiftOMator.Application/         engines and services
    ShiftOMator.Infrastructure/      EF Core DbContext, migrations, seed data
    ShiftOMator.Api/                 minimal APIs, DTOs, auth, OpenAPI emission
  tests/
    ShiftOMator.Application.Tests/   xUnit, engine tests + the Phase 8 baseline
    ShiftOMator.Api.Tests/           WebApplicationFactory integration tests
```

## Testing

**Backend (xUnit):** engines are the primary unit-test target with complete coverage.

- Coverage: single and multiple gaps, over-coverage, thin state, shift counts.
- Validation: what blocks and what does not, acknowledgements. Only two things block —
  a double assignment and an unknown or wrong-unit shift.
- CandidateRanker: eligibility, absences, 90-day fairness, recency, weekend targets.
- CompDayService: before/after windows, excluded weekdays, occupied dates, separate
  Saturday/Sunday earnings, pending approval, aging.
- AutoPopulateService: pass ordering (the starvation regressions especially), ceilings,
  weekend/duty-roster behaviour, determinism, gap reasons, 92-day rejection.
- DraftService: session lifecycle, change ordering, undo, publish atomicity,
  version conflicts.
- RequestService: the state machine, route resolution, skipping an unresolvable step,
  `ALL`-mode steps, and the refusal to invent an approval.
- CandidateDigest: the deciding factor — including the case where every measured
  criterion ties and the honest answer is "arbitrary".
- Seeding: shared fixture data loads correctly via EF Core.

**Backend (xUnit, integration):** `WebApplicationFactory` against a real LocalDB.
Policy enforcement, admin CRUD, draft publish and typed 409s, and self-service end to
end — raise a request, approve it, and assert the presence record it created exists.

**Frontend (Vitest):** integration and interaction tests.

- Draft lifecycle: undo, cancel, review, failed publish retains the draft, version
  reconciliation.
- Page states, keyboard operation, filter and selection persistence.
- Grid interaction: cell selection, picker, hotkeys, range painting.
- Presence projection: the delta-from-baseline rule, which is the whole design.
- Self-service through the UI: raise, approve, and check the result reaches the
  **schedule** — an approval that only flips a request's state has moved the
  spreadsheet, not replaced it.

MSW backs the frontend tests with a mock that **materializes on approval**, like the
server does. A mock that only changed a state field would let exactly the bug above
through.
