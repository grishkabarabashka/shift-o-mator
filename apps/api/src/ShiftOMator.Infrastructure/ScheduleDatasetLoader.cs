using Microsoft.EntityFrameworkCore;
using ShiftOMator.Application;

namespace ShiftOMator.Infrastructure;

/// <summary>
/// Loads a <see cref="ScheduleDataset"/> from the database — the same shape the engines
/// and the differential test already operate on, so <c>GET /api/schedule</c> and the
/// draft/publish endpoints share one read path instead of each hand-rolling its own
/// query set (Docs/12-architecture.md).
///
/// Scoped by date range since ADR-0042. The unscoped load pulled every assignment, every
/// absence, every comp day <i>and the entire append-only history table</i> into memory on
/// seven endpoints, one of which does it inside a serializable transaction — which made
/// publish latency a function of how long the system had been in service.
/// </summary>
public static class ScheduleDatasetLoader
{
    /// <summary>
    /// How far before the requested range plan rows must still be loaded.
    ///
    /// WHY 120 and not 0: the engines look backwards well past the window being shown.
    /// <c>CandidateRanker</c> counts the last 90 days for fairness and 84 for weekend
    /// load; <c>Validator.CheckWeekendLoad</c> uses a rolling 91-day window. Trimming to
    /// the visible range would silently reset everyone's fairness counters to zero and
    /// make the ranking wrong rather than merely stale.
    /// </summary>
    public const int LookbackDays = 120;

    /// <summary>
    /// How far past the requested range to load. Comp-day placement proposes dates
    /// outside the earning date's month, and the grid must see those proposals.
    /// </summary>
    public const int LookaheadDays = 45;

    /// <summary>Everything, unscoped. Used by seeding and by the baseline test; not by
    /// request paths.</summary>
    public static Task<ScheduleDataset> LoadAsync(ShiftOMatorDbContext db, CancellationToken ct = default) =>
        LoadAsync(db, null, null, ct);

    /// <summary>
    /// Reference data in full (it is small and every engine needs all of it), plan rows
    /// restricted to <paramref name="from"/>..<paramref name="to"/> widened by
    /// <see cref="LookbackDays"/>/<see cref="LookaheadDays"/>.
    ///
    /// One known, accepted consequence: <c>CandidateRanker</c>'s "days since last held"
    /// saturates at the lookback edge, so someone who last held a shift 200 days ago now
    /// ranks as "never held it". Both mean the same thing to the ordering — stale — and
    /// the alternative is loading the whole table to distinguish them.
    /// </summary>
    public static async Task<ScheduleDataset> LoadAsync(
        ShiftOMatorDbContext db, DateOnly? from, DateOnly? to, CancellationToken ct = default)
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
        var eventTypes = await db.EventTypes.AsNoTracking().ToListAsync(ct);

        var lower = from?.AddDays(-LookbackDays);
        var upper = to?.AddDays(LookaheadDays);

        var assignmentQuery = db.Assignments.AsNoTracking();
        if (lower is not null) assignmentQuery = assignmentQuery.Where(a => a.Date >= lower);
        if (upper is not null) assignmentQuery = assignmentQuery.Where(a => a.Date <= upper);
        var assignments = await assignmentQuery.ToListAsync(ct);

        // Ranges overlap the window rather than sit inside it — a vacation that started
        // in the previous month still covers days in this one.
        var absenceQuery = db.Absences.AsNoTracking();
        if (upper is not null) absenceQuery = absenceQuery.Where(a => a.From <= upper);
        if (lower is not null) absenceQuery = absenceQuery.Where(a => a.To >= lower);
        var absences = await absenceQuery.ToListAsync(ct);

        // A comp day is relevant if it was earned in the window or is placed in it —
        // the balance shown to a planner is "earned, not yet taken", so an old accrual
        // proposed for next week must still load.
        var compDayQuery = db.CompDayEntries.AsNoTracking();
        if (lower is not null && upper is not null)
        {
            compDayQuery = compDayQuery.Where(c =>
                (c.EarnedForDate >= lower && c.EarnedForDate <= upper)
                || (c.ProposedDate != null && c.ProposedDate >= lower && c.ProposedDate <= upper)
                || (c.ActualDate != null && c.ActualDate >= lower && c.ActualDate <= upper)
                || c.Status == Domain.CompDayStatus.PendingApproval);
        }
        var compDays = await compDayQuery.ToListAsync(ct);

        var presenceQuery = db.Presence.AsNoTracking();
        if (upper is not null) presenceQuery = presenceQuery.Where(p => p.From <= upper);
        if (lower is not null) presenceQuery = presenceQuery.Where(p => p.To >= lower);
        var presence = await presenceQuery.ToListAsync(ct);

        var acknowledgements = await db.Acknowledgements.AsNoTracking().ToListAsync(ct);

        return new ScheduleDataset
        {
            Locations = locations,
            Holidays = holidays,
            Units = units,
            Shifts = [.. units.SelectMany(u => u.Shifts)],
            DayConfigurations = [.. units.SelectMany(u => u.DayConfigurations)],
            People = people,
            EventTypes = eventTypes,
            AbsenceCapacityRules = [.. units.SelectMany(u => u.AbsenceCapacityRules)],
            Assignments = assignments,
            Absences = absences,
            CompDays = compDays,
            Presence = presence,
            Acknowledgements = acknowledgements,
            // History is never loaded into the dataset (ADR-0042): no engine reads it and
            // it grows without bound. GET /api/history queries the table directly.
            History = [],
        };
    }
}
