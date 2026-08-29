using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// Asserts against the seeded configuration counts (`fixture-dataset.json`, hand-maintained
/// since Phase 8 deleted Region — see FixtureSeeder's remarks). If these numbers ever
/// drift, either the fixture is stale or the seeder mapping broke; both are worth knowing.
///
/// The roster is the one thing not asserted against the file: it is <b>trimmed</b> on its
/// way into the database (`Trimmed()`), so the file's 76 and the database's handful are
/// both correct and the count that matters here is the trimmed one.
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
        // Every manager plus DemoPeoplePerUnit working people per unit — not the
        // fixture's 76 (see the class remarks).
        Assert.Equal(27, root.GetProperty("people").GetArrayLength());
        // Counted within the fixture's own years. The holiday import writes real rows into
        // the same shared database, deliberately far in the future, and a bare total would
        // make this test a report on whichever suite ran first.
        Assert.Equal(17, root.GetProperty("holidays").EnumerateArray()
            .Count(h => string.CompareOrdinal(h.GetProperty("date").GetString(), "2090") < 0));
        Assert.Equal(11, root.GetProperty("absenceCapacityRules").GetArrayLength());
    }

    /// <summary>
    /// The two people the draft tests paint with have to actually be in the database.
    ///
    /// WHY it is a test of its own: <see cref="Auth.ActorResolver"/> substitutes its own
    /// deterministic pick for an id that names nobody (ADR-0039), so a person the roster
    /// trim dropped does not fail as "no such person" — it fails as a dozen unexplained
    /// 400s in a different file.
    /// </summary>
    [Fact]
    public async Task The_people_the_draft_tests_use_survive_the_roster_trim()
    {
        var client = factory.CreateClient();
        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        var ids = reference.GetProperty("people").EnumerateArray()
            .Select(p => p.GetProperty("id").GetString())
            .ToHashSet();

        Assert.Contains("p-amit-bhatt", ids);
        Assert.Contains("p-alison-kowalski", ids);
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
