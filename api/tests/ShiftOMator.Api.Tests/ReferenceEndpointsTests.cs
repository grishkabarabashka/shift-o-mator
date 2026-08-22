using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// Asserts against the seeded fixture counts exported from the TypeScript client
/// (`domain/fixtures.ts`) — see FixtureSeeder's remarks. If these numbers ever drift,
/// either the export is stale or the seeder mapping broke; both are worth knowing.
/// </summary>
[Collection("Api")]
public class ReferenceEndpointsTests(ApiTestFactory factory)
{
    [Fact]
    public async Task Reference_matches_the_exported_fixture_counts()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/api/reference");
        response.EnsureSuccessStatusCode();

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = doc.RootElement;

        Assert.Equal(3, root.GetProperty("regions").GetArrayLength());
        Assert.Equal(8, root.GetProperty("locations").GetArrayLength());
        Assert.Equal(4, root.GetProperty("units").GetArrayLength());
        Assert.Equal(10, root.GetProperty("shifts").GetArrayLength());
        Assert.Equal(30, root.GetProperty("roles").GetArrayLength());
        Assert.Equal(10, root.GetProperty("dayConfigurations").GetArrayLength());
        Assert.Equal(76, root.GetProperty("people").GetArrayLength());
        Assert.Equal(17, root.GetProperty("holidays").GetArrayLength());
        Assert.Equal(9, root.GetProperty("absenceCapacityRules").GetArrayLength());
    }

    [Fact]
    public async Task Roles_belong_to_a_region_not_a_global_catalog()
    {
        var client = factory.CreateClient();
        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");

        foreach (var role in reference.GetProperty("roles").EnumerateArray())
        {
            var regionId = role.GetProperty("regionId").GetString();
            Assert.Contains(regionId, new[] { "AMER", "EMEA", "APAC" });
        }
    }

    [Fact]
    public async Task Day_configuration_role_requirements_round_trip()
    {
        var client = factory.CreateClient();
        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");

        var amerWeekday = reference.GetProperty("dayConfigurations").EnumerateArray()
            .First(c => c.GetProperty("id").GetString() == "dc-amer-weekday");

        var requirements = amerWeekday.GetProperty("roleRequirements").EnumerateArray().ToList();
        Assert.Contains(requirements, r => r.GetProperty("roleId").GetString() == "AMER:Lead"
            && r.GetProperty("min").GetInt32() == 1);
    }
}
