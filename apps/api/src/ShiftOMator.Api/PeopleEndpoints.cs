using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api;

/// <summary>
/// Person-profile editing (`repository.ts`'s `savePerson`): target shares, available
/// weekdays, preferences. Goes past the draft on purpose, same as on the client
/// (ADR-0015 doc comment) — this is a setting auto-populate reads, not a schedule edit.
/// Not the admin CRUD surface (Phase 6, `/api/admin/people`); this is the one mutable
/// slice the People page already edited against the in-memory repository, kept working
/// across the HTTP cutover.
/// </summary>
public static class PeopleEndpoints
{
    public record ShiftEligibilityRequest(string ShiftId, double TargetShare, int? MinPerWeek, int? MaxPerWeek);

    public record PersonPreferencesRequest(
        List<IsoWeekday>? AvoidsWeekdays, List<string>? PreferredPartnerIds, List<DateOnly>? BlackoutDates, string? Note);

    public record UpdatePersonRequest(
        List<ShiftEligibilityRequest> Eligibility,
        List<IsoWeekday> AvailableWeekdays,
        string? DefaultShiftId,
        bool WeekendEligible,
        PersonPreferencesRequest? Preferences);

    public static void MapPeopleEndpoints(this WebApplication app)
    {
        app.MapPut("/api/people/{id}", async (string id, UpdatePersonRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var person = await db.People.Include(p => p.Eligibility).FirstOrDefaultAsync(p => p.Id == id, ct);
            if (person is null) return Results.NotFound(new { code = "PERSON_NOT_FOUND", id });

            person.Eligibility.Clear();
            foreach (var e in req.Eligibility)
            {
                person.Eligibility.Add(new ShiftEligibility
                {
                    PersonId = id,
                    ShiftId = e.ShiftId,
                    TargetShare = e.TargetShare,
                    MinPerWeek = e.MinPerWeek,
                    MaxPerWeek = e.MaxPerWeek,
                });
            }

            person.AvailableWeekdays = req.AvailableWeekdays;
            person.DefaultShiftId = req.DefaultShiftId;
            person.WeekendEligible = req.WeekendEligible;
            person.Preferences = req.Preferences is null
                ? null
                : new PersonPreferences
                {
                    AvoidsWeekdays = req.Preferences.AvoidsWeekdays ?? [],
                    PreferredPartnerIds = req.Preferences.PreferredPartnerIds ?? [],
                    BlackoutDates = req.Preferences.BlackoutDates ?? [],
                    Note = req.Preferences.Note,
                };

            await db.SaveChangesAsync(ct);
            return Results.Ok(person);
        })
        .WithName("UpdatePerson")
        .RequireAuthorization(AuthPolicies.PlannerOrAbove);
    }
}
