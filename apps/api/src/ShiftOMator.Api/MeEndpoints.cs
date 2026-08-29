using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Me;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Application;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api;

/// <summary>
/// One person's own year — the read behind the My calendar screen, and the feed behind a
/// subscription in Outlook.
///
/// WHY a separate endpoint and not <c>/api/schedule</c>: that one is a planner's view.
/// It is scoped to a unit and a month, and it computes coverage, issues and resolved day
/// configurations for everybody in it. A personal calendar wants the opposite shape —
/// one person, a year or more, and none of the engines. Asking the planner's endpoint for
/// twelve months of eighty people to render one row would be an expensive way to throw
/// almost all of it away.
/// </summary>
public static class MeEndpoints
{
    /// <summary>A window this long is a scroll, not a query. Two years each way covers
    /// "book next summer" without letting a client ask for a century.</summary>
    private const int MaxDays = 800;

    public static void MapMeEndpoints(this WebApplication app)
    {
        app.MapGet("/api/me/calendar", async (
            DateOnly from, DateOnly to, ClaimsPrincipal user, ActorResolver actors,
            ScheduleDbContext db, CancellationToken ct) =>
        {
            if (to < from) return Results.BadRequest(new ErrorResponse("INVALID_RANGE", "`to` is before `from`."));
            if (to.DayNumber - from.DayNumber > MaxDays)
            {
                return Results.BadRequest(new ErrorResponse("RANGE_TOO_LONG",
                    $"A calendar window is at most {MaxDays} days."));
            }

            var me = await actors.RequireAsync(user, ct);

            // Overlap, not containment, for everything that is a range: a block of leave
            // that started last month still covers days in this window.
            var assignments = await db.Assignments.AsNoTracking()
                .Where(a => a.PersonId == me && a.Date >= from && a.Date <= to)
                .OrderBy(a => a.Date)
                .ToListAsync(ct);

            var absences = await db.Absences.AsNoTracking()
                .Where(a => a.PersonId == me && a.From <= to && a.To >= from)
                .ToListAsync(ct);

            var presence = await db.Presence.AsNoTracking()
                .Where(p => p.PersonId == me && p.From <= to && p.To >= from)
                .ToListAsync(ct);

            // Comp days come whole, not windowed: an unplaced one has no date to filter on
            // and is exactly what the screen exists to help with.
            var compDays = await db.CompDayEntries.AsNoTracking()
                .Where(c => c.PersonId == me)
                .OrderBy(c => c.EarnedForDate)
                .ToListAsync(ct);

            var pending = await db.Requests.AsNoTracking()
                .Where(r => r.SubjectPersonId == me
                    && (r.State == RequestState.Submitted || r.State == RequestState.Approved)
                    && r.From <= to && r.To >= from)
                .ToListAsync(ct);

            var types = await db.RequestTypes.AsNoTracking().ToDictionaryAsync(t => t.Id, ct);

            return Results.Ok(new MyCalendarResponse(
                me,
                assignments,
                absences,
                compDays,
                presence,
                [.. pending.Select(r => new MyPendingRequest(
                    r.Id,
                    r.TypeId,
                    types.GetValueOrDefault(r.TypeId)?.Label ?? r.TypeId,
                    r.From,
                    r.To,
                    r.Portion,
                    r.State))]));
        })
        .WithName("GetMyCalendar")
        .Produces<MyCalendarResponse>()
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .RequireAuthorization(AuthPolicies.Authenticated);

        app.MapGet("/api/me/calendar-feed", async (
            ClaimsPrincipal user, ActorResolver actors, HttpContext http, CancellationToken ct) =>
        {
            var person = await actors.RequirePersonAsync(user, ct);
            if (person is null) return Results.NotFound(new NotFoundResponse("PERSON_NOT_FOUND", "me"));
            return Results.Ok(new CalendarFeedResponse(FeedUrl(http, person.CalendarToken)));
        })
        .WithName("GetMyCalendarFeed")
        .Produces<CalendarFeedResponse>()
        .RequireAuthorization(AuthPolicies.Authenticated);

        app.MapPost("/api/me/calendar-feed/reset", async (
            ClaimsPrincipal user, ActorResolver actors, HttpContext http,
            ScheduleDbContext db, CancellationToken ct) =>
        {
            var me = await actors.RequireAsync(user, ct);
            var person = await db.People.FirstOrDefaultAsync(p => p.Id == me, ct);
            if (person is null) return Results.NotFound(new NotFoundResponse("PERSON_NOT_FOUND", me));

            // The only way to take back a URL that has been shared or leaked: the token is
            // the whole of the authentication, so rotating it is the revoke button.
            person.CalendarToken = Person.NewCalendarToken();
            db.RecordConfiguration(HistoryAction.Updated, person.Id,
                "Calendar feed address reset", null, me, HistoryEntityType.Person);
            await db.SaveChangesAsync(ct);

            return Results.Ok(new CalendarFeedResponse(FeedUrl(http, person.CalendarToken)));
        })
        .WithName("ResetMyCalendarFeed")
        .Produces<CalendarFeedResponse>()
        .RequireAuthorization(AuthPolicies.Authenticated);

        // Anonymous on purpose, and the only anonymous route in the product. Outlook and
        // Google subscribe by URL and cannot carry a bearer token, so the secret is in the
        // path — which is why Person.CalendarToken is 256 bits, is never serialized on any
        // list payload, and can be rotated from the screen above.
        app.MapGet("/api/calendar/{token}.ics", async (
            string token, ScheduleDbContext db, CancellationToken ct) =>
        {
            var person = await db.People.AsNoTracking()
                .FirstOrDefaultAsync(p => p.CalendarToken == token, ct);
            // Deliberately the same answer as an unknown route: a distinguishable "wrong
            // token" would make the address space searchable.
            if (person is null) return Results.NotFound();

            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var from = today.AddDays(-90);
            var to = today.AddDays(365);

            var ics = await BuildFeedAsync(db, person, from, to, ct);
            return Results.Text(ics, "text/calendar; charset=utf-8");
        })
        .WithName("GetCalendarFeed")
        .AllowAnonymous()
        .Produces<string>(StatusCodes.Status200OK, "text/calendar");
    }

