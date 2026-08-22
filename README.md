# shift-o-mator

Shift planning and visualization for a global application support team (~80 people,
3 regions: AMER, EMEA, APAC). Replaces manual planning in a shared Excel file.

**Features:**
- Continuous coverage checks per region and role
- Draft sessions with concurrent editing and conflict reconciliation
- Comp day accrual and window-based placement
- Absence import from leave systems
- Candidate ranking for fairness and rotation
- Admin surface for configuration (read-only pending effective-dated versioning)
- Audit trail of every published change

**Architecture:**
- Frontend (React 19 + Vite + Zustand) talks entirely over REST to a .NET backend
- Backend owns all domain logic: coverage, validation, candidate ranking
- SQL Server persistence with EF Core; demo seed data included
- Stubbed auth (development) / Entra ID (production)

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

Open http://localhost:5173. The frontend will proxy API calls to `http://localhost:5000`.

### Backend setup (from `api/` directory)

Ensure SQL Server LocalDB is installed (`MSSQLLocalDB` instance).

```bash
# Install Entity Framework CLI tool (one time)
dotnet tool install --global dotnet-ef

# Build and run the backend with demo seed data
dotnet run --project src/ShiftOMator.Api -- --seed-demo
```

Server listens on http://localhost:5000. Navigate to `/swagger.json` for the OpenAPI
schema.

### Verify both halves

```bash
# Frontend (from root)
npm run typecheck
npm run test:run
npm run build
npm run api:schema:check

# Backend (from api/)
dotnet build
dotnet test
```

## Scripts (frontend root)

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on http://localhost:5173 |
| `npm run build` | typecheck and production build |
| `npm run preview` | preview the built bundle |
| `npm test` | Vitest in watch mode |
| `npm run test:run` | Vitest, single run (CI) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run api:schema` | Regenerate OpenAPI types from backend schema |
| `npm run api:schema:check` | Fail build if types drift from schema (CI) |
