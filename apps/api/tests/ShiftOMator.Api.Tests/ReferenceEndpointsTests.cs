using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// Asserts against the seeded fixture counts (`fixture-dataset.json`, hand-maintained
/// since Phase 8 deleted Region — see FixtureSeeder's remarks). If these numbers ever
/// drift, either the fixture is stale or the seeder mapping broke; both are worth knowing.
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

        Assert.Equal(8, root.GetProperty("locations").GetArrayLength());
        Assert.Equal(4, root.GetProperty("units").GetArrayLength());
        Assert.Equal(30, root.GetProperty("shifts").GetArrayLength());
        Assert.Equal(13, root.GetProperty("dayConfigurations").GetArrayLength());
        Assert.Equal(76, root.GetProperty("people").GetArrayLength());
        Assert.Equal(17, root.GetProperty("holidays").GetArrayLength());
        Assert.Equal(11, root.GetProperty("absenceCapacityRules").GetArrayLength());
    }

    [Fact]
    public async Task Shifts_belong_to_a_unit_not_a_global_catalog()
    {
        var client = factory.CreateClient();
        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");

        foreach (var shift in reference.GetProperty("shifts").EnumerateArray())
        {
            var unitId = shift.GetProperty("unitId").GetString();
            Assert.Contains(unitId, new[] { "unit-amer", "unit-emea", "unit-apac", "unit-st" });
        }
    }

    [Fact]
    public async Task Day_configuration_role_requirements_round_trip()
    {
        var client = factory.CreateClient();
        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");

        var amerWeekday = reference.GetProperty("dayConfigurations").EnumerateArray()
            .First(c => c.GetProperty("id").GetString() == "dc-amer-weekday");

        var requirements = amerWeekday.GetProperty("shiftRequirements").EnumerateArray().ToList();
        Assert.Contains(requirements, r => r.GetProperty("shiftId").GetString() == "AMER:Lead"
            && r.GetProperty("min").GetInt32() == 1);
    }
}
