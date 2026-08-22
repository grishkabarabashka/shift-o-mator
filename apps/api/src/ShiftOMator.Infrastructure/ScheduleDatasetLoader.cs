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
        var units = await db.PlanningUnits.AsNoTracking()
            .Include(u => u.Locations)
            .Include(u => u.Shifts)
            .Include(u => u.DayConfigurations).ThenInclude(c => c.ShiftRequirements)
            .Include(u => u.AbsenceCapacityRules)
            .ToListAsync(ct);
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
            Units = units,
            Shifts = [.. units.SelectMany(u => u.Shifts)],
            DayConfigurations = [.. units.SelectMany(u => u.DayConfigurations)],
            People = people,
            AbsenceCapacityRules = [.. units.SelectMany(u => u.AbsenceCapacityRules)],
            Assignments = assignments,
            Absences = absences,
            CompDays = compDays,
            Acknowledgements = acknowledgements,
            History = history,
        };
    }
}
