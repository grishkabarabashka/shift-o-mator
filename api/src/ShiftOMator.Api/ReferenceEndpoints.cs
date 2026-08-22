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
            var regions = await db.Regions.AsNoTracking()
                .Include(r => r.Locations)
                .Include(r => r.Roles)
                .Include(r => r.Shifts)
                .Include(r => r.DayConfigurations).ThenInclude(c => c.RoleRequirements)
                .Include(r => r.AbsenceCapacityRules)
                .ToListAsync();
            var units = await db.PlanningUnits.AsNoTracking().ToListAsync();
            var people = await db.People.AsNoTracking().Include(p => p.Eligibility).ToListAsync();

            return Results.Ok(new
            {
                locations,
                holidays,
                regions,
                units,
                shifts = regions.SelectMany(r => r.Shifts),
                roles = regions.SelectMany(r => r.Roles),
                dayConfigurations = regions.SelectMany(r => r.DayConfigurations),
                people,
                absenceCapacityRules = regions.SelectMany(r => r.AbsenceCapacityRules),
            });
        })
        .WithName("GetReference")
        .RequireAuthorization(AuthPolicies.ViewerOrAbove);
    }
}
