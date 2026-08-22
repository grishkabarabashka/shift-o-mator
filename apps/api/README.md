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
dotnet run --project src/ShiftOMator.Api -- --seed-demo
```

`--seed-demo` loads the same demo plan data (assignments, absences, comp days) the
frontend fixtures ship with. Without it, only reference data seeds (regions, roles, day
configurations, people, ...) — what a real deployment should come up with.

Reference data is seeded from `src/ShiftOMator.Infrastructure/Seed/fixture-dataset.json`,
a JSON export of the TypeScript client's own `domain/fixtures.ts`, not a hand-transcribed
copy — see `FixtureSeeder`'s remarks for how to regenerate it.

## Verifying

```
dotnet build
dotnet test
```

`ShiftOMator.Api.Tests` boots the real app against a dedicated LocalDB database
(`ShiftOMatorTests`) — not an in-memory provider — so a green run is evidence the EF
model and the seed pipeline work against the database this actually ships on.
