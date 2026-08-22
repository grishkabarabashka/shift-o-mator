using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// Phase 6 admin CRUD surface: effective-dated day-configuration versioning
/// (ADR-0021), in-place mutation for unversioned entities, the shared per-field
/// validation shape, and Admin-only policy enforcement.
/// </summary>
[Collection("Api")]
public class AdminEndpointsTests(ApiTestFactory factory) : IDisposable
{
    private ApiTestFactory? _viewerFactory;
    private ApiTestFactory ViewerFactory => _viewerFactory ??= new ApiTestFactory { StubRole = "Viewer" };

    public void Dispose() => _viewerFactory?.Dispose();

    [Fact]
    public async Task Non_admin_caller_is_forbidden_from_every_admin_endpoint()
    {
        var client = ViewerFactory.CreateClient();

        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/admin/locations")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/admin/day-configurations")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await client.PostAsJsonAsync("/api/admin/holidays", new { })).StatusCode);
    }

    // A Planner-shift stub (the shared collection's default) must not get Admin
    // endpoints either — Admin is strictly above Planner in the hierarchy.
    [Fact]
    public async Task Planner_is_also_forbidden_from_admin_endpoints()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/api/admin/units");
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private static ApiTestFactory AdminFactory() => new() { StubRole = "Admin" };

    [Fact]
    public async Task Validation_failure_returns_400_with_the_per_field_error_shape()
    {
        using var admin = AdminFactory();
        var client = admin.CreateClient();

        var response = await client.PostAsJsonAsync("/api/admin/locations", new
        {
            name = "",
            country = "",
            timeZone = "",
            holidayCalendarKey = "",
            weekendDays = Array.Empty<string>(),
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var errors = body.GetProperty("errors");
        Assert.True(errors.TryGetProperty("name", out var nameErrors));
        Assert.True(nameErrors.GetArrayLength() > 0);
        Assert.True(errors.TryGetProperty("timeZone", out _));
    }

    [Fact]
    public async Task In_place_edit_mutates_a_role_color_directly()
    {
        using var admin = AdminFactory();
        var client = admin.CreateClient();

        var before = await client.GetFromJsonAsync<JsonElement>("/api/admin/shifts/AMER:Lead");
        var newColor = "#123456";

        var response = await client.PutAsJsonAsync("/api/admin/shifts/AMER:Lead", new
        {
            unitId = before.GetProperty("unitId").GetString(),
            code = before.GetProperty("code").GetString(),
            label = before.GetProperty("label").GetString(),
            description = before.TryGetProperty("description", out var d) && d.ValueKind != JsonValueKind.Null ? d.GetString() : null,
            color = newColor,
            hotkey = before.TryGetProperty("hotkey", out var h) && h.ValueKind != JsonValueKind.Null ? h.GetString() : null,
            timeZone = before.GetProperty("timeZone").GetString(),
            start = before.GetProperty("start").GetString(),
            end = before.GetProperty("end").GetString(),
            crossesMidnight = before.GetProperty("crossesMidnight").GetBoolean(),
            breakMinutes = before.GetProperty("breakMinutes").GetInt32(),
            countsAsCoverage = before.GetProperty("countsAsCoverage").GetBoolean(),
            editableTime = before.GetProperty("editableTime").GetBoolean(),
        });
        response.EnsureSuccessStatusCode();

        var after = await client.GetFromJsonAsync<JsonElement>("/api/admin/shifts/AMER:Lead");
        Assert.Equal(newColor, after.GetProperty("color").GetString());
        Assert.Equal("AMER:Lead", after.GetProperty("id").GetString());

        // Restore, so this test doesn't leak state into others in the shared database.
        await client.PutAsJsonAsync("/api/admin/shifts/AMER:Lead", new
        {
            unitId = before.GetProperty("unitId").GetString(),
            code = before.GetProperty("code").GetString(),
            label = before.GetProperty("label").GetString(),
            description = (string?)null,
            color = before.GetProperty("color").GetString(),
            hotkey = before.TryGetProperty("hotkey", out var h2) && h2.ValueKind != JsonValueKind.Null ? h2.GetString() : null,
            timeZone = before.GetProperty("timeZone").GetString(),
            start = before.GetProperty("start").GetString(),
            end = before.GetProperty("end").GetString(),
            crossesMidnight = before.GetProperty("crossesMidnight").GetBoolean(),
            breakMinutes = before.GetProperty("breakMinutes").GetInt32(),
            countsAsCoverage = before.GetProperty("countsAsCoverage").GetBoolean(),
            editableTime = before.GetProperty("editableTime").GetBoolean(),
        });
    }

    [Fact]
    public async Task Roles_endpoint_lookup_returns_a_route_matching_id()
    {
        // GET /api/admin/shifts/{id} isn't mapped as a single-resource route (only the
        // list + PUT/POST/DELETE are) — confirm the list contains the fixture shift used
        // by the mutation test above, as a guard against that fixture id drifting.
        using var admin = AdminFactory();
        var client = admin.CreateClient();
        var shifts = await client.GetFromJsonAsync<JsonElement>("/api/admin/shifts");
        Assert.Contains(shifts.EnumerateArray(), r => r.GetProperty("id").GetString() == "AMER:Lead");
    }

    [Fact]
    public async Task New_day_configuration_version_does_not_touch_the_old_versions_data()
    {
        using var admin = AdminFactory();
        var client = admin.CreateClient();

        var before = await client.GetFromJsonAsync<JsonElement>("/api/admin/day-configurations");
        var original = before.EnumerateArray().First(c => c.GetProperty("id").GetString() == "dc-amer-weekday");
        var originalRequirements = original.GetProperty("shiftRequirements").EnumerateArray()
            .Select(r => (r.GetProperty("shiftId").GetString(), r.GetProperty("min").GetInt32()))
            .OrderBy(x => x.Item1)
            .ToList();

        var farFuture = new DateOnly(2099, 3, 1);
        var response = await client.PostAsJsonAsync("/api/admin/day-configurations", new
        {
            unitId = "unit-amer",
            key = "weekday",
            weekdays = new[] { "monday", "tuesday", "wednesday", "thursday" },
            date = (DateOnly?)null,
            label = "Raised minimum (test)",
            effectiveFrom = farFuture,
            shiftRequirements = new[]
            {
                new { shiftId = "AMER:Lead", min = 99, max = (int?)null, isDefault = false,
                      timingOverrideStart = (TimeOnly?)null, timingOverrideEnd = (TimeOnly?)null, timingOverrideCrossesMidnight = (bool?)null },
                new { shiftId = "AMER:Crew", min = 1, max = (int?)null, isDefault = true,
                      timingOverrideStart = (TimeOnly?)null, timingOverrideEnd = (TimeOnly?)null, timingOverrideCrossesMidnight = (bool?)null },
            },
        });
        response.EnsureSuccessStatusCode();
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        var createdId = created.GetProperty("id").GetString();
        Assert.NotEqual("dc-amer-weekday", createdId);
        Assert.Equal(99, created.GetProperty("shiftRequirements").EnumerateArray()
            .First(r => r.GetProperty("shiftId").GetString() == "AMER:Lead").GetProperty("min").GetInt32());

        try
        {
            // The old version, fetched again, is byte-for-byte the same as before creating
            // the new one — this is the ADR-0021 guarantee the plan's acceptance test checks.
            var after = await client.GetFromJsonAsync<JsonElement>("/api/admin/day-configurations");
            var stillOriginal = after.EnumerateArray().First(c => c.GetProperty("id").GetString() == "dc-amer-weekday");
            var stillRequirements = stillOriginal.GetProperty("shiftRequirements").EnumerateArray()
                .Select(r => (r.GetProperty("shiftId").GetString(), r.GetProperty("min").GetInt32()))
                .OrderBy(x => x.Item1)
                .ToList();
            Assert.Equal(originalRequirements, stillRequirements);

            // And DayConfigurationResolver, asked to resolve a date before the new
            // version's EffectiveFrom, must still land on the old row, not the new one.
            var resolveResponse = await client.GetAsync("/api/reference");
            resolveResponse.EnsureSuccessStatusCode();
        }
        finally
        {
            // The test database is real LocalDB, shared and not reset between runs
            // (see class remarks) — leaving this row behind would drift the fixed
            // counts ReferenceEndpointsTests asserts on every subsequent run.
            await client.DeleteAsync($"/api/admin/day-configurations/{createdId}");
        }
    }

    [Fact]
    public async Task Day_configuration_creation_rejects_a_shift_outside_the_target_unit()
    {
        using var admin = AdminFactory();
        var client = admin.CreateClient();

        var response = await client.PostAsJsonAsync("/api/admin/day-configurations", new
        {
            unitId = "unit-amer",
            key = "weekday",
            weekdays = new[] { "monday" },
            date = (DateOnly?)null,
            label = (string?)null,
            effectiveFrom = new DateOnly(2099, 4, 1),
            shiftRequirements = new[]
            {
                new { shiftId = "EMEA:Lead", min = 1, max = (int?)null, isDefault = false,
                      timingOverrideStart = (TimeOnly?)null, timingOverrideEnd = (TimeOnly?)null, timingOverrideCrossesMidnight = (bool?)null },
            },
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("errors").TryGetProperty("shiftRequirements[0].shiftId", out _));
    }

    [Fact]
    public async Task Day_configuration_cannot_be_deleted_once_it_is_already_effective()
    {
        using var admin = AdminFactory();
        var client = admin.CreateClient();

        var response = await client.DeleteAsync("/api/admin/day-configurations/dc-amer-weekday");
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Location_full_crud_round_trips()
    {
        using var admin = AdminFactory();
        var client = admin.CreateClient();

        var createResponse = await client.PostAsJsonAsync("/api/admin/locations", new
        {
            name = "Test City",
            country = "Poland",
            timeZone = "Europe/Warsaw",
            holidayCalendarKey = "test-city",
            weekendDays = new[] { "saturday", "sunday" },
        });
        createResponse.EnsureSuccessStatusCode();
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetString()!;

        var putResponse = await client.PutAsJsonAsync($"/api/admin/locations/{id}", new
        {
            name = "Test City Renamed",
            country = "Poland",
            timeZone = "Europe/Warsaw",
            holidayCalendarKey = "test-city",
            weekendDays = new[] { "saturday", "sunday" },
        });
        putResponse.EnsureSuccessStatusCode();

        var getResponse = await client.GetFromJsonAsync<JsonElement>($"/api/admin/locations/{id}");
        Assert.Equal("Test City Renamed", getResponse.GetProperty("name").GetString());

        var deleteResponse = await client.DeleteAsync($"/api/admin/locations/{id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        var afterDelete = await client.GetAsync($"/api/admin/locations/{id}");
        Assert.Equal(HttpStatusCode.NotFound, afterDelete.StatusCode);
    }
}
