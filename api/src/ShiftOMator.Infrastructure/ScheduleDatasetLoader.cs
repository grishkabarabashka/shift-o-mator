using Microsoft.EntityFrameworkCore;
using ShiftOMator.Application;

namespace ShiftOMator.Infrastructure;

/// <summary>
/// Loads a full <see cref="ScheduleDataset"/> from the database — the same shape the
/// engines and the differential test already operate on, so <c>GET /api/schedule</c>
/// and the draft/publish endpoints share one read path instead of each hand-rolling
/// its own query set (Docs/12-architecture.md).
/// </summary>
public static class ScheduleDatasetLoader
{
    public static async Task<ScheduleDataset> LoadAsync(ScheduleDbContext db, CancellationToken ct = default)
    {
        var locations = await db.Locations.AsNoTracking().ToListAsync(ct);
        var holidays = await db.Holidays.AsNoTracking().ToListAsync(ct);
        var regions = await db.Regions.AsNoTracking()
            .Include(r => r.Locations)
            .Include(r => r.Roles)
            .Include(r => r.Shifts)
            .Include(r => r.DayConfigurations).ThenInclude(c => c.RoleRequirements)
            .Include(r => r.AbsenceCapacityRules)
            .ToListAsync(ct);
        var units = await db.PlanningUnits.AsNoTracking().ToListAsync(ct);
        var people = await db.People.AsNoTracking().Include(p => p.Eligibility).ToListAsync(ct);

        var assignments = await db.Assignments.AsNoTracking().ToListAsync(ct);
        var absences = await db.Absences.AsNoTracking().ToListAsync(ct);
        var compDays = await db.CompDayEntries.AsNoTracking().ToListAsync(ct);
        var acknowledgements = await db.Acknowledgements.AsNoTracking().ToListAsync(ct);
        var history = await db.AssignmentHistory.AsNoTracking().ToListAsync(ct);

        return new ScheduleDataset
        {
            Locations = locations,
            Holidays = holidays,
            Regions = regions,
            Units = units,
            Shifts = [.. regions.SelectMany(r => r.Shifts)],
            Roles = [.. regions.SelectMany(r => r.Roles)],
            DayConfigurations = [.. regions.SelectMany(r => r.DayConfigurations)],
            People = people,
            AbsenceCapacityRules = [.. regions.SelectMany(r => r.AbsenceCapacityRules)],
            Assignments = assignments,
            Absences = absences,
            CompDays = compDays,
            Acknowledgements = acknowledgements,
            History = history,
        };
    }
}
