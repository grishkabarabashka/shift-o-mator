using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Reference;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api;

/// <summary>
/// Read-only reference data — the same payload shape `loadReference()` returns on the
/// client today, so `HttpScheduleRepository` (Phase 5) is a drop-in.
/// </summary>
public static class ReferenceEndpoints
{
    public static void MapReferenceEndpoints(this WebApplication app)
    {
        app.MapGet("/api/reference", async (ScheduleDbContext db) =>
        {
            var locations = await db.Locations.AsNoTracking().ToListAsync();
            var holidays = await db.Holidays.AsNoTracking().ToListAsync();
            var units = await db.PlanningUnits.AsNoTracking()
                .Include(u => u.Locations)
                .Include(u => u.Shifts)
                .Include(u => u.DayConfigurations).ThenInclude(c => c.ShiftRequirements)
                .Include(u => u.AbsenceCapacityRules)
                .ToListAsync();
            var people = await db.People.AsNoTracking().Include(p => p.Eligibility).ToListAsync();
            var eventTypes = await db.EventTypes.AsNoTracking()
                .Where(t => t.IsActive)
                .OrderBy(t => t.SortOrder)
                .ToListAsync();
            var presenceTypes = await db.PresenceTypes.AsNoTracking()
                .OrderBy(t => t.SortOrder)
                .ToListAsync();

            return Results.Ok(new ReferenceResponse(
                locations,
                holidays,
                units,
                units.SelectMany(u => u.Shifts),
                units.SelectMany(u => u.DayConfigurations),
                people,
                units.SelectMany(u => u.AbsenceCapacityRules),
                eventTypes,
                presenceTypes));
        })
        .WithName("GetReference")
        .Produces<ReferenceResponse>()
        .RequireAuthorization(AuthPolicies.Authenticated);
    }
}