    private static string FeedUrl(HttpContext http, string token) =>
        $"{http.Request.Scheme}://{http.Request.Host}/api/calendar/{token}.ics";

    /// <summary>
    /// The feed itself: shifts as timed events, everything else as whole days.
    ///
    /// WHY presence is not in it: a subscription lands in a calendar people use to find
    /// each other, and "remote on Tuesday" as an event in it would fill that calendar with
    /// notes about days rather than commitments. Leave and comp days are in, because they
    /// are exactly what a colleague looking for a free slot needs to see.
    /// </summary>
    private static async Task<string> BuildFeedAsync(
        ScheduleDbContext db, Person person, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var assignments = await db.Assignments.AsNoTracking()
            .Where(a => a.PersonId == person.Id && a.Date >= from && a.Date <= to)
            .ToListAsync(ct);

        var shifts = await db.Shifts.AsNoTracking().ToDictionaryAsync(s => s.Id, ct);

        var absences = await db.Absences.AsNoTracking()
            .Where(a => a.PersonId == person.Id && a.From <= to && a.To >= from)
            .ToListAsync(ct);

        var eventTypes = await db.EventTypes.AsNoTracking().ToDictionaryAsync(t => t.Id, ct);

        var compDays = await db.CompDayEntries.AsNoTracking()
            .Where(c => c.PersonId == person.Id
                && (c.Status == CompDayStatus.Scheduled || c.Status == CompDayStatus.Taken)
                && c.ActualDate != null
                && c.ActualDate >= from && c.ActualDate <= to)
            .ToListAsync(ct);

        var entries = new List<CalendarEntry>();

        foreach (var assignment in assignments)
        {
            if (assignment.ShiftId is null || !shifts.TryGetValue(assignment.ShiftId, out var shift)) continue;

            UtcInterval window;
            try
            {
                window = DateHelpers.ShiftInterval(shift, assignment.Date, assignment.TimeOverride);
            }
            // A shift with an impossible window is a data problem, and it must not take the
            // whole feed down with it — the other three hundred days are still true.
            catch (InvalidOperationException) { continue; }
            catch (TimeZoneNotFoundException) { continue; }

            entries.Add(new CalendarEntry(
                IcsWriter.Uid("shift", assignment.Id),
                shift.Code,
                shift.Description,
                assignment.Date,
                window.Start,
                window.End,
                Busy: true));
        }

        foreach (var absence in absences)
        {
            var label = eventTypes.GetValueOrDefault(absence.EventTypeId)?.Label ?? "Time off";
            var portion = absence.Portion switch
            {
                DayPortion.Morning => " (morning)",
                DayPortion.Afternoon => " (afternoon)",
                _ => string.Empty,
            };

            // One all-day event per day rather than one spanning event: a UID per day is
            // what lets a range that later gets trimmed (ADR-0052) drop the days it lost
            // instead of leaving a stale block behind in the subscriber's calendar.
            for (var date = Max(absence.From, from); date <= Min(absence.To, to); date = date.AddDays(1))
            {
                entries.Add(new CalendarEntry(
                    IcsWriter.Uid("absence", $"{absence.Id}-{IcsWriter.Day(date)}"),
                    label + portion,
                    null,
                    date,
                    null,
                    null,
                    Busy: absence.Portion == DayPortion.Full));
            }
        }

        foreach (var compDay in compDays)
        {
            entries.Add(new CalendarEntry(
                IcsWriter.Uid("comp-day", compDay.Id),
                "Comp day",
                $"Earned for {IcsWriter.Day(compDay.EarnedForDate)}",
                compDay.ActualDate!.Value,
                null,
                null,
                Busy: true));
        }

        return IcsWriter.Write($"{person.DisplayName} — shifts", entries, DateTimeOffset.UtcNow);
    }

    private static DateOnly Max(DateOnly a, DateOnly b) => a > b ? a : b;
    private static DateOnly Min(DateOnly a, DateOnly b) => a < b ? a : b;
}
