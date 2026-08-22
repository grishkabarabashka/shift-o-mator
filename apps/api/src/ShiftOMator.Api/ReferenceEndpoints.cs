using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api;

/// <summary>
/// Read-only reference data — the same payload shape `loadReference()` returns on the
/// client today, so `HttpScheduleRepository` (Phase 5) is a drop-in. Full DTO/OpenAPI
/// contract alignment is Phase 5's job; this is deliberately the plain entity shape so
/// Phase 2 has something real to `curl` and to write integration tests against.
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

            return Results.Ok(new
            {
                locations,
                holidays,
                units,
                shifts = units.SelectMany(u => u.Shifts),
                dayConfigurations = units.SelectMany(u => u.DayConfigurations),
                people,
                absenceCapacityRules = units.SelectMany(u => u.AbsenceCapacityRules),
            });
        })
        .WithName("GetReference")
        .RequireAuthorization(AuthPolicies.ViewerOrAbove);
    }
}
