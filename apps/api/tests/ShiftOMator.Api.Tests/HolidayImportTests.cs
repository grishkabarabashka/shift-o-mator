using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// Importing holidays from a calendar feed.
///
/// The properties worth pinning: a preview writes nothing, a second run adds nothing, and
/// the server does not fetch a URL nobody allowlisted.
/// </summary>
[Collection("Api")]
public class HolidayImportTests(ApiTestFactory factory)
{
    /// <summary>
    /// A year of its own per test, and a different set of years on every run.
    ///
    /// Both halves are needed, and the same trap caught NextDate() twice. Within a run the
    /// tests must not collide with each other; **across** runs they must not collide with
    /// themselves, because the database persists and an import is by design invisible the
    /// second time it sees the same dates — which reads as "the import added nothing"
    /// rather than as "this ran yesterday".
    /// </summary>
    private static int _year = Random.Shared.Next(2100, 4000);

    private static int NextYear() => Interlocked.Increment(ref _year);

    private static string Feed(int year) =>
        string.Join("\r\n",
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "BEGIN:VEVENT",
            $"DTSTART;VALUE=DATE:{year}0101",
            $"DTEND;VALUE=DATE:{year}0102",
            "SUMMARY:Imported New Year",
            "END:VEVENT",
            "BEGIN:VEVENT",
            $"DTSTART;VALUE=DATE:{year}0501",
            "SUMMARY:Imported May Day",
            "END:VEVENT",
            // An observance, as a national feed carries them: listed in the preview,
            // never written.
            "BEGIN:VEVENT",
            $"DTSTART;VALUE=DATE:{year}0214",
            "SUMMARY:Imported Valentine's Day",
            @"DESCRIPTION:Observance
To hide observances, go to Settings",
            "END:VEVENT",
            "END:VCALENDAR");

    private static HttpClient Admin(ApiTestFactory factory)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Debug-Role", "Admin");
        return client;
    }

    private static async Task<string> AnyLocationAsync(HttpClient client)
    {
        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        return reference.GetProperty("locations").EnumerateArray().First()
            .GetProperty("id").GetString()!;
    }

    [Fact]
    public async Task A_preview_writes_nothing()
    {
        var client = Admin(factory);
        var year = NextYear();
        var location = await AnyLocationAsync(client);

        var response = await client.PostAsJsonAsync("/api/admin/holidays/import", new
        {
            locationIds = new[] { location },
            ics = Feed(year),
            apply = false,
        });
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        // All three are listed — "why is that day not in here" has to be answerable
        // without editing a URL — and the observance is marked as skipped.
        Assert.Equal(3, body.GetProperty("days").GetArrayLength());
        Assert.Equal(0, body.GetProperty("added").GetInt32());
        Assert.Single(body.GetProperty("days").EnumerateArray()
            .Where(day => day.GetProperty("skipped").GetBoolean()));

        // Scoped to this test's own year: the suite shares a database, and another test
        // imports the same feed for a different one.
        var holidays = await client.GetFromJsonAsync<JsonElement>("/api/admin/holidays");
        Assert.DoesNotContain(holidays.EnumerateArray(),
            h => h.GetProperty("date").GetString()!.StartsWith(year.ToString()));
    }

    [Fact]
    public async Task Applying_adds_the_days_and_running_it_again_adds_nothing()
    {
        var client = Admin(factory);
        var year = NextYear();
        var location = await AnyLocationAsync(client);

        object Body() => new { locationIds = new[] { location }, ics = Feed(year), apply = true };

        var first = await client.PostAsJsonAsync("/api/admin/holidays/import", Body());
        first.EnsureSuccessStatusCode();
        // Two of the three: the observance is not a day off.
        Assert.Equal(2, (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("added").GetInt32());

        // Repeatability is the whole operation: "run it again next year" has to be safe,
        // and so does running it twice by accident.
        var second = await client.PostAsJsonAsync("/api/admin/holidays/import", Body());
        second.EnsureSuccessStatusCode();
        var body = await second.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, body.GetProperty("added").GetInt32());
        Assert.All(body.GetProperty("days").EnumerateArray(),
            day => Assert.True(
                day.GetProperty("alreadyPresent").GetBoolean() || day.GetProperty("skipped").GetBoolean()));
    }

    /// <summary>
    /// Only calendars the server is actually allowed to fetch are offered. A picker that
    /// listed one and then refused it would be worse than no picker.
    /// </summary>
    [Fact]
    public async Task The_offered_calendars_are_all_fetchable()
    {
        var client = Admin(factory);
        var calendars = await client.GetFromJsonAsync<JsonElement>("/api/admin/holidays/calendars");

        var urls = calendars.EnumerateArray().Select(c => c.GetProperty("url").GetString()!).ToList();
        Assert.NotEmpty(urls);
        Assert.All(urls, url => Assert.StartsWith("https://calendar.google.com/", url));
    }

    [Fact]
    public async Task A_url_outside_the_allowlist_is_refused()
    {
        // The endpoint would otherwise be a request-forgery proxy pointed at whatever the
        // server can reach.
        var client = Admin(factory);
        var response = await client.PostAsJsonAsync("/api/admin/holidays/import", new
        {
            locationIds = new[] { await AnyLocationAsync(client) },
            url = "http://169.254.169.254/latest/meta-data/",
            apply = false,
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("CALENDAR_HOST_NOT_ALLOWED", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_calendar_with_no_all_day_entries_says_so()
    {
        var client = Admin(factory);
        var response = await client.PostAsJsonAsync("/api/admin/holidays/import", new
        {
            locationIds = new[] { await AnyLocationAsync(client) },
            ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR",
            apply = false,
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("NO_DATES",
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }
}
