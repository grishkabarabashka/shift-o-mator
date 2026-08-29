using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Api.Contracts.Suggest;
using ShiftOMator.Application;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api;

/// <summary>
/// Preview-only: both endpoints run <see cref="CandidateRanker"/>/<see cref="AutoPopulateService"/>
/// against the live plan and return proposed changes without touching stored state — the
/// caller turns an accepted proposal into draft changes via <c>/api/drafts/{id}/changes</c>.
/// </summary>
public static class SuggestEndpoints
{
    public static void MapSuggestEndpoints(this WebApplication app)
    {
        app.MapPost("/api/suggest", async (SuggestRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            // One date, but the ranker looks 90 days back — the loader's lookback margin
            // is what keeps the fairness counters honest here (ADR-0042).
            var dataset = await ScheduleDatasetLoader.LoadAsync(db, req.Date, req.Date, ct);
            var index = DatasetIndex.Build(dataset);

            var result = CandidateRanker.Rank(new CandidateRanker.RankParams(
                req.ShiftId, req.Date, req.UnitId, index, dataset.Assignments, dataset.Absences, dataset.CompDays,
                req.ExcludePersonIds));

            return Results.Ok(result);
        })
        .WithName("Suggest")
        .Produces<CandidateRanker.CandidateResult>()
        .RequireAuthorization(AuthPolicies.PlannerSomewhere);

        app.MapPost("/api/auto-populate", async (AutoPopulateRequest req, ClaimsPrincipal user, ActorResolver actors, ScheduleDbContext db, CancellationToken ct) =>
        {
            if ((req.RangeTo.DayNumber - req.RangeFrom.DayNumber) > AutoPopulateService.MaxDays)
                return Results.BadRequest(new ErrorResponse("RANGE_TOO_LONG", $"Auto-populate is limited to {AutoPopulateService.MaxDays} days."));

            var dataset = await ScheduleDatasetLoader.LoadAsync(db, req.RangeFrom, req.RangeTo, ct);

            // NOTE: generation sees the plan through the planner's eyes — published plus
            // their own open draft. Otherwise cells already placed by hand would look
            // empty to it, and accepting the preview would overwrite them.
            DraftSession? draft = null;
            if (!string.IsNullOrEmpty(req.DraftId))
            {
                draft = await db.DraftSessions.AsNoTracking().Include(s => s.Changes)
                    .FirstOrDefaultAsync(s => s.Id == req.DraftId, ct);
                if (draft is null) return Results.NotFound(new ErrorResponse("DRAFT_NOT_FOUND", $"Draft {req.DraftId} does not exist."));
            }

            var (assignments, absences, compDays) = DraftOverlay.Apply(dataset, draft);
            var index = DatasetIndex.Build(new ScheduleDataset
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
            });

            var result = AutoPopulateService.Run(new AutoPopulateService.Params(
                req.UnitId, req.RangeFrom, req.RangeTo, req.LockedAssignmentIds ?? [],
                assignments, absences, compDays, index, await actors.RequireAsync(user, ct), DateTimeOffset.UtcNow));

            return Results.Ok(result);
        })
        .WithName("AutoPopulate")
        .Produces<AutoPopulateService.Result>()
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .RequireAuthorization(AuthPolicies.PlannerSomewhere);
    }
}
