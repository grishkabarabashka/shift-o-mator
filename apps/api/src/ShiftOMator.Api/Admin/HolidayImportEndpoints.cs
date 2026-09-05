using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Application;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>
/// Holidays from a published calendar feed (iCalendar), instead of typing a year of them.
///
/// WHY this is an <b>import</b> and not a sync: a sync owns the rows. It would have to
/// decide what happens when a feed drops a day somebody has already been rostered off
/// for, and no answer to that is safe to make automatically. The import adds days that
/// are not there and never touches one that is, which makes it repeatable and makes "run
/// it again next year" the whole operation. What is missing for a real sync is a
/// scheduler and a decision about deletions; both are a phase, and neither is here.
///
/// Two ways in, because "the official provider" is usually a URL and sometimes a file:
///
/// - Ics: the feed as text, pasted or read from a file by the browser. No network at all.
/// - Url: fetched by the server, and only from a host on the allowlist
///   (<c>AllowedCalendarHost</c>, managed on Settings → Maintenance). An admin endpoint
///   that fetches an arbitrary URL is a request-forgery proxy pointed at whatever the
///   server can reach, so the allowlist is the feature rather than a formality.
/// </summary>
public static class HolidayImportEndpoints
{
    /// <summary>A feed with more entries than this is not a holiday calendar, and the
    /// preview would be unreadable anyway.</summary>
    private const int MaxDays = 2000;

    public static void MapHolidayImportEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/holidays")
            .RequireAuthorization(AuthPolicies.AdminSomewhere);


        // The published calendars an admin can pick from by name, rather than by finding
        // and pasting a URL.
        //
        // WHY a fixed list and not a directory: there is no registry of official public
        // holiday feeds. What exists is a handful of providers who publish one per
        // country, and naming the one we use — with its host in the allowlist — is more
        // honest than a search box that would mostly find the wrong thing. Adding a
        // country is a row here plus, if it is a new host, a line of configuration.
        group.MapGet("/calendars", async (ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var allowed = await AllowedHostsAsync(db, ct);
            var offered = HolidayCalendars.All
                .Where(c => Uri.TryCreate(c.Url, UriKind.Absolute, out var uri) && allowed.Contains(uri.Host))
                .ToList();

            return Results.Ok(offered);
        })
        .WithName("ListHolidayCalendars")
        .Produces<IReadOnlyList<HolidayCalendar>>();

        group.MapPost("/import", async (
            HolidayImportRequest req, ClaimsPrincipal user, ActorResolver actors,
            IHttpClientFactory clients,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            if (req.LocationIds.Count == 0)
            {
                return Results.BadRequest(new ErrorResponse("NO_LOCATIONS",
                    "Choose at least one location these holidays apply to."));
            }

            string ics;
            if (!string.IsNullOrWhiteSpace(req.Ics))
            {
                ics = req.Ics;
            }
            else if (!string.IsNullOrWhiteSpace(req.Url))
            {
                var fetched = await FetchAsync(req.Url, clients, db, ct);
                if (fetched.Error is { } error) return error;
                ics = fetched.Body!;
            }
            else
            {
                return Results.BadRequest(new ErrorResponse("NO_CALENDAR",
                    "Give either the calendar URL or its contents."));
            }

            // A published national calendar carries observances as well as public
            // holidays, and there are twice as many of the former. When two entries land
            // on one date the holiday wins, which is why the ordering runs before the
            // grouping rather than the parser deduplicating for us.
            var parsed = IcsCalendar.Parse(ics)
                .Where(day => req.From is null || day.Date >= req.From)
                .Where(day => req.To is null || day.Date <= req.To)
                .GroupBy(day => day.Date)
                .Select(byDate => byDate
                    .OrderByDescending(day => IcsCalendar.IsHoliday(day.Category))
                    .First())
                .OrderBy(day => day.Date)
                .Take(MaxDays)
                .ToList();

            if (parsed.Count == 0)
            {
                return Results.BadRequest(new ErrorResponse("NO_DATES",
                    "No all-day entries in that calendar, in that period. A holiday feed has "
                    + "VEVENTs with a SUMMARY and an all-day DTSTART."));
            }

            // "Already there" is per date <b>and</b> per location: the same date can be a
            // holiday in London and a working day in Chicago, and importing the UK feed
            // must not conclude it is covered because Chicago has something that day.
            var dates = parsed.Select(d => d.Date).ToHashSet();
            var existing = await db.Holidays.AsNoTracking()
                .Where(h => dates.Contains(h.Date))
                .ToListAsync(ct);

            bool AlreadyCovered(DateOnly date) =>
                existing.Any(h => h.Date == date && h.LocationIds.Intersect(req.LocationIds).Any());

            // Everything the feed offered is listed, including what the filter drops:
            // "why is Good Friday not in here" has to be answerable without editing a URL.
            var rows = parsed
                .Select(day => new HolidayImportRow(
                    day.Date,
                    day.Name,
                    day.Category,
                    AlreadyCovered(day.Date),
                    req.HolidaysOnly && !IcsCalendar.IsHoliday(day.Category)))
                .ToList();

            if (!req.Apply)
            {
                // A preview, always offered first: an import that silently wrote a year of
                // rows would be a thing you can only find out about afterwards.
                return Results.Ok(new HolidayImportResponse(rows, 0));
            }

            var added = 0;
            foreach (var row in rows.Where(r => !r.AlreadyPresent && !r.Skipped))
            {
                db.Holidays.Add(new Holiday
                {
                    Id = $"hol-{Guid.NewGuid():N}",
                    Date = row.Date,
                    Name = row.Name,
                    LocationIds = [.. req.LocationIds],
                    IsFullDay = true,
                });
                added += 1;
            }

            if (added > 0)
            {
                // One history row for the batch, not one per holiday: what a reader of the
                // timeline wants to know is that somebody imported a calendar and which
                // one. Twenty rows saying "holiday created" bury that rather than record
                // it, and the snapshot carries the detail for anyone who needs it.
                db.RecordConfiguration(HistoryAction.Created, "holidays-import",
                    $"Imported {added} holidays from {req.Url ?? "a pasted calendar"} into "
                    + string.Join(", ", req.LocationIds),
                    rows.Where(r => !r.AlreadyPresent && !r.Skipped), await actors.RequireAsync(user, ct));
                await db.SaveChangesAsync(ct);
            }

            return Results.Ok(new HolidayImportResponse(rows, added));
        })
        .WithName("ImportHolidays")
        .Produces<HolidayImportResponse>()
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest);
    }

    /// <summary>Rows are stored lowercase (<c>AllowedCalendarHostsAdminEndpoints</c>
    /// normalizes on write); a case-insensitive set is built once per request rather than
    /// trusting every caller here to lowercase the host it compares against.</summary>
    private static async Task<HashSet<string>> AllowedHostsAsync(ShiftOMatorDbContext db, CancellationToken ct) =>
        new(await db.AllowedCalendarHosts.AsNoTracking().Select(h => h.Host).ToListAsync(ct), StringComparer.OrdinalIgnoreCase);

    private static async Task<(string? Body, IResult? Error)> FetchAsync(
        string url, IHttpClientFactory clients, ShiftOMatorDbContext db, CancellationToken ct)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
        {
            return (null, Results.BadRequest(new ErrorResponse("BAD_CALENDAR_URL",
                "That is not an http or https URL.")));
        }

        var allowed = await AllowedHostsAsync(db, ct);
        if (!allowed.Contains(uri.Host))
        {
            return (null, Results.BadRequest(new ErrorResponse("CALENDAR_HOST_NOT_ALLOWED",
                $"{uri.Host} is not on the holiday-import allowlist. Add it on Settings → "
                + "Maintenance, or paste the calendar contents instead.")));
        }

        try
        {
            var client = clients.CreateClient("calendar");
            var response = await client.GetAsync(uri, ct);
            if (!response.IsSuccessStatusCode)
            {
                return (null, Results.BadRequest(new ErrorResponse("CALENDAR_UNREACHABLE",
                    $"The calendar answered {(int)response.StatusCode}.")));
            }
            return (await response.Content.ReadAsStringAsync(ct), null);
        }
        catch (HttpRequestException error)
        {
            return (null, Results.BadRequest(new ErrorResponse("CALENDAR_UNREACHABLE", error.Message)));
        }
        catch (TaskCanceledException)
        {
            return (null, Results.BadRequest(new ErrorResponse("CALENDAR_UNREACHABLE",
                "The calendar did not answer in time.")));
        }
    }
}

