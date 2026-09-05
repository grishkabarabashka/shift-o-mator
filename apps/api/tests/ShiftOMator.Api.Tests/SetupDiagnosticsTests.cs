using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// What the setup wizard can honestly tell you about the system it just made (ADR-0063).
///
/// The gap this closes was not cosmetic. Setting up with the Demo preset silently writes
/// your token's email onto whichever fixture person happens to hold the global Admin
/// grant, so "why is my address on somebody I have never heard of" had no answer on
/// screen. And the Bare preset leaves a system that cannot be planned in — no shifts, no
/// day configurations, and one person who is deliberately not planned — with nothing
/// saying so.
///
/// Its own database, because these cases run setup itself: the shared fixture is seeded
/// on first touch and can no longer show an unset-up system.
/// </summary>
public class SetupDiagnosticsTests
{
    /// <summary>
    /// A database per case, and <c>StubRole</c> deliberately empty.
    ///
    /// The empty role is load-bearing: <c>Auth:StubRole</c> is an *override*, and
    /// <c>RoleClaimsTransformation</c> returns as soon as it sees one — the stored grants
    /// are never read. Every assertion here is about what setup wrote into
    /// <c>RoleAssignments</c>, so a stub role would answer a different question and answer
    /// it the same way whatever the wizard did (CLAUDE.md).
    /// </summary>
    private static ApiTestFactory Factory(string databaseName)
    {
        var connectionString =
            $"Server=(localdb)\\MSSQLLocalDB;Database={databaseName};Trusted_Connection=True;TrustServerCertificate=True";
        using (var db = new ShiftOMatorDbContext(
            new DbContextOptionsBuilder<ShiftOMatorDbContext>().UseSqlServer(connectionString).Options))
        {
            db.Database.EnsureDeleted();
        }

        return new ApiTestFactory
        {
            DatabaseName = databaseName,
            StubRole = string.Empty,
            SeedDemoOnStart = false,
        };
    }

    private static async Task<JsonElement> SetUpBareAsync(
        HttpClient client, object? roles = null, bool directoryRoles = false)
    {
        var response = await client.PostAsJsonAsync("/api/setup", new
        {
            preset = "BARE",
            directoryRoles,
            bare = new
            {
                locationName = "London",
                timeZone = "Europe/London",
                holidayCalendarKey = "uk",
                unitName = "Support",
                unitKind = "REGION",
                displayName = "Founding Admin",
                email = "founder@example.test",
                roles,
            },
        });

        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task The_founding_admin_gets_only_Admin_when_nothing_else_was_asked_for()
    {
        using var factory = Factory("ShiftOMatorSetupDiagAdminOnly");
        var client = factory.CreateClient();
        await SetUpBareAsync(client);

        var roles = await RolesOfAsync(client);

        Assert.Contains("Admin", roles);
        Assert.DoesNotContain("Planner", roles);
    }

    [Fact]
    public async Task Asking_for_Planner_grants_it_alongside_Admin_rather_than_instead_of_it()
    {
        // The trap this exists for: Admin does not imply Planner (ADR-0051), so a founding
        // administrator could not open a draft in the system they had just created — a
        // correct configuration that is indistinguishable from a broken one.
        using var factory = Factory("ShiftOMatorSetupDiagWithPlanner");
        var client = factory.CreateClient();
        await SetUpBareAsync(client, roles: new[] { "Planner", "Approver" });

        var roles = await RolesOfAsync(client);

        Assert.Contains("Admin", roles);
        Assert.Contains("Planner", roles);
        Assert.Contains("Approver", roles);
    }

    [Fact]
    public async Task Admin_cannot_be_dropped_however_the_request_is_written()
    {
        // A system whose only account cannot reach Settings has no way back, so this one
        // grant is not the caller's to decline.
        using var factory = Factory("ShiftOMatorSetupDiagAdminKept");
        var client = factory.CreateClient();
        await SetUpBareAsync(client, roles: new[] { "Viewer" });

        Assert.Contains("Admin", await RolesOfAsync(client));
    }

    [Fact]
    public async Task Diagnostics_name_the_caller_and_what_the_system_still_lacks()
    {
        using var factory = Factory("ShiftOMatorSetupDiagContent");
        var client = factory.CreateClient();
        await SetUpBareAsync(client);

        var body = await client.GetFromJsonAsync<JsonElement>("/api/setup/diagnostics");
        var content = body.GetProperty("content");

        // Exactly what Bare writes, and exactly what it does not: a unit with no shifts and
        // no day configurations, and one person who is not planned.
        Assert.Equal(1, content.GetProperty("units").GetInt32());
        Assert.Equal(1, content.GetProperty("people").GetInt32());
        Assert.Equal(0, content.GetProperty("plannedPeople").GetInt32());
        Assert.Equal(0, content.GetProperty("shifts").GetInt32());
        Assert.Equal(0, content.GetProperty("dayConfigurations").GetInt32());

        var auth = body.GetProperty("auth");
        Assert.Equal("Stub", auth.GetProperty("mode").GetString());
        Assert.False(auth.GetProperty("directoryRoles").GetBoolean());
    }

    [Fact]
    public async Task The_directory_roles_switch_is_stored_where_the_wizard_put_it()
    {
        using var factory = Factory("ShiftOMatorSetupDiagDirectoryRoles");
        var client = factory.CreateClient();
        await SetUpBareAsync(client, directoryRoles: true);

        var body = await client.GetFromJsonAsync<JsonElement>("/api/setup/diagnostics");

        Assert.True(body.GetProperty("auth").GetProperty("directoryRoles").GetBoolean());
    }

    private static async Task<IReadOnlyList<string>> RolesOfAsync(HttpClient client)
    {
        var me = await client.GetFromJsonAsync<JsonElement>("/api/auth/me");
        return me.GetProperty("roles").EnumerateArray()
            .Select(r => r.GetProperty("role").GetString() ?? string.Empty)
            .ToList();
    }
}
