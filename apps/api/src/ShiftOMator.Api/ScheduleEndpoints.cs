using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Schedule;
using ShiftOMator.Application;
using ShiftOMator.Application.Drafts;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api;

/// <summary>
/// The one endpoint that lets coverage and issues stay entirely server-computed while
/// still reflecting a draft's uncommitted edits: an optional <c>draftId</c> overlays the
/// draft's changes onto the plan in memory before recomputing, without publishing
/// anything (Phase 3 plan, "the important one").
/// </summary>
public static class ScheduleEndpoints
{
    public static void MapScheduleEndpoints(this WebApplication app)
    {
        app.MapGet("/api/schedule", async (
            string unitId, DateOnly from, DateOnly to, string? draftId, ScheduleDbContext db, CancellationToken ct) =>
        {
            if (to < from) return Results.BadRequest(new InvalidRangeResponse("INVALID_RANGE", "to must not be before from."));

            var dataset = await ScheduleDatasetLoader.LoadAsync(db, ct);

            DraftSession? draft = null;
            if (!string.IsNullOrEmpty(draftId))
            {
                draft = await db.DraftSessions.AsNoTracking().Include(s => s.Changes)
                    .FirstOrDefaultAsync(s => s.Id == draftId, ct);
                if (draft is null) return Results.NotFound(new DraftNotFoundResponse("DRAFT_NOT_FOUND", draftId));
            }

            var (assignments, absences, compDays) = Overlay(dataset, draft);
            var overlaid = new ScheduleDataset
            {
                Locations = dataset.Locations,
                Holidays = dataset.Holidays,
                Units = dataset.Units,
                Shifts = dataset.Shifts,
                DayConfigurations = dataset.DayConfigurations,
                People = dataset.People,
                AbsenceCapacityRules = dataset.AbsenceCapacityRules,
                Assignments = assignments,
                Absences = absences,
                CompDays = compDays,
                Acknowledgements = dataset.Acknowledgements,
                History = dataset.History,
            };
            var index = DatasetIndex.Build(overlaid);
            var unitIds = ResolveUnitIds(unitId, dataset);
            var acknowledged = Validator.AcknowledgedKeys(dataset.Acknowledgements);
            var asOf = DateOnly.FromDateTime(DateTime.UtcNow);

            var coverage = new List<CoverageCell>();
            var issues = new List<Issue>();
            var dayConfigs = new List<DayConfigurationSummary>();

            foreach (var resolvedUnitId in unitIds)
            {
                var cells = CoverageCalculator.Compute(resolvedUnitId, from, to, assignments, index);
                coverage.AddRange(cells);

                var unitIssues = Validator.Validate(new Validator.ValidateParams(
                    resolvedUnitId, from, to, assignments, absences, compDays, cells, overlaid.AbsenceCapacityRules, index, asOf));
                issues.AddRange(unitIssues);

                foreach (var date in DateHelpers.EachDate(from, to))
                {
                    var config = DayConfigurationResolver.Resolve(resolvedUnitId, date, index);
                    if (config is null) continue;
                    dayConfigs.Add(new DayConfigurationSummary(date, resolvedUnitId, config.Id, config.Key, config.Label));
                }
            }

            var rangeAssignments = assignments.Where(a => a.Date >= from && a.Date <= to).ToList();
            var rangeAbsences = absences.Where(a => DateHelpers.RangesOverlap(a.From, a.To, from, to)).ToList();
            var rangeCompDays = compDays.Where(c => c.EarnedForDate >= from && c.EarnedForDate <= to
                || (c.ProposedDate is not null && c.ProposedDate >= from && c.ProposedDate <= to)
                || (c.ActualDate is not null && c.ActualDate >= from && c.ActualDate <= to)).ToList();

            return Results.Ok(new ScheduleResponse(
                unitIds,
                new SchedulePlan(rangeAssignments, rangeAbsences, rangeCompDays),
                coverage,
                issues,
                acknowledged,
                dayConfigs,
                draftId));
        })
        .WithName("GetSchedule")
        .Produces<ScheduleResponse>()
        .Produces<InvalidRangeResponse>(StatusCodes.Status400BadRequest)
        .Produces<DraftNotFoundResponse>(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.ViewerOrAbove);
    }

    /// <summary>Best-effort preview overlay — publish is where conflicts are actually
    /// enforced (ADR-0015); a read of an open draft should never itself fail.</summary>
    private static (List<Assignment> Assignments, List<Absence> Absences, List<CompDayEntry> CompDays) Overlay(
        ScheduleDataset dataset, DraftSession? draft)
    {
        var assignments = dataset.Assignments.ToDictionary(a => a.Id);
        var absences = dataset.Absences.ToDictionary(a => a.Id);
        var compDays = dataset.CompDays.ToDictionary(c => c.Id);
        if (draft is null) return (assignments.Values.ToList(), absences.Values.ToList(), compDays.Values.ToList());

        foreach (var change in draft.Changes.OrderBy(c => c.Seq))
        {
            try
            {
                switch (change.TargetType)
                {
                    case DraftTargetType.Assignment:
                        ApplyOverlay(assignments, change, a => a.Id);
                        break;
                    case DraftTargetType.Absence:
                        ApplyOverlay(absences, change, a => a.Id);
                        break;
                    case DraftTargetType.CompDay:
                        ApplyOverlay(compDays, change, c => c.Id);
                        break;
                }
            }
            catch (DraftDomainException)
            {
                // A malformed snapshot shouldn't break the read of the rest of the plan.
            }
        }
        return (assignments.Values.ToList(), absences.Values.ToList(), compDays.Values.ToList());
    }

    private static void ApplyOverlay<T>(Dictionary<string, T> byId, DraftChange change, Func<T, string> idOf)
    {
        if (change.Op == DraftOp.Delete)
        {
            var before = DraftJson.Deserialize<T>(change.BeforeJson!);
            byId.Remove(idOf(before));
        }
        else
        {
            var after = DraftJson.Deserialize<T>(change.AfterJson!);
            byId[idOf(after)] = after;
        }
    }

    /// <summary>PlanningUnit is now the single computation scope (Region deleted, Phase
    /// 8) — no more fan-out to derive a cross-cutting unit's involved regions, a unit's
    /// own id is the whole answer.</summary>
    private static List<string> ResolveUnitIds(string unitId, ScheduleDataset dataset)
    {
        if (string.IsNullOrEmpty(unitId) || unitId == "ALL_UNITS")
            return [.. dataset.Units.Select(u => u.Id)];

        return dataset.Units.Any(u => u.Id == unitId)
            ? [unitId]
            : [.. dataset.Units.Select(u => u.Id)];
    }
}
