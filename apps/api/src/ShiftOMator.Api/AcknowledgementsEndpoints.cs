using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api;

/// <summary>
/// Point 11: a soft rule never blocks publication, but does require a deliberate,
/// recorded acknowledgement. Matched by <see cref="Issue.Key"/>, which is stable across
/// recomputations — not a foreign key into anything that gets regenerated.
/// </summary>
public static class AcknowledgementsEndpoints
{
    public record AcknowledgeRequest(string IssueKey, string Comment, string ByPersonId);

    public static void MapAcknowledgementsEndpoints(this WebApplication app)
    {
        app.MapPost("/api/acknowledgements", async (AcknowledgeRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var existing = await db.Acknowledgements.FirstOrDefaultAsync(a => a.IssueKey == req.IssueKey, ct);
            var now = DateTimeOffset.UtcNow;

            if (existing is null)
            {
                existing = new Acknowledgement
                {
                    IssueKey = req.IssueKey,
                    Comment = req.Comment,
                    ByPersonId = req.ByPersonId,
                    At = now,
                };
                db.Acknowledgements.Add(existing);
            }
            else
            {
                existing.Comment = req.Comment;
                existing.ByPersonId = req.ByPersonId;
                existing.At = now;
            }

            await db.SaveChangesAsync(ct);
            return Results.Ok(existing);
        })
        .WithName("Acknowledge")
        .RequireAuthorization(AuthPolicies.PlannerOrAbove);
    }
}
