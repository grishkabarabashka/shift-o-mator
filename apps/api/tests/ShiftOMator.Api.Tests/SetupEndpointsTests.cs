using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// The setup wizard and the gate in front of it (ADR-0059) — what replaced
/// <c>Seed:IncludeDemoData</c>, <c>--seed-demo</c> and <c>Auth:BootstrapAdminEmail</c>.
///
/// Every case here runs against one database with <c>SeedDemoOnStart = false</c>: the
/// subject is what a database looks like *before* anything has written to it, which the
/// shared "Api" fixture — seeded on first touch — can no longer show. Unlike every other
/// dedicated-database test in this suite, this one is dropped and recreated by the test
/// itself rather than by hand: a `SystemSetup` row is exactly the kind of state that must
/// not survive between runs, or a rerun sees a system that thinks it is already set up.
///
/// **One database for all five cases, not one each.** They can share it because this class
/// carries no <c>[Collection]</c>, so xUnit gives it a collection of its own and runs its
/// methods *sequentially* — each <see cref="Factory"/> call therefore hands the next case
/// a database nobody else is holding. If these ever need to run in parallel with each
/// other, the fix is a name per case again, not a shared database and hope.
/// </summary>
public class SetupEndpointsTests
{
    private const string DatabaseName = "ShiftOMatorSetupTests";

    private static ApiTestFactory Factory(string stubRole = "Viewer")
    {
        var connectionString =
            $"Server=(localdb)\\MSSQLLocalDB;Database={DatabaseName};Trusted_Connection=True;TrustServerCertificate=True";
        using (var db = new ScheduleDbContext(
            new DbContextOptionsBuilder<ScheduleDbContext>().UseSqlServer(connectionString).Options))
        {
            db.Database.EnsureDeleted();
        }

        return new ApiTestFactory
        {
            DatabaseName = DatabaseName,
            StubRole = stubRole,
            SeedDemoOnStart = false,
        };
    }

    [Fact]
    public async Task An_unset_up_system_refuses_everything_but_health_and_setup()
    {
        using var factory = Factory();
        var client = factory.CreateClient();

        var state = await client.GetFromJsonAsync<JsonElement>("/api/setup/state");
        Assert.True(state.GetProperty("required").GetBoolean());

        var live = await client.GetAsync("/health/live");
        Assert.Equal(HttpStatusCode.OK, live.StatusCode);

        var blocked = await client.GetAsync("/api/reference");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, blocked.StatusCode);
        var body = await blocked.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("SETUP_REQUIRED", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task The_bare_preset_creates_one_location_one_unit_and_the_caller_as_global_admin()
    {
        using var factory = Factory();
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/setup", new
        {
            preset = "bare",
            bare = new
            {
                locationName = "Remote HQ",
                timeZone = "America/Chicago",
                holidayCalendarKey = "us-federal",
                unitName = "Everyone",
                unitKind = "crossRegion",
                displayName = "Jordan Admin",
                email = "jordan@example.test",
            },
        });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("bare", created.GetProperty("preset").GetString());
        var adminId = created.GetProperty("adminPersonId").GetString();
        Assert.False(string.IsNullOrEmpty(adminId));

        // The gate is open now, and reads confirm what got written.
        var state = await client.GetFromJsonAsync<JsonElement>("/api/setup/state");
        Assert.False(state.GetProperty("required").GetBoolean());

        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        Assert.Single(reference.GetProperty("locations").EnumerateArray());
        Assert.Single(reference.GetProperty("units").EnumerateArray());

        var grants = await client.GetFromJsonAsync<JsonElement>("/api/admin/role-assignments");
        Assert.Contains(
            grants.EnumerateArray(),
            g => g.GetProperty("personId").GetString() == adminId
                && g.GetProperty("role").GetString() == "admin"
                && g.GetProperty("unitId").ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task A_second_setup_call_is_refused_once_one_has_completed()
    {
        using var factory = Factory();
        var client = factory.CreateClient();

        var first = await client.PostAsJsonAsync("/api/setup", new { preset = "demo" });
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var second = await client.PostAsJsonAsync("/api/setup", new { preset = "demo" });
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        var body = await second.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("SETUP_COMPLETE", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task The_demo_preset_writes_the_fixture_and_links_nobody_in_stub_mode()
    {
        using var factory = Factory();
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/setup", new { preset = "demo" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        // Stub mode carries no email to link, so nobody was linked — the dev identity
        // switcher is the way in instead.
        Assert.Equal(JsonValueKind.Null, created.GetProperty("adminPersonId").ValueKind);

        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        Assert.Equal(4, reference.GetProperty("units").GetArrayLength());
        Assert.True(reference.GetProperty("people").GetArrayLength() > 1);
    }

    [Fact]
    public async Task Load_demo_data_replaces_a_bare_system_and_reset_returns_to_the_wizard()
    {
        using var factory = Factory(stubRole: "Admin");
        var client = factory.CreateClient();

        var setup = await client.PostAsJsonAsync("/api/setup", new
        {
            preset = "bare",
            bare = new
            {
                locationName = "HQ",
                timeZone = "UTC",
                holidayCalendarKey = "none",
                unitName = "Everyone",
                unitKind = "crossRegion",
                displayName = "Jordan Admin",
                email = "jordan@example.test",
            },
        });
        Assert.Equal(HttpStatusCode.Created, setup.StatusCode);

        var canLoad = await client.GetFromJsonAsync<JsonElement>("/api/admin/maintenance/can-load-demo-data");
        Assert.True(canLoad.GetProperty("available").GetBoolean());

        var load = await client.PostAsync("/api/admin/maintenance/load-demo-data", null);
        Assert.Equal(HttpStatusCode.NoContent, load.StatusCode);

        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        Assert.Equal(4, reference.GetProperty("units").GetArrayLength());

        // Untouched no longer — a second load is refused rather than merging fixtures.
        var canLoadAgain = await client.GetFromJsonAsync<JsonElement>("/api/admin/maintenance/can-load-demo-data");
        Assert.False(canLoadAgain.GetProperty("available").GetBoolean());

        var reset = await client.PostAsync("/api/admin/maintenance/reset", null);
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);

        var state = await client.GetFromJsonAsync<JsonElement>("/api/setup/state");
        Assert.True(state.GetProperty("required").GetBoolean());
    }
}
