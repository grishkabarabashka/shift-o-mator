using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Insights;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Api.Insights;
using ShiftOMator.Application;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api;

/// <summary>
/// Explanations over the plan, as opposed to decisions about it. Nothing here writes:
/// the validation engines stay the source of truth, and this endpoint only phrases what
/// they already computed (<see cref="IssueDigest"/> → <see cref="GapSummaryService"/>).
///
/// Deliberately optional. Without an API key the endpoint answers 503 with a typed code
/// the UI can recognise, so a deployment with no model access simply doesn't show the
/// panel — planning itself never depends on it.
/// </summary>
public static class InsightsEndpoints
{
    public static void MapInsightsEndpoints(this WebApplication app)
    {
        app.MapPost("/api/insights/gap-summary", async (
            GapSummaryRequest req, ScheduleDbContext db, GapSummaryService summaries, CancellationToken ct) =>
        {
            if (req.To < req.From) return Results.BadRequest(new ErrorResponse("INVALID_RANGE", "`to` is before `from`."));
            if (!summaries.Configured)
            {
                return Results.Json(
                    new ErrorResponse("AI_NOT_CONFIGURED", "No chat model is configured on the server (see the Ai section)."),
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }

            var dataset = await ScheduleDatasetLoader.LoadAsync(db, ct);

            DraftSession? draft = null;
            if (!string.IsNullOrEmpty(req.DraftId))
            {
                draft = await db.DraftSessions.AsNoTracking().Include(s => s.Changes)
                    .FirstOrDefaultAsync(s => s.Id == req.DraftId, ct);
                if (draft is null) return Results.NotFound(new ErrorResponse("DRAFT_NOT_FOUND", $"Draft {req.DraftId} does not exist."));
            }

            // Планировщик спрашивает про то, что видит на экране, — значит про
            // опубликованное плюс свой черновик, как и /api/schedule.
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
                Acknowledgements = dataset.Acknowledgements,
                History = dataset.History,
            };
            var index = DatasetIndex.Build(overlaid);
            var asOf = DateOnly.FromDateTime(DateTime.UtcNow);

            var cells = CoverageCalculator.Compute(req.UnitId, req.From, req.To, assignments, index);
            var issues = Validator.Validate(new Validator.ValidateParams(
                req.UnitId, req.From, req.To, assignments, absences, compDays, cells,
                overlaid.AbsenceCapacityRules, index, asOf));

            var digest = IssueDigest.Build(
                req.UnitId, req.From, req.To, issues, Validator.AcknowledgedKeys(dataset.Acknowledgements), index);

            // Пустой период не стоит вызова модели: ответ известен заранее.
            if (digest.Total == 0)
            {
                return Results.Ok(new GapSummaryResponse(
                    "No coverage gaps, conflicts or warnings in this period.",
                    digest.Total, digest.Gaps, digest.Conflicts, digest.Warnings, digest.Blocking,
                    Model: null, GeneratedAt: DateTimeOffset.UtcNow));
            }

            try
            {
                var summary = await summaries.SummarizeAsync(digest, ct);
                return Results.Ok(new GapSummaryResponse(
                    summary, digest.Total, digest.Gaps, digest.Conflicts, digest.Warnings, digest.Blocking,
                    summaries.ModelId, DateTimeOffset.UtcNow));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Модель недоступна — это не отказ экрана: счётчики и панель нарушений
                // на месте, нет только текста.
                return Results.Json(
                    new ErrorResponse("AI_UNAVAILABLE", ex.Message),
                    statusCode: StatusCodes.Status502BadGateway);
            }
        })
        .WithName("GapSummary")
        .Produces<GapSummaryResponse>()
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status502BadGateway)
        .Produces<ErrorResponse>(StatusCodes.Status503ServiceUnavailable)
        .RequireAuthorization(AuthPolicies.ViewerOrAbove);
    }
}
