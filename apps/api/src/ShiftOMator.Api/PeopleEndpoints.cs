using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.People;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api;

/// <summary>
/// Person-profile editing — goes past the draft on purpose, same as on the client
/// (ADR-0015 doc comment): this is a setting auto-populate reads, not a schedule edit.
/// </summary>
public static class PeopleEndpoints
{
    public static void MapPeopleEndpoints(this WebApplication app)
    {
        app.MapPut("/api/people/{id}", async (string id, UpdatePersonRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var person = await db.People.Include(p => p.Eligibility).FirstOrDefaultAsync(p => p.Id == id, ct);
            if (person is null) return Results.NotFound(new NotFoundResponse("PERSON_NOT_FOUND", id));

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
        .Produces<Person>()
        .Produces<NotFoundResponse>(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.PlannerOrAbove);
    }
}
