using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// The cell timeline (ADR-0050). What it has to answer is not "what changed" — the audit
/// log does that — but "in what order": did the request come in before or after somebody
/// moved the rota.
/// </summary>
[Collection("Api")]
public class CellHistoryEndpointsTests(ApiTestFactory factory)
{
    private static int _dayOffset;

    /// <summary>
    /// A date no other test in this run will touch.
    ///
    /// The stride matters: one test writes a three-day presence block, and a neighbouring
    /// test asserting "nothing happened here" would otherwise land inside it. The random
    /// base matters too — the LocalDB test database survives between runs, so a fixed
    /// base would collide with what the previous run left behind.
    /// </summary>
    private static readonly int Base = 600 + Random.Shared.Next(0, 4000) * 10;

    private static string NextDate() =>
        DateOnly.FromDateTime(DateTime.UtcNow)
            .AddDays(Base + Interlocked.Increment(ref _dayOffset) * 10)
            .ToString("yyyy-MM-dd");

    private static async Task<string> MyPersonIdAsync(HttpClient client)
    {
        var me = await client.GetFromJsonAsync<JsonElement>("/api/auth/me");
        return me.GetProperty("personId").GetString()!;
    }

    private static async Task<string> RequestTypeIdAsync(HttpClient client, string code)
    {
        var types = await client.GetFromJsonAsync<JsonElement>("/api/request-types");
        return types.EnumerateArray().First(t => t.GetProperty("code").GetString() == code)
            .GetProperty("id").GetString()!;
    }

    [Fact]
    public async Task An_untouched_cell_has_an_empty_timeline()
    {
        var client = factory.CreateClient();
        var me = await MyPersonIdAsync(client);

        var body = await client.GetFromJsonAsync<JsonElement>(
            $"/api/history/cell?personId={me}&date={NextDate()}");

        Assert.Empty(body.GetProperty("events").EnumerateArray());
    }

    [Fact]
    public async Task A_request_and_its_decision_land_on_the_same_axis_in_order()
    {
        var client = factory.CreateClient();
        var date = NextDate();
        var me = await MyPersonIdAsync(client);

        var created = await client.PostAsJsonAsync("/api/requests", new
        {
            typeId = await RequestTypeIdAsync(client, "REMOTE"),
            from = date,
            to = date,
            note = "school run",
        });
        var requestId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        await client.PostAsJsonAsync($"/api/requests/{requestId}/decide", new
        {
            decision = "approve",
            comment = "fine",
        });

        var body = await client.GetFromJsonAsync<JsonElement>(
            $"/api/history/cell?personId={me}&date={date}");
        var events = body.GetProperty("events").EnumerateArray().ToList();

        var kinds = events.Select(e => e.GetProperty("kind").GetString()).ToList();
        Assert.Contains("requestSubmitted", kinds);
        Assert.Contains("requestDecided", kinds);
        // The presence the approval created is audited too, so all three are on one axis.
        Assert.Contains("presenceChanged", kinds);

        // Ordered by time, which is the entire point: "was the ask in before the change".
        Assert.True(kinds.IndexOf("requestSubmitted") < kinds.IndexOf("requestDecided"));

        var submitted = events.First(e => e.GetProperty("kind").GetString() == "requestSubmitted");
        Assert.Equal("school run", submitted.GetProperty("comment").GetString());

        var decided = events.First(e => e.GetProperty("kind").GetString() == "requestDecided");
        Assert.Equal("fine", decided.GetProperty("comment").GetString());
        Assert.Equal(me, decided.GetProperty("actorId").GetString());
    }

    [Fact]
    public async Task A_presence_block_shows_on_every_day_it_covers()
    {
        var client = factory.CreateClient();
        var start = DateOnly.Parse(NextDate());
        var end = start.AddDays(2);
        var me = await MyPersonIdAsync(client);

        (await client.PostAsJsonAsync("/api/presence", new
        {
            personId = me,
            typeId = "pt-travel",
            from = start.ToString("yyyy-MM-dd"),
            to = end.ToString("yyyy-MM-dd"),
        })).EnsureSuccessStatusCode();

        // The middle day is inside the block but is not either endpoint — the range
        // columns are what make this an index seek rather than a snapshot scan.
        var middle = start.AddDays(1).ToString("yyyy-MM-dd");
        var body = await client.GetFromJsonAsync<JsonElement>(
            $"/api/history/cell?personId={me}&date={middle}");

        Assert.Contains(
            body.GetProperty("events").EnumerateArray(),
            e => e.GetProperty("kind").GetString() == "presenceChanged");
    }

    [Fact]
    public async Task The_whole_day_view_covers_everybody_and_names_them()
    {
        // A conflict is rarely one person's story: the day-wide view is what answers
        // "who moved what, in what order" when two people collided.
        var client = factory.CreateClient();
        var date = NextDate();
        var me = await MyPersonIdAsync(client);

        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        var someoneElse = reference.GetProperty("people").EnumerateArray()
            .Select(p => p.GetProperty("id").GetString()!)
            .First(id => id != me);

        foreach (var personId in new[] { me, someoneElse })
        {
            (await client.PostAsJsonAsync("/api/presence", new
            {
                personId,
                typeId = "pt-travel",
                from = date,
                to = date,
            })).EnsureSuccessStatusCode();
        }

        var body = await client.GetFromJsonAsync<JsonElement>($"/api/history/cell?date={date}");
        var events = body.GetProperty("events").EnumerateArray().ToList();

        Assert.Equal(2, events.Count);
        // Every line says who it is about, which the single-person view does not need.
        var names = reference.GetProperty("people").EnumerateArray()
            .Where(p => p.GetProperty("id").GetString() == me
                || p.GetProperty("id").GetString() == someoneElse)
            .Select(p => p.GetProperty("displayName").GetString()!);
        foreach (var name in names)
        {
            Assert.Contains(events, e => e.GetProperty("summary").GetString()!.StartsWith(name));
        }
    }

    [Fact]
    public async Task Another_persons_day_is_not_mixed_in()
    {
        var client = factory.CreateClient();
        var date = NextDate();
        var me = await MyPersonIdAsync(client);

        (await client.PostAsJsonAsync("/api/presence", new
        {
            personId = me,
            typeId = "pt-travel",
            from = date,
            to = date,
        })).EnsureSuccessStatusCode();

        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        var someoneElse = reference.GetProperty("people").EnumerateArray()
            .Select(p => p.GetProperty("id").GetString()!)
            .First(id => id != me);

        var body = await client.GetFromJsonAsync<JsonElement>(
            $"/api/history/cell?personId={someoneElse}&date={date}");

        Assert.Empty(body.GetProperty("events").EnumerateArray());
    }
}
