using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.History;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api;

/// <summary>
/// Everything that happened on one date — to one person, or to everybody.
///
/// The day-wide form is the one that matters when something has gone wrong: a conflict is
/// rarely one person's story, and "who moved what, in what order" needs the whole day on
/// one axis.
///
/// WHY a merge rather than a filter over <c>ChangeHistory</c> alone: a request's
/// submission and its approval are not change-history rows — nothing changed when
/// somebody asked. But "was the leave request in before or after the rota was moved" is
/// the question this endpoint exists for, and it is unanswerable from two separate lists.
/// </summary>
public static class CellHistoryEndpoints
{
    public static void MapCellHistoryEndpoints(this WebApplication app)
    {
        app.MapGet("/api/history/cell", async (
            DateOnly date, string? personId, ScheduleDbContext db, CancellationToken ct) =>
        {
            // No personId means the whole day, everyone.
            var allPeople = string.IsNullOrEmpty(personId);
            var names = await db.People.AsNoTracking()
                .Select(p => new { p.Id, p.DisplayName })
                .ToDictionaryAsync(p => p.Id, p => p.DisplayName, ct);

            var events = new List<CellEvent>();

            // Changes whose affected span covers this date. Rows written before the span
            // columns existed have nulls and are matched on PersonId alone, so old audit
            // is degraded rather than invisible.
            var changes = await db.ChangeHistory.AsNoTracking()
                .Where(h => (allPeople || h.PersonId == personId)
                    && h.PersonId != null
                    && ((h.AffectedFrom <= date && h.AffectedTo >= date)
                        || (h.AffectedFrom == null && h.AffectedTo == null)))
                .OrderBy(h => h.At)
                .ToListAsync(ct);

            foreach (var change in changes)
            {
                events.Add(new CellEvent(
                    change.At,
                    KindOf(change.EntityType),
                    change.ActorId,
                    names.GetValueOrDefault(change.ActorId),
                    Prefixed(allPeople, names, change.PersonId,
                        change.Summary ?? $"{change.EntityType} {Verb(change.Action)}"),
                    null));
            }

            var requests = await db.Requests.AsNoTracking().Include(r => r.Decisions)
                .Where(r => (allPeople || r.SubjectPersonId == personId)
                    && r.From <= date && r.To >= date)
                .ToListAsync(ct);

            var types = await db.RequestTypes.AsNoTracking().ToDictionaryAsync(t => t.Id, t => t.Label, ct);

            foreach (var request in requests)
            {
                var label = types.GetValueOrDefault(request.TypeId, request.TypeId);
                events.Add(new CellEvent(
                    request.CreatedAt,
                    CellEventKind.RequestSubmitted,
                    request.CreatedBy,
                    names.GetValueOrDefault(request.CreatedBy),
                    Prefixed(allPeople, names, request.SubjectPersonId,
                        $"Requested: {label} ({request.From:yyyy-MM-dd}..{request.To:yyyy-MM-dd})"),
                    request.Note));

                foreach (var decision in request.Decisions)
                {
                    events.Add(new CellEvent(
                        decision.At,
                        CellEventKind.RequestDecided,
                        decision.ByPersonId,
                        names.GetValueOrDefault(decision.ByPersonId),
                        Prefixed(allPeople, names, request.SubjectPersonId,
                            $"{Verb(decision.Decision)}: {label}"),
                        decision.Comment));
                }
            }

            return Results.Ok(new CellHistoryResponse(
                personId, date, [.. events.OrderBy(e => e.At)]));
        })
        .WithName("GetCellHistory")
        .Produces<CellHistoryResponse>()
        .RequireAuthorization(AuthPolicies.Authenticated);
    }

    /// <summary>In the day-wide view every line has to say who it is about; in the
    /// single-person view repeating the name on every line is noise.</summary>
    private static string Prefixed(
        bool allPeople, IReadOnlyDictionary<string, string> names, string? personId, string summary) =>
        allPeople && personId is not null
            ? $"{names.GetValueOrDefault(personId, personId)}: {summary}"
            : summary;

    private static CellEventKind KindOf(HistoryEntityType type) => type switch
    {
        HistoryEntityType.Absence => CellEventKind.AbsenceChanged,
        HistoryEntityType.Presence => CellEventKind.PresenceChanged,
        HistoryEntityType.CompDay => CellEventKind.CompDayChanged,
        _ => CellEventKind.AssignmentChanged,
    };

    private static string Verb(HistoryAction action) => action switch
    {
        HistoryAction.Created => "added",
        HistoryAction.Deleted => "removed",
        _ => "changed",
    };

    private static string Verb(ApprovalDecisionKind decision) => decision switch
    {
        ApprovalDecisionKind.Approve => "Approved",
        ApprovalDecisionKind.Reject => "Declined",
        _ => "Returned",
    };
}
