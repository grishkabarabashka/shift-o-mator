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
| Deployment | Containers + Helm on AKS | two images, one chart; workload identity for SQL and the model, so neither environment needs a Key Vault. Guide: [../deploy/README.md](../deploy/README.md) |
| Identity | Entra ID in production, a stub locally | `Auth:Mode=EntraId` validates a real JWT and resolves the person by email ([ADR-0058](adr/0058-entra-id-identity-is-linked-by-email.md)); stub mode keeps a switchable local identity. Roles are a scoped set held in the database ([ADR-0051](adr/0051-roles-are-a-scoped-set.md)) |
| Solver | Backend (C#) | candidate ranker runs server-side for fairness and history; not portable to frontend |
| Explanations | Optional model behind `IChatClient` | phrases a pre-computed digest and nothing else; unconfigured is a supported state ([ADR-0048](adr/0048-ai-explains-the-plan-never-decides-it.md)). The provider is a **deployment**, not a vendor: `azure-openai` authenticates with the same managed identity SQL uses ([ADR-0060](adr/0060-the-model-is-a-deployment-not-a-vendor.md)) |

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

## API surface (implemented, Phases 2–14)

Base path `/api`, OpenAPI document generated by `Microsoft.AspNetCore.OpenApi`
(`/openapi/v1.json` in development). Every response is a named record in
`ShiftOMator.Api.Contracts` — no anonymous objects — so the OpenAPI document and the
generated `schema.d.ts` (`npm run api:schema:check`) actually describe what the wire
sends.

| Endpoint | Method | Purpose |
|---|---|---|
| `/setup/state` | GET | **Anonymous.** Whether setup is required, and whether the server is in stub mode — nothing else ([ADR-0059](adr/0059-setup-is-a-screen-not-a-flag.md)) |
| `/setup` | POST | Run the first-run wizard: `Bare` or `Demo`. Refused once `SystemSetup` exists |
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
| `/history/cell` | GET | The audit timeline for one (person, date) — what the grid's cell menu reads |
| `/absences` | GET/POST | Time off overlapping a range; a direct write, refused with `APPROVAL_REQUIRED` when the event type needs approving ([ADR-0052](adr/0052-two-flows-drafts-for-shifts-approval-for-everything-else.md)) |
| `/absences/{id}` | PUT/DELETE | Amend or remove one. 409 on a stale version ([ADR-0042](adr/0042-concurrency-tokens-for-absences-and-comp-days.md)) |
| `/drafts/staged` | GET | Cells staged in **other** planners' open drafts, for the hatching in the grid (polled; not a lock) |
| `/me/calendar` | GET | The signed-in person's own long window, behind the `['my-calendar']` query key ([ADR-0055](adr/0055-a-personal-calendar-and-a-feed.md)) |
| `/me/calendar-feed` | GET/POST `…/reset` | The caller's subscription URL, and a new token when they want the old one dead |
| `/calendar/{token}.ics` | GET | **Anonymous by necessity** — a calendar client cannot carry a bearer token. `Person.CalendarToken` is the whole of its authentication: 256 bits, `[JsonIgnore]`, replaced at seed time, and a wrong token 404s exactly as an unknown route does |
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
| `/admin/{event-types,presence-types}` | GET/POST/PUT/DELETE | Kinds of leave ([ADR-0049](adr/0049-event-types-are-data.md)) and ways of working ([ADR-0054](adr/0054-presence-types-are-an-open-set.md)). DELETE is refused once anything points at the row — the answer is to untick Offered |
| `/admin/role-assignments` | GET/POST/DELETE | Role grants. Only a **global** admin may make a global grant, and revoking the last one is refused ([ADR-0051](adr/0051-roles-are-a-scoped-set.md)) |
| `/admin/people/batch` | POST | Every pending person edit, or none: releases of a unique value first, one transaction, errors keyed by the caller's op index ([ADR-0061](adr/0061-settings-saves-people-as-one-unit.md)) |
| `/admin/notifications/rules` | GET/PUT | The (kind × channel) matrix, saved whole — one screen, one intent. Global admin to write ([ADR-0064](adr/0064-a-notification-policy-and-a-log.md)) |
| `/admin/notifications/log` | GET | Every notification and what each channel did about it. `?kind=&channel=&status=&personId=&from=&to=` |
| `/admin/notifications/log/deliveries/{id}/retry` | POST | A **failed** delivery back to pending. Refused on anything else — a skipped one is answered by the matrix, not by trying again — and `attempts` is never reset |
| `/admin/holidays/import` | POST | Read an iCalendar feed — pasted, uploaded, or fetched from a host on the `AllowedCalendarHost` allowlist — and **add** missing days. It never removes one; this is an import, not a sync |
| `/admin/allowed-calendar-hosts` | GET/POST/DELETE | The holiday-import allowlist. A row, not configuration, for the same reason `SystemSetup.DirectoryRoles` is (ADR-0063) — read per request, invisible as a deploy key. Global admin to write |
| `/admin/maintenance/{load-demo-data,reset,can-load-demo-data}` | GET/POST | Global admin only. Reset means migrated-and-empty: rows deleted in dependency order inside one transaction, never a dropped database ([ADR-0059](adr/0059-setup-is-a-screen-not-a-flag.md)) |
| `/health/live`, `/health/ready` | GET | Kubernetes probes. Outside the setup gate, and outside authentication |

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
  The **database is the single source by default**: `Auth:DirectoryRoles` is `false`, so the
  token's `roles` claim is not read at all ([ADR-0062](adr/0062-one-source-of-roles-by-default.md)).
  Switching it on adds directory app roles as global grants — and brings back grants that
  Settings → Roles cannot show.
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

## Running it, and deploying it

**A fresh database is a screen, not a flag** ([ADR-0059](adr/0059-setup-is-a-screen-not-a-flag.md)).
`SetupGateMiddleware` sits **before** authentication and answers `503 SETUP_REQUIRED` to
everything except `/health/*`, `/api/setup/*`, `/openapi` and `/scalar` — the last two
because `npm run api:schema` fetches the document against a database nobody has set up.
`SystemSetup` is one row with a fixed key and its presence is the whole condition; an
inferred one ("no planning units exist") would be satisfied by a half-written database and
reopen the wizard on top of itself.

Startup seeds **reference data and nothing else**, topped up per row so a database seeded
before a type existed picks it up, with `SeedRolesAsync` running unconditionally beside it
as a derivation over whatever roster exists. The roster and the demo plan are written by
the setup wizard, never by `Program.cs`.

**The schema is one migration.** There is no production data yet, so `InitialCreate` is
regenerated rather than appended to — which invalidates every existing database.
`EnsureSchemaIsReconcilableAsync` refuses startup with a message naming the fix instead of
the opaque `There is already an object named 'Absences'`, and `--reset-db` drops and
rebuilds. Once real data exists this stops being true and migrations become incremental.

**Deployment** is two container images (`apps/api/Dockerfile`, `apps/web/Dockerfile`) and
one Helm chart (`deploy/helm/shift-o-mator`), with `values-sandbox.yaml` and
`values-prod.yaml` over a shared `values.yaml`. The shape, and why it has the edges it has:

| Concern | How | Why not the obvious alternative |
|---|---|---|
| SQL | `Authentication=Active Directory Default` in the connection string | The same string works locally (`az login`) and in the cluster (workload identity), so there is nothing environment-specific to keep in step — and no password to rotate |
| The model | `azure-openai` with an empty `Ai:ApiKey` → `DefaultAzureCredential`, granted `Cognitive Services OpenAI User` | One role assignment replaces a key, a vault, a CSI mount and a rotation policy ([ADR-0060](adr/0060-the-model-is-a-deployment-not-a-vendor.md)) |
| JWT settings | `Authority` / `Audience` as ConfigMap values | An issuer URL and an Application ID URI authenticate nothing on their own |
| Key Vault | `azureKeyVault.enabled: false` by default | Nothing in either environment needs a secret. Create one only for a SQL password or a key-authenticated model endpoint |
| AI in the chart | `aiProvider: none` | Under `azure-openai` a blank endpoint or deployment name **throws at startup**; crash-looping the API over an optional feature is the worse failure |

Under `azure-openai` a missing key is normal, so the misconfiguration that gets caught is a
blank `Ai:Endpoint`/`Ai:Model`. Under `openai` a key *or* an endpoint counts as configured,
because a model runtime on localhost (Foundry Local, Ollama) authenticates nobody and
demanding a key it will ignore would make the honest configuration the broken one. Only
when **neither** is set does the feature report itself unconfigured — and unconfigured is a
supported state, not an error.

The operator guide — local runs, Entra ID app registration, image builds, the AKS
walkthrough, rollback and troubleshooting — is [../deploy/README.md](../deploy/README.md).

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
  ui/                    Radix UI wrappers, theme tokens, elevation ladder, toasts,
                         the one ErrorBoundary (ADR-0057)
  auth/                  AuthProvider, stub identity, EntraGate (MSAL) and SetupGate —
                         SetupGate sits between them (ADR-0059)
  pages/                 routed screens: Overview, Schedule, People, Requests,
                         Settings, DayDrilldown, MyCalendar (/me, ADR-0055)
apps/api/
  src/
    ShiftOMator.Domain/              entities, enums — mirrors frontend domain/types.ts
    ShiftOMator.Application/         engines and services
    ShiftOMator.Infrastructure/      EF Core DbContext, migrations, seed data
    ShiftOMator.Api/                 minimal APIs, DTOs, auth, OpenAPI emission
  tests/
    ShiftOMator.Application.Tests/   xUnit, engine tests + the Phase 8 baseline
    ShiftOMator.Api.Tests/           WebApplicationFactory integration tests
apps/api/Dockerfile, apps/web/Dockerfile     container images
deploy/helm/shift-o-mator/                   the chart, values-sandbox and values-prod
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
- RequestService: the state machine, resolving the approvers of the subject's unit and
  falling through to admins when it has none, and the refusal to invent an approval.
  `ApprovalRoute` and multi-step approval are gone, so nothing tests them
- CandidateDigest: the deciding factor — including the case where every measured
  criterion ties and the honest answer is "arbitrary".
- Seeding: shared fixture data loads correctly via EF Core.

**Backend (xUnit, integration):** `WebApplicationFactory` against a real LocalDB.
Policy enforcement, admin CRUD, draft publish and typed 409s, and self-service end to
end — raise a request, approve it, and assert the presence record it created exists.

**Five test databases, and a reason for each.** `ShiftOMatorTests` is shared by almost
everything. `ShiftOMatorPersonEmailTests`, `ShiftOMatorEntraTests` and
`ShiftOMatorSeedIdempotenceTests` opt out via `ApiTestFactory.DatabaseName`, because each
one's subject is a property of a **whole table** — the exact roster size
`ReferenceEndpointsTests` asserts, which any other test writing a person or an email would
silently invalidate. Those four need dropping by hand when the schema moves.
`ShiftOMatorSetupTests` is the exception that drops and recreates itself in the test: a
`SystemSetup` row surviving between runs would make a rerun see a system that thinks it is
already set up. All the setup cases share that one database — the class carries no
`[Collection]`, so xUnit runs its methods sequentially and each gets it untouched.

**Dropping a test database and immediately re-running races**: several collections then
create it at once and fail on duplicate keys. Run twice, or drop between runs, not during.

**Frontend (Vitest):** integration and interaction tests.

- Draft lifecycle: undo, cancel, review, failed publish retains the draft, version
  reconciliation.
- Page states, keyboard operation, filter and selection persistence.
- Grid interaction: cell selection, picker, hotkeys, range painting.
- Presence projection: every recorded day is drawn, coloured by type and quieter when it
  matches the baseline — the earlier draw-only-departures rule was reversed by ADR-0050
- Self-service through the UI: raise, approve, and check the result reaches the
  **schedule** — an approval that only flips a request's state has moved the
  spreadsheet, not replaced it.

MSW backs the frontend tests with a mock that **materializes on approval**, like the
server does. A mock that only changed a state field would let exactly the bug above
through.

## Verify with

```bash
# Frontend — from the repo root; the npm workspace delegates to apps/web
npm run typecheck
npm run test:run
npm run build
npm run api:schema:check      # the generated types have not drifted from the OpenAPI document

# Backend — from apps/api/
dotnet build
dotnet test
```

`api:schema:check` is the one that catches a contract change nobody meant to make: it
regenerates `apps/web/src/api/schema.d.ts` from the running API's OpenAPI document and
fails if it differs from what is committed.