/// <summary>
/// Apply false previews; true writes the rows that are not already there. The two are one
/// endpoint on purpose: a preview built by different code from the write would eventually
/// disagree with it.
/// </summary>
public record HolidayImportRequest(
    IReadOnlyList<string> LocationIds,
    string? Url,
    string? Ics,
    DateOnly? From,
    DateOnly? To,
    bool Apply,
    /// <summary>Drop the feed observances. Default on: a national calendar is mostly
    /// them, and a non-working day is not the same thing as a note in a diary.</summary>
    bool HolidaysOnly = true);

public record HolidayImportResponse(IReadOnlyList<HolidayImportRow> Days, int Added);

/// <summary><paramref name="Skipped"/> is an observance the filter dropped;
/// <paramref name="AlreadyPresent"/> is a day this location already has off. Neither is
/// written, and both are listed, because the question a preview answers is "what will and
/// will not happen".</summary>
public record HolidayImportRow(
    DateOnly Date, string Name, string Category, bool AlreadyPresent, bool Skipped);

/// <summary>One published calendar an admin can import from by name.</summary>
public record HolidayCalendar(string Id, string Country, string Name, string Url);

/// <summary>
/// The public holiday calendars this product knows the address of.
///
/// WHY a fixed list: there is no registry of official holiday feeds to look one up in.
/// What exists is a handful of providers publishing one calendar per country, and naming
/// the one in use — whose host has to be on the <c>AllowedCalendarHost</c> allowlist for
/// the server to fetch it — is more honest than a search box that would mostly find the
/// wrong file. A calendar whose host is not allowed is not offered, so the two cannot
/// disagree.
///
/// These are the countries the roster actually has offices in. Adding one is a row.
/// </summary>
public static class HolidayCalendars
{
    private static string Google(string key) =>
        $"https://calendar.google.com/calendar/ical/en.{key}%23holiday%40group.v.calendar.google.com/public/basic.ics";

    public static readonly IReadOnlyList<HolidayCalendar> All =
    [
        new("gb", "United Kingdom", "United Kingdom — public holidays", Google("uk")),
        new("us", "United States", "United States — public holidays", Google("usa")),
        new("ch", "Switzerland", "Switzerland — public holidays", Google("ch")),
        new("in", "India", "India — public holidays", Google("indian")),
        new("sg", "Singapore", "Singapore — public holidays", Google("singapore")),
        new("de", "Germany", "Germany — public holidays", Google("german")),
        new("ie", "Ireland", "Ireland — public holidays", Google("irish")),
        new("pl", "Poland", "Poland — public holidays", Google("polish")),
    ];
}
