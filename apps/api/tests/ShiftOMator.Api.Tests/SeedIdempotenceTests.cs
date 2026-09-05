using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;
using ShiftOMator.Infrastructure.Seed;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// Seeding a database that is **not** empty.
///
/// The defect these cover was structural and silent. The seeder guarded whole blocks with
/// "if any row of this exists, skip the block", so a database seeded before a type was
/// added never got that type — and a database that already had planning units never
/// reached the role-grant step at all, because it sat after an early return. The symptom
/// was an installation where every screen was read-only and nobody could work out why.
///
/// Reference data has fixed ids, so the fix is to insert what is missing rather than to
/// skip. The demo plan keeps the all-or-nothing rule, because it has no natural key and
/// re-running it would duplicate a roster somebody may have edited.
/// </summary>
public class SeedIdempotenceTests(SeedIdempotenceTests.Factory factory) : IClassFixture<SeedIdempotenceTests.Factory>
{
    /// <summary>
    /// Its own database, not the "Api" collection's shared one: xUnit runs collections in
    /// parallel, and this class reaches for a bare <see cref="ApiTestFactory"/> outside
    /// that collection, so sharing the default database name would race the shared
    /// factory's own startup seeding against this one's.
    /// </summary>
    public sealed class Factory : ApiTestFactory
    {
        public Factory() => DatabaseName = "ShiftOMatorSeedIdempotenceTests";
    }

    private async Task<(IServiceScope Scope, ShiftOMatorDbContext Db)> OpenAsync()
    {
        // Creating a client is what boots the app and runs the startup migrate+seed.
        factory.CreateClient();
        var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ShiftOMatorDbContext>();
        await db.Database.EnsureCreatedAsync();
        return (scope, db);
    }

    [Fact]
    public async Task A_missing_event_type_is_restored_on_a_populated_database()
    {
        var (scope, db) = await OpenAsync();
        using var _ = scope;

        // Stand in for a database seeded before this type existed.
        await db.EventTypes.Where(t => t.Id == EventTypeIds.Unavailable).ExecuteDeleteAsync();
        Assert.False(await db.EventTypes.AnyAsync(t => t.Id == EventTypeIds.Unavailable));

        await FixtureSeeder.SeedAsync(db);

        Assert.True(await db.EventTypes.AnyAsync(t => t.Id == EventTypeIds.Unavailable));
    }

    [Fact]
    public async Task A_missing_request_type_is_restored_even_though_others_exist()
    {
        // The old guard was `if (RequestTypes.Any()) return` — the presence of *any* type
        // was read as "this block is done".
        var (scope, db) = await OpenAsync();
        using var _ = scope;

        await db.RequestTypes.Where(t => t.Id == "rt-sick").ExecuteDeleteAsync();
        Assert.True(await db.RequestTypes.AnyAsync(), "other request types should still be there");

        await FixtureSeeder.SeedAsync(db);

        Assert.True(await db.RequestTypes.AnyAsync(t => t.Id == "rt-sick"));
    }

    [Fact]
    public async Task Role_grants_are_seeded_on_a_database_that_already_has_units()
    {
        // The one that mattered: this step sat after `if (PlanningUnits.Any()) return`, so
        // on any existing database it never ran. Nobody could plan, approve or administer.
        var (scope, db) = await OpenAsync();
        using var _ = scope;

        await db.RoleAssignments.ExecuteDeleteAsync();
        Assert.True(await db.PlanningUnits.AnyAsync(), "units should already be there");

        await FixtureSeeder.SeedAsync(db);

        var grants = await db.RoleAssignments.AsNoTracking().ToListAsync();
        Assert.NotEmpty(grants);
        Assert.Contains(grants, g => g.Role == AppRole.Planner);
        Assert.Contains(grants, g => g.Role == AppRole.Approver);
        // Exactly one global admin, so the configuration belonging to no unit has an owner.
        Assert.Single(grants, g => g.Role == AppRole.Admin && g.UnitId is null);
    }

    [Fact]
    public async Task Seeding_twice_adds_nothing_the_second_time()
    {
        var (scope, db) = await OpenAsync();
        using var _ = scope;

        await FixtureSeeder.SeedAsync(db);
        var before = (
            await db.EventTypes.CountAsync(),
            await db.RequestTypes.CountAsync(),
            await db.RoleAssignments.CountAsync(),
            await db.People.CountAsync(),
            await db.Assignments.CountAsync());

        await FixtureSeeder.SeedAsync(db);
        var after = (
            await db.EventTypes.CountAsync(),
            await db.RequestTypes.CountAsync(),
            await db.RoleAssignments.CountAsync(),
            await db.People.CountAsync(),
            await db.Assignments.CountAsync());

        Assert.Equal(before, after);
    }
}
