using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// Presence types are reference data (ADR-0043): what each "where are you working" option
/// is called, how it is drawn, whether it is offered, and whether recording it needs
/// approving.
///
/// The last of those is the one worth pinning down. "Remote needs signing off" used to be
/// an <c>if</c> in the cell menu — a client-side convention with nothing behind it, which
/// meant any caller could write the record the product had decided to route through an
/// approver.
/// </summary>
[Collection("Api")]
public class PresenceTypesTests(ApiTestFactory factory)
{
    private static int _dayOffset;
    private static readonly int Base = Random.Shared.Next(2000, 3000);

    private static string NextDate() =>
        DateOnly.FromDateTime(DateTime.UtcNow)
            .AddDays(Base + Interlocked.Increment(ref _dayOffset) * 10)
            .ToString("yyyy-MM-dd");

    /// <summary>
    /// A client that administers globally. The default identity does not: kinds of
    /// presence mean the same thing in every unit, so editing them needs a global grant
    /// (ADR-0051), and a unit admin getting a 403 here is the rule working.
    /// </summary>
    private HttpClient GlobalAdmin()
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Debug-Role", "Admin");
        return client;
    }

    private static async Task<string> MyPersonIdAsync(HttpClient client)
    {
        var me = await client.GetFromJsonAsync<JsonElement>("/api/auth/me");
        return me.GetProperty("personId").GetString()!;
    }

    [Fact]
    public async Task Reference_carries_the_seeded_ways_of_working()
    {
        var client = factory.CreateClient();
        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");

        var ids = reference.GetProperty("presenceTypes").EnumerateArray()
            .Select(t => t.GetProperty("id").GetString())
            .ToList();

        // Retired ones are included on purpose: a record written before a type was retired
        // still has to render, and it is the menu that filters on isActive.
        Assert.Contains("pt-office", ids);
        Assert.Contains("pt-remote", ids);
    }

    [Fact]
    public async Task A_kind_that_needs_approval_cannot_be_written_directly()
    {
        var client = factory.CreateClient();
        var date = NextDate();

        var response = await client.PostAsJsonAsync("/api/presence", new
        {
            personId = await MyPersonIdAsync(client),
            typeId = "pt-remote",
            from = date,
            to = date,
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("APPROVAL_REQUIRED", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_kind_that_does_not_is_written_straight_in()
    {
        var client = factory.CreateClient();
        var date = NextDate();

        var response = await client.PostAsJsonAsync("/api/presence", new
        {
            personId = await MyPersonIdAsync(client),
            typeId = "pt-travel",
            from = date,
            to = date,
        });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    /// <summary>
    /// The set is closed and the ids are the enum member names, so there is no create and
    /// no delete — and the seed tops the rows up by id, which is what makes an edit
    /// survive a restart.
    /// </summary>
    [Fact]
    public async Task The_editable_half_is_editable_and_the_kind_is_not()
    {
        var client = GlobalAdmin();
        var before = await client.GetFromJsonAsync<JsonElement>("/api/admin/presence-types");
        var travel = before.EnumerateArray().First(t => t.GetProperty("id").GetString() == "pt-travel");

        var response = await client.PutAsJsonAsync("/api/admin/presence-types/pt-travel", new
        {
            label = "Business trip",
            glyph = "B",
            color = "#b45309",
            namesALocation = false,
            countsAs = "away",
            requiresApproval = false,
            isActive = true,
            sortOrder = travel.GetProperty("sortOrder").GetInt32(),
        });
        response.EnsureSuccessStatusCode();

        var updated = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Business trip", updated.GetProperty("label").GetString());

        // Put it back: the suite shares one database, and the cell menu reads these.
        (await client.PutAsJsonAsync("/api/admin/presence-types/pt-travel", new
        {
            label = "Travelling",
            glyph = "T",
            color = "#b45309",
            namesALocation = false,
            countsAs = "away",
            requiresApproval = false,
            isActive = true,
            sortOrder = travel.GetProperty("sortOrder").GetInt32(),
        })).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task A_glyph_longer_than_the_band_is_refused()
    {
        // The band is 9px. Three characters render clipped, which reads as a rendering
        // fault rather than as a long name.
        var client = GlobalAdmin();
        var response = await client.PutAsJsonAsync("/api/admin/presence-types/pt-travel", new
        {
            label = "Travelling",
            glyph = "TRVL",
            color = "#b45309",
            namesALocation = false,
            countsAs = "away",
            requiresApproval = false,
            isActive = true,
            sortOrder = 3,
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>
    /// The set is open (ADR-0054). "Standby", "conference" or "a customer's office" are
    /// exactly the sort of thing a team invents without asking anybody here.
    /// </summary>
    [Fact]
    public async Task A_new_way_of_working_can_be_added_and_removed_again()
    {
        var client = GlobalAdmin();
        var created = await client.PostAsJsonAsync("/api/admin/presence-types", new
        {
            label = "On standby",
            glyph = "S",
            color = "#0f766e",
            namesALocation = false,
            countsAs = "away",
            requiresApproval = false,
            isActive = true,
            sortOrder = 9,
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;

        // Offered straight away: the cell menu reads /api/reference.
        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        Assert.Contains(reference.GetProperty("presenceTypes").EnumerateArray(),
            t => t.GetProperty("id").GetString() == id);

        Assert.Equal(HttpStatusCode.NoContent,
            (await client.DeleteAsync($"/api/admin/presence-types/{id}")).StatusCode);
    }

    /// <summary>
    /// Ticking "needs approval" on a new type has to give the request somewhere to go.
    /// Otherwise the menu offers it and nothing happens, which is the failure this area
    /// keeps producing when a flag and its plumbing are edited separately.
    /// </summary>
    [Fact]
    public async Task A_type_that_needs_approving_gets_a_request_type_with_it()
    {
        var client = GlobalAdmin();
        var created = await client.PostAsJsonAsync("/api/admin/presence-types", new
        {
            label = "At a conference",
            glyph = "Cf",
            color = "#7e22ce",
            namesALocation = false,
            countsAs = "away",
            requiresApproval = true,
            isActive = true,
            sortOrder = 9,
        });
        created.EnsureSuccessStatusCode();
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;

        var types = await client.GetFromJsonAsync<JsonElement>("/api/request-types");
        Assert.Contains(types.EnumerateArray(),
            t => t.TryGetProperty("presenceTypeId", out var p) && p.GetString() == id);

        await client.DeleteAsync($"/api/admin/presence-types/{id}");
    }

    /// <summary>
    /// A presence record names its type and carries nothing else, so deleting the row it
    /// points at would leave days on the grid describing something nobody can name.
    /// </summary>
    [Fact]
    public async Task A_type_something_points_at_cannot_be_deleted()
    {
        var client = GlobalAdmin();
        var response = await client.DeleteAsync("/api/admin/presence-types/pt-office");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("PRESENCE_TYPE_IN_USE",
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }
}
