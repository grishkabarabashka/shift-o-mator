using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// Settings → People saves every pending edit as one unit (ADR-0061).
///
/// The defect this exists for was data loss, not an inconvenience: moving a sign-in
/// address from one person to another is a release and a claim, the client sent them as
/// separate requests, and the claim was rejected by the filtered unique index *after* the
/// release had committed. The address ended up on nobody — which, for the person who was
/// linked to it, means they can no longer sign in at all (ADR-0058).
///
/// Its own database, because these tests write emails and
/// <see cref="ReferenceEndpointsTests"/> asserts the roster against the fixture.
/// </summary>
public class PeopleBatchTests(PeopleBatchTests.Factory factory) : IClassFixture<PeopleBatchTests.Factory>
{
    public sealed class Factory : ApiTestFactory
    {
        public Factory()
        {
            DatabaseName = "ShiftOMatorPeopleBatchTests";
            StubRole = "Admin";
        }
    }

    private static HttpRequestMessage AsAdmin(string url, object body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
        request.Headers.Add("X-Debug-Role", "Admin");
        return request;
    }

    private static object PersonBody(JsonElement person, string? email) => new
    {
        displayName = person.GetProperty("displayName").GetString(),
        initials = person.GetProperty("initials").GetString(),
        employeeId = Text(person, "employeeId"),
        email,
        unitId = person.GetProperty("unitId").GetString(),
        locationId = person.GetProperty("locationId").GetString(),
        orgCategory = person.GetProperty("orgCategory").GetString(),
        isActive = person.GetProperty("isActive").GetBoolean(),
        isIncluded = person.GetProperty("isIncluded").GetBoolean(),
    };

    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    /// <summary>
    /// Two people with no address on either.
    ///
    /// The clear is not tidiness: this database outlives the run (CLAUDE.md), so a test
    /// that leaves an address behind makes the *next* run of itself fail on
    /// EMAIL_TAKEN — which reads as a broken endpoint rather than a dirty fixture. Nulls
    /// do not collide in a filtered unique index, so clearing both is always valid.
    /// </summary>
    private async Task<(JsonElement First, JsonElement Second)> TwoPeopleAsync(HttpClient client)
    {
        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        var people = reference.GetProperty("people").EnumerateArray().Take(2).ToArray();

        (await client.SendAsync(AsAdmin("/api/admin/people/batch", new
        {
            ops = new object[]
            {
                new { kind = "update", id = people[0].GetProperty("id").GetString(), person = PersonBody(people[0], null) },
                new { kind = "update", id = people[1].GetProperty("id").GetString(), person = PersonBody(people[1], null) },
            },
        }))).EnsureSuccessStatusCode();

        return (people[0], people[1]);
    }

    private async Task<string?> EmailOfAsync(HttpClient client, string personId)
    {
        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        var person = reference.GetProperty("people").EnumerateArray()
            .First(p => p.GetProperty("id").GetString() == personId);
        return Text(person, "email");
    }

    [Fact]
    public async Task An_address_moves_from_one_person_to_another_in_one_save()
    {
        var client = factory.CreateClient();
        var (from, to) = await TwoPeopleAsync(client);
        var fromId = from.GetProperty("id").GetString()!;
        var toId = to.GetProperty("id").GetString()!;
        const string address = "moving.address@example.test";

        // Give it to the first person, so there is something to move.
        (await client.SendAsync(AsAdmin("/api/admin/people/batch", new
        {
            ops = new object[] { new { kind = "update", id = fromId, person = PersonBody(from, address) } },
        }))).EnsureSuccessStatusCode();

        // The claim is listed *first*, which is the order that used to lose the address:
        // sent one at a time, this row is rejected and the release below still commits.
        var move = await client.SendAsync(AsAdmin("/api/admin/people/batch", new
        {
            ops = new object[]
            {
                new { kind = "update", id = toId, person = PersonBody(to, address) },
                new { kind = "update", id = fromId, person = PersonBody(from, null) },
            },
        }));

        Assert.Equal(HttpStatusCode.OK, move.StatusCode);
        Assert.Null(await EmailOfAsync(client, fromId));
        Assert.Equal(address, await EmailOfAsync(client, toId));
    }

    [Fact]
    public async Task A_rejected_op_leaves_the_others_unapplied()
    {
        var client = factory.CreateClient();
        var (keeper, other) = await TwoPeopleAsync(client);
        var keeperId = keeper.GetProperty("id").GetString()!;
        var otherId = other.GetProperty("id").GetString()!;
        const string address = "kept.address@example.test";

        (await client.SendAsync(AsAdmin("/api/admin/people/batch", new
        {
            ops = new object[] { new { kind = "update", id = keeperId, person = PersonBody(keeper, address) } },
        }))).EnsureSuccessStatusCode();

        // One valid op and one that cannot pass — a display name is required. Atomicity is
        // the whole point: the valid one must not survive on its own.
        var response = await client.SendAsync(AsAdmin("/api/admin/people/batch", new
        {
            ops = new object[]
            {
                new { kind = "update", id = keeperId, person = PersonBody(keeper, null) },
                new
                {
                    kind = "update",
                    id = otherId,
                    person = new
                    {
                        displayName = "",
                        initials = "XX",
                        employeeId = (string?)null,
                        email = (string?)null,
                        unitId = other.GetProperty("unitId").GetString(),
                        locationId = other.GetProperty("locationId").GetString(),
                        orgCategory = other.GetProperty("orgCategory").GetString(),
                        isActive = true,
                        isIncluded = true,
                    },
                },
            },
        }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("BATCH_REJECTED", body.GetProperty("code").GetString());

        // Keyed by the index the caller sent, not the order the server applied them in.
        Assert.True(body.GetProperty("errors").TryGetProperty("1", out var failed));
        Assert.True(failed.TryGetProperty("displayName", out _));

        // The clear in op 0 was valid on its own and still must not have happened.
        Assert.Equal(address, await EmailOfAsync(client, keeperId));
    }

    [Fact]
    public async Task Applying_a_batch_writes_history_for_every_person_it_touched()
    {
        // Person edits had no audit trail at all before this, though ADR-0040 names them
        // explicitly — so "who cleared this address, and when" had no answer anywhere.
        var client = factory.CreateClient();
        var (person, _) = await TwoPeopleAsync(client);
        var personId = person.GetProperty("id").GetString()!;

        (await client.SendAsync(AsAdmin("/api/admin/people/batch", new
        {
            ops = new object[]
            {
                new { kind = "update", id = personId, person = PersonBody(person, "audited@example.test") },
            },
        }))).EnsureSuccessStatusCode();

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var history = await client.GetFromJsonAsync<JsonElement>(
            $"/api/history?from={today:yyyy-MM-dd}&to={today:yyyy-MM-dd}");

        Assert.Contains(
            history.EnumerateArray(),
            entry => entry.GetProperty("entityId").GetString() == personId);
    }

    [Fact]
    public async Task An_empty_batch_is_accepted_and_does_nothing()
    {
        var client = factory.CreateClient();
        var response = await client.SendAsync(
            AsAdmin("/api/admin/people/batch", new { ops = Array.Empty<object>() }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
