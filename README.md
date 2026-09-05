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

See [Docs/](Docs/) for design decisions and architecture, and
[deploy/README.md](deploy/README.md) for everything about running this anywhere other than
your own machine — local Entra ID and AI setup, container images, the AKS sandbox, and the
shape production would take.

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

# Build and run the backend
dotnet run --project src/ShiftOMator.Api
```

Then open the app. A database with nothing in it serves the **setup wizard** instead of
the product, and what it starts as is chosen there rather than in a config file
([ADR-0059](Docs/adr/0059-setup-is-a-screen-not-a-flag.md)):

- **Bare** — one location, one planning unit, and you as the global administrator.
  Everything else is entered on Settings afterwards. This is what a real rollout uses.
- **Demo** — the fixture entire: four planning units, a trimmed roster, shifts, day
  configurations and a sample rota. This is what local development uses.

The roster is **trimmed** on its way in: `fixture-dataset.json` holds the real team's 76
people because the Phase 8 baseline comparison is only meaningful at that size, while the
database gets a handful per unit plus every manager. Enough to exercise coverage, gaps and
approvals; few enough to read.

**Reference data is the exception, and is not a choice.** Event types, presence types and
request types have fixed ids and are **topped up on every start** — whatever is missing
gets inserted, and what is already there is left alone. That is what makes it safe to add
a type in a later release and have existing databases pick it up. A leave type the product
ships is part of the product, not something an admin decides the existence of; what they
decide is which are offered. Editing a seeded row keeps your edit; retiring one is
`isActive = false` rather than a delete, since a deleted row comes back on the next start.

### Starting over

Settings → Maintenance → **Reset to empty** deletes every location, unit, person, shift
and record and hands the setup wizard back, without touching the schema. That is the
normal way, and it needs no restart.

`--reset-db` is the other one, and it is for a different problem — the schema itself
moving:

```bash
dotnet run --project src/ShiftOMator.Api -- --reset-db
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

# Backend (from apps/api/)
dotnet build
dotnet test                 # the API tests use a real LocalDB, not an in-memory provider
```

## Configuration

| Setting | Default | Notes |
|---|---|---|
| `ConnectionStrings:ShiftOMator` | LocalDB `ShiftOMator` | |
| `Auth:Mode` | `Stub` | Anything else wires real JWT bearer validation from `Auth:Jwt` |
| `Auth:StubPersonId` | *(empty)* | Pins which person the stub acts as; empty lets `ActorResolver` pick one |
| `Auth:StubRole` | *(empty)* | **Leave it empty.** It *overrides* the person's real grants, so setting it means `RoleAssignment` is never read — which is how Settings and the Approve button went missing for everybody |
| `Cors:AllowedOrigins` | `http://localhost:5173` | Explicit origins, never a wildcard |
| *(not a setting)* | — | The hosts the holiday import may fetch a calendar from are **rows**, not configuration (ADR-0065) — an admin manages them at Settings → Maintenance. `Holidays:AllowedCalendarHosts` was that setting and is gone; unlike `Auth:DirectoryRoles`, which throws at startup, this one is simply not read |
| `Ai:Provider` | `none` | `azure-openai`, `openai`, or `none`. Unconfigured is a supported state, not an error — see `deploy/README.md` section 2b to switch it on locally |
| `Ai:Model` | *(empty)* | For `azure-openai` this is the **deployment** name, not the model family |
| `Ai:Endpoint` | *(empty)* | Required by `azure-openai` (the resource URL). Optional for `openai`, where it points the same branch at any OpenAI-compatible gateway — including a model runtime on localhost, which needs no key at all |
| `Ai:ApiKey` | — | Set it as the `Ai__ApiKey` environment variable or through user-secrets, never a settings file. Needed by neither `azure-openai` (which authenticates as itself via `DefaultAzureCredential`) nor a keyless local endpoint |

## Scripts (repo root)

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on http://localhost:5173 |
| `npm run build` | typecheck and production build |
| `npm run preview` | preview the built bundle |
| `npm test` | Vitest in watch mode |
| `npm run test:run` | Vitest, single run (CI) |
| `npm run typecheck` | `tsc --noEmit` |
