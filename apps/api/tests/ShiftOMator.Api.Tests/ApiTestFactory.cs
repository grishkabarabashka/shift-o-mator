using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// Boots the real app against a dedicated LocalDB database, not an in-memory
/// provider — the whole point of these tests is proving the EF model and the seed
/// pipeline work against the database this ships on (Docs/12-architecture.md).
/// Program.cs's own startup migrate+seed runs unchanged; only the connection string
/// and demo-data flag are overridden.
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
    /// table* — <see cref="BootstrapAdminTests"/> is the case: its subject is a rule
    /// guarded on "no person has an email at all", which any other test that writes an
    /// email would silently switch off.
    ///
    /// NOTE: each name here is a real LocalDB database that outlives the run, and the
    /// single regenerated `InitialCreate` (CLAUDE.md) means every one of them needs
    /// dropping by hand when the schema moves — not just `ShiftOMatorTests`.
    /// </summary>
    public string DatabaseName { get; init; } = "ShiftOMatorTests";

    /// <summary>Extra configuration, applied after the defaults below so it can override
    /// them. Keeps auth-mode variations out of this class.</summary>
    public IReadOnlyDictionary<string, string>? Settings { get; init; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting(
            "ConnectionStrings:Schedule",
            $"Server=(localdb)\\MSSQLLocalDB;Database={DatabaseName};Trusted_Connection=True;TrustServerCertificate=True");
        builder.UseSetting("Seed:IncludeDemoData", "true");
        builder.UseSetting("Auth:StubRole", StubRole);

        foreach (var (key, value) in Settings ?? new Dictionary<string, string>())
            builder.UseSetting(key, value);
    }
}
