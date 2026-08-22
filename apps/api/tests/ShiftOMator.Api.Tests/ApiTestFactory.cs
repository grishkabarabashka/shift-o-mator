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

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting(
            "ConnectionStrings:Schedule",
            "Server=(localdb)\\MSSQLLocalDB;Database=ShiftOMatorTests;Trusted_Connection=True;TrustServerCertificate=True");
        builder.UseSetting("Seed:IncludeDemoData", "true");
        builder.UseSetting("Auth:StubRole", StubRole);
    }
}
