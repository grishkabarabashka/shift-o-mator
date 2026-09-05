using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Admin;
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
        app.MapPut("/api/people/{id}", async (
            string id, UpdatePersonRequest req, ClaimsPrincipal user, ActorResolver actors,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var person = await db.People.Include(p => p.Eligibility).FirstOrDefaultAsync(p => p.Id == id, ct);
            if (person is null) return Results.NotFound(new NotFoundResponse("PERSON_NOT_FOUND", id));

            if (req.Constraints is { } limits)
            {
                var v = new AdminValidation()
                    .Check(nameof(req.Constraints), limits.MinRestHours is >= 0 and <= 24, "minimum rest must be between 0 and 24 hours.")
                    .Check(nameof(req.Constraints), limits.MaxConsecutiveDays >= 1, "consecutive-day limit must be at least 1.")
                    .Check(nameof(req.Constraints), limits.MaxWeekendsPerQuarter is null or >= 0, "weekend limit cannot be negative.");
                if (v.ToBadRequestOrNull() is { } bad) return bad;
            }

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

            if (req.Constraints is { } constraints)
            {
                person.Constraints = new PersonConstraints
                {
                    MinRestHours = constraints.MinRestHours,
                    MaxConsecutiveDays = constraints.MaxConsecutiveDays,
                    MaxWeekendsPerQuarter = constraints.MaxWeekendsPerQuarter,
                };
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

            // ADR-0041: this write skips the draft, so nothing else would record it.
            // Eligibility and availability decide who auto-populate can pick — a silent
            // edit here changes tomorrow's roster with no trace of who made it.
            db.RecordPerson(
                HistoryAction.Updated, id,
                $"Profile updated ({person.Eligibility.Count} eligible shifts).",
                person, await actors.RequireAsync(user, ct));

            await db.SaveChangesAsync(ct);
            return Results.Ok(person);
        })
        .WithName("UpdatePerson")
        .Produces<Person>()
        .Produces<NotFoundResponse>(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.PlannerSomewhere);
    }
}
