using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// The personal calendar and the subscription behind it.
///
/// The feed is the only anonymous route in the product: Outlook subscribes by URL and
/// cannot carry a bearer token, so the secret is in the path. Most of what is asserted here
/// is about that — the token being unguessable, never handed out on a list payload, and
/// revocable.
/// </summary>
[Collection("Api")]
public class MyCalendarTests(ApiTestFactory factory)
{
    private static string Today => DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
    private static string Plus(int days) =>
        DateOnly.FromDateTime(DateTime.UtcNow).AddDays(days).ToString("yyyy-MM-dd");

    [Fact]
    public async Task Answers_with_the_callers_own_rows()
    {
        var client = factory.CreateClient();
        var me = await client.GetFromJsonAsync<JsonElement>("/api/auth/me");
        var body = await client.GetFromJsonAsync<JsonElement>(
            $"/api/me/calendar?from={Today}&to={Plus(120)}");

        Assert.Equal(me.GetProperty("personId").GetString(), body.GetProperty("personId").GetString());
        Assert.All(body.GetProperty("assignments").EnumerateArray(),
            a => Assert.Equal(me.GetProperty("personId").GetString(), a.GetProperty("personId").GetString()));
    }

    [Fact]
    public async Task Refuses_a_window_longer_than_a_calendar()
    {
        // A scroll, not a query: without a cap a client can ask for a century of one
        // person and get it.
        var client = factory.CreateClient();
        var response = await client.GetAsync($"/api/me/calendar?from={Today}&to={Plus(4000)}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("RANGE_TOO_LONG",
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }

    /// <summary>
    /// The defect this pins down: <c>Person</c> goes out whole on /api/reference, so a
    /// serialized calendar token would hand every signed-in person everybody else's feed.
    /// </summary>
    [Fact]
    public async Task The_feed_token_is_not_on_any_list_payload()
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Debug-Role", "Admin,Planner");

        foreach (var url in new[] { "/api/reference", "/api/admin/people" })
        {
            var body = await client.GetStringAsync(url);
            Assert.DoesNotContain("calendarToken", body, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task The_feed_is_readable_without_signing_in_and_only_with_the_token()
    {
        var client = factory.CreateClient();
        var feed = await client.GetFromJsonAsync<JsonElement>("/api/me/calendar-feed");
        var url = feed.GetProperty("url").GetString()!;

        // Anonymous: the point of the whole endpoint.
        var anonymous = factory.CreateClient();
        anonymous.DefaultRequestHeaders.Authorization = null;
        var ics = await anonymous.GetAsync(new Uri(url).PathAndQuery, HttpCompletionOption.ResponseContentRead);
        ics.EnsureSuccessStatusCode();
        Assert.StartsWith("text/calendar", ics.Content.Headers.ContentType!.ToString());
        Assert.Contains("BEGIN:VCALENDAR", await ics.Content.ReadAsStringAsync());

        // A wrong token answers exactly as an unknown route does: anything else would make
        // the address space searchable.
        Assert.Equal(HttpStatusCode.NotFound,
            (await anonymous.GetAsync("/api/calendar/not-a-real-token.ics")).StatusCode);
    }

    [Fact]
    public async Task The_seeded_token_is_not_derived_from_the_person_id()
    {
        // The fixture writes "tok-{personId}", which is a guessable credential on an
        // endpoint that has no other one. The seed replaces it.
        var client = factory.CreateClient();
        var me = await client.GetFromJsonAsync<JsonElement>("/api/auth/me");
        var personId = me.GetProperty("personId").GetString()!;

        Assert.Equal(HttpStatusCode.NotFound,
            (await client.GetAsync($"/api/calendar/tok-{personId}.ics")).StatusCode);
    }

    [Fact]
    public async Task Resetting_the_address_makes_the_old_one_stop_working()
    {
        // The only way to take back a URL that has been shared or leaked.
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Debug-PersonId", "p-alison-kowalski");

        var before = (await client.GetFromJsonAsync<JsonElement>("/api/me/calendar-feed"))
            .GetProperty("url").GetString()!;
        (await client.GetAsync(new Uri(before).PathAndQuery)).EnsureSuccessStatusCode();

        var reset = await client.PostAsync("/api/me/calendar-feed/reset", null);
        reset.EnsureSuccessStatusCode();
        var after = (await reset.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("url").GetString()!;

        Assert.NotEqual(before, after);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri(before).PathAndQuery)).StatusCode);
        (await client.GetAsync(new Uri(after).PathAndQuery)).EnsureSuccessStatusCode();
    }
}
