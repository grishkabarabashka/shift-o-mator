using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using ShiftOMator.Infrastructure;
using ShiftOMator.Infrastructure.Setup;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// Boots the real app against a dedicated LocalDB database, not an in-memory
/// provider — the whole point of these tests is proving the EF model and the seed
/// pipeline work against the database this ships on (Docs/12-architecture.md).
/// Program.cs's own startup migrate+seed runs unchanged (reference data only, ADR-0059);
/// this factory does what the setup wizard would do by hand, once, on the same database.
/// </summary>
public class ApiTestFactory : WebApplicationFactory<Program>
{
    /// <summary>
    /// The stub identity's app shift for this factory instance. Stub mode has no real
    /// "unauthenticated" state to test against (every request gets an identity), so
    /// this is how <see cref="AuthPolicyTests"/> exercises the low-privilege side of
    /// policy enforcement: a second factory pointed at the same database, stamped
    /// "Viewer" instead of the default "Planner".
    /// </summary>
    public string StubRole { get; init; } = "Planner";

    /// <summary>
    /// Which database this factory points at. Almost every test shares the default one,
    /// via the "Api" collection, because migrating and seeding is the slow part.
    ///
    /// A test needs its own only when it asserts something about the *state of the whole
    /// table* — <see cref="PersonEmailTests"/> is one case, and <see cref="SetupEndpointsTests"/>
    /// another: its subject is what a database looks like *before* anything has seeded it,
    /// which any other test sharing the database would have already done.
    ///
    /// NOTE: each name here is a real LocalDB database that outlives the run, and the
    /// single regenerated `InitialCreate` (CLAUDE.md) means every one of them needs
    /// dropping by hand when the schema moves — not just `ShiftOMatorTests`.
    /// </summary>
    public string DatabaseName { get; init; } = "ShiftOMatorTests";

    /// <summary>
    /// Whether this factory seeds the Demo preset itself, once, before the first request —
    /// the same write <c>POST /api/setup</c> with <c>preset: Demo</c> would make. True for
    /// every test that just wants a working roster to test something else against; false
    /// for tests whose subject is the setup wizard or the gate in front of it (ADR-0059).
    /// </summary>
    public bool SeedDemoOnStart { get; init; } = true;

    /// <summary>Extra configuration, applied after the defaults below so it can override
    /// them. Keeps auth-mode variations out of this class.</summary>
    public IReadOnlyDictionary<string, string>? Settings { get; init; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting(
            "ConnectionStrings:Schedule",
            $"Server=(localdb)\\MSSQLLocalDB;Database={DatabaseName};Trusted_Connection=True;TrustServerCertificate=True");
        // Pinned, not inherited. `appsettings.json` is a shared, committed file, and a
        // developer switching it to EntraId to test real sign-in locally used to put the
        // entire suite behind a bearer token it has no way to produce — 86 tests failing
        // on 401 with nothing in the diff to explain it. `Settings` is applied after this,
        // so EntraIdentityTests can still ask for the other mode deliberately.
        builder.UseSetting("Auth:Mode", "Stub");
        builder.UseSetting("Auth:StubRole", StubRole);
        builder.UseSetting("Auth:StubPersonId", string.Empty);

        foreach (var (key, value) in Settings ?? new Dictionary<string, string>())
            builder.UseSetting(key, value);
    }

    protected override IHost CreateHost(IHostBuilder builder)
    {
        var host = base.CreateHost(builder);
        if (SeedDemoOnStart) SeedAsync(host).GetAwaiter().GetResult();
        return host;
    }

    /// <summary>
    /// What "seeded" means for a plain <see cref="ApiTestFactory"/>: the Demo preset, with
    /// nobody's email linked (Stub mode has no claims to link one from). Overridden by
    /// <see cref="EntraIdentityTests"/>'s factory to also link a caller's email — the same
    /// extra step the wizard takes automatically outside Stub mode.
    /// </summary>
    protected virtual async Task SeedAsync(IHost host)
    {
        using var scope = host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ScheduleDbContext>();
        if (await SetupService.IsRequiredAsync(db))
            await SetupService.CompleteDemoAsync(db, callerEmail: null);
    }
}
