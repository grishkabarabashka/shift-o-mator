using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Requests;
using ShiftOMator.Application.Requests;
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
            string unitId, DateOnly from, DateOnly to, string? draftId,
            ClaimsPrincipal user, ActorResolver actors, ScheduleDbContext db, CancellationToken ct) =>
        {
            if (to < from) return Results.BadRequest(new InvalidRangeResponse("INVALID_RANGE", "to must not be before from."));

            var dataset = await ScheduleDatasetLoader.LoadAsync(db, from, to, ct);

            DraftSession? draft = null;
            if (!string.IsNullOrEmpty(draftId))
            {
                draft = await db.DraftSessions.AsNoTracking().Include(s => s.Changes)
                    .FirstOrDefaultAsync(s => s.Id == draftId, ct);
                if (draft is null) return Results.NotFound(new DraftNotFoundResponse("DRAFT_NOT_FOUND", draftId));
            }

            var (assignments, absences, compDays) = DraftOverlay.Apply(dataset, draft);
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
                Presence = dataset.Presence,
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
            var rangePresence = dataset.Presence
                .Where(p => DateHelpers.RangesOverlap(p.From, p.To, from, to)).ToList();

            var pending = await PendingRequestsAsync(db, user, actors, from, to, dataset.People, dataset.Units, ct);

            return Results.Ok(new ScheduleResponse(
                unitIds,
                new SchedulePlan(rangeAssignments, rangeAbsences, rangeCompDays, rangePresence),
                coverage,
                issues,
                acknowledged,
                dayConfigs,
                draftId,
                pending));
        })
        .WithName("GetSchedule")
        .Produces<ScheduleResponse>()
        .Produces<InvalidRangeResponse>(StatusCodes.Status400BadRequest)
        .Produces<DraftNotFoundResponse>(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.Authenticated);
    }

    /// <summary>
    /// Requests still awaiting a decision over this window, with whether *this* caller can
    /// act on each. Route resolution is not expressible in SQL, so it runs in memory —
    /// which is fine at this scale and is the same work the inbox does.
    /// </summary>
    private static async Task<List<PendingRequestSummary>> PendingRequestsAsync(
        ScheduleDbContext db, ClaimsPrincipal user, ActorResolver actors,
        DateOnly from, DateOnly to, List<Person> people,
        List<PlanningUnit> units, CancellationToken ct)
    {
        var open = await db.Requests.AsNoTracking().Include(r => r.Decisions)
            .Where(r => r.State == RequestState.Submitted && r.From <= to && r.To >= from)
            .ToListAsync(ct);
        if (open.Count == 0) return [];

        var actorId = await actors.RequireAsync(user, ct);
        var types = await db.RequestTypes.AsNoTracking().ToListAsync(ct);
        var roles = await db.RoleAssignments.AsNoTracking().ToListAsync(ct);

        // WHY no unit filter: the pending marks are a per-cell overlay, and the grid shows
        // rows outside the selected unit on purpose -- your own row always (ADR-0046), and
        // everyone holding a shift in the unit when that toggle is on (ADR-0032). Filtering
        // by the request's unit hid the mark on exactly those rows, so a request raised by
        // an admin from another unit vanished as soon as the scope changed. Membership of
        // the roster below is the only filter that matters.
        var summaries = new List<PendingRequestSummary>();
        foreach (var request in open)
        {
            var type = types.FirstOrDefault(t => t.Id == request.TypeId);
            var subject = people.FirstOrDefault(p => p.Id == request.SubjectPersonId);
            if (type is null || subject is null) continue;

            var approvers = RequestService.ApproversFor(request, roles, people);

            summaries.Add(new PendingRequestSummary(
                request.Id, type.Id, type.Code, type.Label, type.Category,
                subject.Id, subject.DisplayName, request.From, request.To, request.Portion,
                request.CreatedAt,
                approvers.Contains(actorId)));
        }

        return summaries;
    }

    /// <summary>PlanningUnit is now the single computation scope (Region deleted, Phase
    /// 8) — no more fan-out to derive a cross-cutting unit's involved regions, a unit's
    /// own id is the whole answer.</summary>
    /// <summary>
    /// The `unitId` parameter carries a *scope*, not necessarily one unit: `ALL`, a
    /// single id, or a comma-separated set. A planning unit is a filter rather than a
    /// boundary (ADR-0032), and a planner who runs AMER together with Service Transition
    /// wants exactly those two — "all" mixes in EMEA and APAC, "one" hides the other.
    ///
    /// A scope that matches nothing falls back to every unit: an empty screen reads as a
    /// broken query, not as an answer.
    /// </summary>
    private static List<string> ResolveUnitIds(string unitId, ScheduleDataset dataset)
    {
        var all = () => dataset.Units.Select(u => u.Id).ToList();
        if (string.IsNullOrEmpty(unitId) || unitId == "ALL" || unitId == "ALL_UNITS") return all();

        var named = unitId.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet();
        var known = dataset.Units.Where(u => named.Contains(u.Id)).Select(u => u.Id).ToList();
        return known.Count > 0 ? known : all();
    }
}
