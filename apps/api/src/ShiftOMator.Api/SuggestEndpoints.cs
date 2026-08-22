using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Api.Contracts.Suggest;
using ShiftOMator.Application;
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
            var dataset = await ScheduleDatasetLoader.LoadAsync(db, ct);
            var index = DatasetIndex.Build(dataset);

            var result = CandidateRanker.Rank(new CandidateRanker.RankParams(
                req.ShiftId, req.Date, req.UnitId, index, dataset.Assignments, dataset.Absences, dataset.CompDays,
                req.ExcludePersonIds));

            return Results.Ok(result);
        })
        .WithName("Suggest")
        .Produces<CandidateRanker.CandidateResult>()
        .RequireAuthorization(AuthPolicies.PlannerOrAbove);

        app.MapPost("/api/auto-populate", async (AutoPopulateRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            if ((req.RangeTo.DayNumber - req.RangeFrom.DayNumber) > AutoPopulateService.MaxDays)
                return Results.BadRequest(new ErrorResponse("RANGE_TOO_LONG", $"Auto-populate is limited to {AutoPopulateService.MaxDays} days."));

            var dataset = await ScheduleDatasetLoader.LoadAsync(db, ct);
            var index = DatasetIndex.Build(dataset);

            var result = AutoPopulateService.Run(new AutoPopulateService.Params(
                req.UnitId, req.RangeFrom, req.RangeTo, req.LockedAssignmentIds ?? [],
                dataset.Assignments, dataset.Absences, dataset.CompDays, index, req.ActorId, DateTimeOffset.UtcNow));

            return Results.Ok(result);
        })
        .WithName("AutoPopulate")
        .Produces<AutoPopulateService.Result>()
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .RequireAuthorization(AuthPolicies.PlannerOrAbove);
    }
}
