using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api;

/// <summary>Append-only audit written by a successful publish (ADR-0015).</summary>
public static class HistoryEndpoints
{
    public static void MapHistoryEndpoints(this WebApplication app)
    {
        app.MapGet("/api/history", async (DateOnly from, DateOnly to, ScheduleDbContext db, CancellationToken ct) =>
        {
            var fromAt = new DateTimeOffset(from.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
            var toAt = new DateTimeOffset(to.ToDateTime(TimeOnly.MaxValue), TimeSpan.Zero);
            var entries = await db.AssignmentHistory.AsNoTracking()
                .Where(h => h.At >= fromAt && h.At <= toAt)
                .OrderBy(h => h.At)
                .ToListAsync(ct);
            return Results.Ok(entries);
        })
        .WithName("GetHistory")
        .RequireAuthorization(AuthPolicies.ViewerOrAbove);
    }
}
