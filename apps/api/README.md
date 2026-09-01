# shift-o-mator API

.NET backend. Domain logic that used to live in `src/engine/` on the client moves here,
one implementation, not a mirrored port (see `Docs/adr/` for the ADRs on this).

## Layout

```
src/
  ShiftOMator.Domain/          entities and enums — mirrors src/domain/types.ts
  ShiftOMator.Application/     engines and services (Phase 3)
  ShiftOMator.Infrastructure/  EF Core, migrations, seeding
  ShiftOMator.Api/             minimal APIs, DTOs, auth, OpenAPI
tests/
  ShiftOMator.Application.Tests/  xUnit — ported from the client's Vitest suites
  ShiftOMator.Api.Tests/          WebApplicationFactory integration tests
```

## Running locally

Requires SQL Server LocalDB (`MSSQLLocalDB` instance) and the EF Core tools:

```
dotnet tool install --global dotnet-ef
dotnet run --project src/ShiftOMator.Api
```

Startup seeds **reference data only** — event types, presence types, request types, and
the role grants derived from whatever roster already exists. It is topped up row by row on
every start, because a leave type the product ships is part of the product rather than a
choice about whether the row exists.

Everything else is chosen in the app. Until a `SystemSetup` row exists the API answers
`503 SETUP_REQUIRED` to everything but `/health/*`, `/api/setup/*` and the OpenAPI
document, and the web client shows the setup wizard: **Bare** (one location, one unit, you
as global admin) or **Demo** (the fixture entire, including the sample plan the frontend
tests use). Afterwards Settings → Maintenance can load the demo data into an untouched
Bare system, or reset back to empty. See
[ADR-0059](../../Docs/adr/0059-setup-is-a-screen-not-a-flag.md).

The fixture lives in `src/ShiftOMator.Infrastructure/Seed/fixture-dataset.json`, a JSON
export of the TypeScript client's own `domain/fixtures.ts`, not a hand-transcribed copy —
see `FixtureSeeder`'s remarks for how to regenerate it.

## Verifying

```
dotnet build
dotnet test
```

`ShiftOMator.Api.Tests` boots the real app against a dedicated LocalDB database
(`ShiftOMatorTests`) — not an in-memory provider — so a green run is evidence the EF
model and the seed pipeline work against the database this actually ships on.
