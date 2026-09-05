using ShiftOMator.Application.Drafts;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Auth;

/// <summary>
/// Writes an audit row for a change that does not go through a draft (ADR-0041):
/// person-profile edits and every <c>/api/admin/*</c> mutation.
///
/// WHY here and not in the Application layer: these are direct writes with no engine
/// involved, so there is no pure function to hang the record off — the endpoint is the
/// only place that knows what happened. The row shape is identical to the one
/// <c>DraftService.Publish</c> emits, so <c>GET /api/history</c> reads one stream.
/// </summary>
public static class ChangeAudit
{
    /// <summary>Records a configuration change. <paramref name="summary"/> is what a
    /// human reads in the timeline — "Coverage minimum for Crew raised 2 → 3" is worth
    /// more there than a serialized <c>ShiftRequirement</c>.</summary>
    public static void RecordConfiguration(
        this ShiftOMatorDbContext db, HistoryAction action, string entityId, string summary,
        object? snapshot, string actorId,
        HistoryEntityType entityType = HistoryEntityType.Configuration) =>
        db.ChangeHistory.Add(new ChangeHistoryEntry
        {
            Id = Guid.NewGuid().ToString("n"),
            EntityType = entityType,
            EntityId = entityId,
            Action = action,
            Summary = summary,
            SnapshotJson = snapshot is null ? null : DraftJson.Serialize(snapshot),
            ActorId = actorId,
            At = DateTimeOffset.UtcNow,
        });

    /// <summary>
    /// Records a presence change (ADR-0043). Presence bypasses the draft, so this is the
    /// only trace of who declared what — and "was Dana in the office that day" is exactly
    /// the kind of question this table exists to answer.
    /// </summary>
    public static void RecordPresence(
        this ShiftOMatorDbContext db, HistoryAction action, PresenceRecord record, string actorId,
        bool snapshot = true) =>
        db.ChangeHistory.Add(new ChangeHistoryEntry
        {
            Id = Guid.NewGuid().ToString("n"),
            EntityType = HistoryEntityType.Presence,
            EntityId = record.Id,
            PersonId = record.PersonId,
            Action = action,
            AffectedFrom = record.From,
            AffectedTo = record.To,
            Summary = $"{record.TypeId} {record.From:yyyy-MM-dd}..{record.To:yyyy-MM-dd}",
            SnapshotJson = snapshot ? DraftJson.Serialize(record) : null,
            ActorId = actorId,
            At = DateTimeOffset.UtcNow,
        });

    /// <summary>
    /// Records an absence change (ADR-0052). Absences left the draft when the flows split:
    /// drafts publish the rota, and time off is decided by approval instead. This is now
    /// the only trace of who recorded it.
    /// </summary>
    public static void RecordAbsence(
        this ShiftOMatorDbContext db, HistoryAction action, Absence record, string actorId,
        string? typeLabel = null, bool snapshot = true) =>
        db.ChangeHistory.Add(new ChangeHistoryEntry
        {
            Id = Guid.NewGuid().ToString("n"),
            EntityType = HistoryEntityType.Absence,
            EntityId = record.Id,
            PersonId = record.PersonId,
            Action = action,
            AffectedFrom = record.From,
            AffectedTo = record.To,
            Summary = $"{typeLabel ?? record.EventTypeId} {record.From:yyyy-MM-dd}..{record.To:yyyy-MM-dd}",
            SnapshotJson = snapshot ? DraftJson.Serialize(record) : null,
            ActorId = actorId,
            At = DateTimeOffset.UtcNow,
        });

    /// <summary>Records a change to a person's own record — profile, eligibility,
    /// availability. Carries <see cref="ChangeHistoryEntry.PersonId"/> so it shows up on
    /// that person's activity timeline next to their schedule changes.</summary>
    public static void RecordPerson(
        this ShiftOMatorDbContext db, HistoryAction action, string personId, string summary,
        object? snapshot, string actorId) =>
        db.ChangeHistory.Add(new ChangeHistoryEntry
        {
            Id = Guid.NewGuid().ToString("n"),
            EntityType = HistoryEntityType.Person,
            EntityId = personId,
            PersonId = personId,
            Action = action,
            Summary = summary,
            SnapshotJson = snapshot is null ? null : DraftJson.Serialize(snapshot),
            ActorId = actorId,
            At = DateTimeOffset.UtcNow,
        });
}
