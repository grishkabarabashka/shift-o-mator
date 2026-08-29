# shift-o-mator

Shift planning, coverage and self-service for a global application support team
(~80 people across four planning units: `unit-amer`, `unit-emea`, `unit-apac` and the
cross-cutting `unit-st` for Service Transition). Replaces manual planning in a shared
Excel file, and the separate portal people used to record leave and remote days in.

**Features:**
- Continuous coverage checks per planning unit and shift
- Draft sessions with concurrent editing and conflict reconciliation
- Comp day accrual and window-based placement
- Presence: who is remote, in which office, travelling or on a customer site
- Self-service requests, approved by the unit's approvers, with an in-app inbox
- Absence import from leave systems, for history and anything still arriving outside
- Candidate ranking for fairness and rotation, with a plain-English "why this person"
- Admin surface for configuration
- Audit trail of every change — schedule, leave, presence, profiles and configuration

**Architecture:**
- Frontend (React 19 + Vite + Zustand) talks entirely over REST to a .NET backend
- Backend owns all domain logic: coverage, validation, candidate ranking, approvals
- SQL Server persistence with EF Core; demo seed data included
- Stubbed auth (development) / Entra ID (production)
- Optional LLM for explanations only — it never decides and never writes

See [Docs/](Docs/) for design decisions and architecture.

## Running locally

### Prerequisites

- **Frontend:** Node.js 22+, npm
- **Backend:** .NET 10 SDK, SQL Server LocalDB

### Frontend setup

```bash
npm install
npm run dev
```

Open http://localhost:5173. `VITE_API_URL` overrides the API base URL, which defaults to
`http://localhost:5106`.

### Backend setup (from `apps/api/`)

Ensure SQL Server LocalDB is installed (`MSSQLLocalDB` instance).

```bash
# Install Entity Framework CLI tool (one time)
dotnet tool install --global dotnet-ef

# Build and run the backend with demo seed data
dotnet run --project src/ShiftOMator.Api -- --seed-demo
```

Two kinds of seed data, with two different rules.

**Reference data** — event types, request types, role grants — has fixed ids and is
**topped up on every start**: whatever is missing gets inserted, and what is already there
is left alone. That is what makes it safe to add a type in a later release and have
existing databases pick it up. Editing a seeded row keeps your edit; retiring one is
`isActive = false` rather than a delete, since a deleted row comes back on the next start.

**The roster and the demo plan** — locations, units, shifts, day configurations, holidays,
people, and behind `--seed-demo` the assignments, absences and comp days — are written
once, into an empty database. They have no natural key, so re-running them would duplicate
a roster somebody may have edited. A first production run does not come up pre-populated
with fabricated shifts.

The roster is **trimmed** on its way in: `fixture-dataset.json` holds the real team's 76
people because the Phase 8 baseline comparison is only meaningful at that size, while the
database gets a handful per unit plus every manager. Enough to exercise coverage, gaps and
approvals; few enough to read.

### Starting over

```bash
dotnet run --project src/ShiftOMator.Api -- --reset-db --seed-demo
```

`--reset-db` drops the database and rebuilds it from the single migration. It exists
because while there is no production data the schema is kept as a **single `InitialCreate`
that is regenerated** rather than appended to, so every schema change orphans the existing
database: EF sees a migration id it does not recognise and tries to create tables that are
already there.

Startup detects that state and names the fix rather than failing with
`There is already an object named 'Absences'`. It is a flag and not a default because it
destroys everything — "the app wiped my data on start" must never be something that just
happens.

The test database (`ShiftOMatorTests`) needs dropping by hand when the schema moves; the
next test run recreates it. Once real data exists none of this is acceptable any more and
migrations become incremental again.

In development the OpenAPI document is at `/openapi/v1.json` and a browsable reference at
`/scalar`.

### Verify both halves

```bash
# Frontend (from the repo root)
npm run typecheck
npm run test:run
npm run build
npm run api:schema:check    # needs the API running

# Backend (from apps/api/)
dotnet build
dotnet test                 # the API tests use a real LocalDB, not an in-memory provider
```

## Configuration

| Setting | Default | Notes |
|---|---|---|
| `ConnectionStrings:Schedule` | LocalDB `ShiftOMator` | |
| `Auth:Mode` | `Stub` | Anything else wires real JWT bearer validation from `Auth:Jwt` |
| `Auth:StubPersonId` | *(empty)* | Pins which person the stub acts as; empty lets `ActorResolver` pick one |
| `Auth:StubRole` | *(empty)* | **Leave it empty.** It *overrides* the person's real grants, so setting it means `RoleAssignment` is never read — which is how Settings and the Approve button went missing for everybody |
| `Cors:AllowedOrigins` | `http://localhost:5173` | Explicit origins, never a wildcard |
| `Holidays:AllowedCalendarHosts` | `["calendar.google.com"]` | Hosts the holiday import may fetch a calendar from. An admin endpoint that fetches an arbitrary URL is a request-forgery proxy pointed at whatever the server can reach, so this list is the control, not a formality. Pasting a `.ics` file needs nothing here |
| `Ai:Provider` | `anthropic` | `none` disables it; unconfigured is a supported state, not an error |
| `Ai:Model` | `claude-opus-5` | |
| `ANTHROPIC_API_KEY` | — | Environment only, never a settings file |

## Scripts (repo root)

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on http://localhost:5173 |
| `npm run build` | typecheck and production build |
| `npm run preview` | preview the built bundle |
| `npm test` | Vitest in watch mode |
| `npm run test:run` | Vitest, single run (CI) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run api:schema` | Regenerate OpenAPI types from the running backend |
| `npm run api:schema:check` | Fail the build if types drift from the schema (CI) |
