using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api;

/// <summary>
/// The append-only audit (ADR-0041). It is the whole of the access-control story —
/// ADR-0032 removed unit-scoped write permissions on the grounds that this trail exists —
/// so it now covers absences, comp days, person edits and configuration changes, not
/// just assignments, and it is filterable rather than "everything in this date range".
/// </summary>
public static class HistoryEndpoints
{
    public static void MapHistoryEndpoints(this WebApplication app)
    {
        app.MapGet("/api/history", async (
            DateOnly from, DateOnly to, string? personId, HistoryEntityType? entityType,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var fromAt = new DateTimeOffset(from.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
            var toAt = new DateTimeOffset(to.ToDateTime(TimeOnly.MaxValue), TimeSpan.Zero);

            var query = db.ChangeHistory.AsNoTracking().Where(h => h.At >= fromAt && h.At <= toAt);
            if (!string.IsNullOrEmpty(personId)) query = query.Where(h => h.PersonId == personId);
            if (entityType is not null) query = query.Where(h => h.EntityType == entityType);

            var entries = await query.OrderBy(h => h.At).ToListAsync(ct);
            return Results.Ok(entries);
        })
        .WithName("GetHistory")
        .Produces<IReadOnlyList<ChangeHistoryEntry>>()
        .RequireAuthorization(AuthPolicies.Authenticated);
    }
}
