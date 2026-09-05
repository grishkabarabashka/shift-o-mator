using ShiftOMator.Application;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;
using ShiftOMator.Api.Auth;

namespace ShiftOMator.Api.Requests;

/// <summary>
/// Turns an approved request into the thing it was asking for (ADR-0047).
///
/// NOTE: named for the act, not the enum — <c>RequestMaterializer</c> is the domain enum
/// that says <i>what</i> a type produces, and two things with one name in scope is how
/// you get a call site that compiles against the wrong one.
///
/// WHY a direct write and not a planner draft: the draft exists so a planner can stage a
/// batch of roster decisions and review them together before they become real. An
/// approved request has already been reviewed — by a named human, with a recorded
/// comment — so routing it into someone else's draft would add a second review that
/// nobody asked for and leave the approved leave invisible until that person happened to
/// publish. The two properties the draft was providing, a version token and an audit
/// row, are provided here directly.
///
/// Everything runs inside the caller's transaction, so a request can never end up
/// <see cref="RequestState.Applied"/> without the row it claims to have created.
/// </summary>
public static class ApprovedRequestApplier
{
    public sealed record Result(string? EntityId, string? FailureReason);

    /// <summary>
    /// Makes room for <paramref name="incoming"/> by trimming what already covers those
    /// days (ADR-0052).
    ///
    /// WHY it is here and not left to the projection: approving "remote on Wednesday" over
    /// an existing "office Mon–Fri" used to add a second row and leave the cell rendering
    /// whichever the client reached last. The day did not change, which is the one thing
    /// the approval was for.
    /// </summary>
    public static void SupersedePresence(
        ShiftOMatorDbContext db, PresenceRecord incoming, string actorId, DateTimeOffset now)
    {
        var existing = db.Presence
            .Where(p => p.PersonId == incoming.PersonId
                && p.Id != incoming.Id
                && p.From <= incoming.To && p.To >= incoming.From)
            .ToList();

        var plan = RangeSupersede.Against(
            existing, incoming.From, incoming.To, incoming.Portion,
            p => p.From, p => p.To, p => p.Portion,
            (p, from, to) => { p.From = from; p.To = to; });

        foreach (var gone in plan.Removed)
        {
            db.Presence.Remove(gone);
            db.RecordPresence(HistoryAction.Deleted, gone, actorId, snapshot: false);
        }

        foreach (var kept in plan.Trimmed)
        {
            kept.Version += 1;
            db.RecordPresence(HistoryAction.Updated, kept, actorId);
        }

        foreach (var (source, from, to) in plan.Split)
        {
            var tail = new PresenceRecord
            {
                Id = Guid.NewGuid().ToString("n"),
                PersonId = source.PersonId,
                TypeId = source.TypeId,
                SiteLocationId = source.SiteLocationId,
                SiteLabel = source.SiteLabel,
                From = from,
                To = to,
                Portion = source.Portion,
                Source = source.Source,
                Note = source.Note,
                Version = 1,
                CreatedBy = actorId,
                CreatedAt = now,
            };
            db.Presence.Add(tail);
            db.RecordPresence(HistoryAction.Created, tail, actorId);
        }
    }

    /// <summary>The same for time off. Changing the kind of leave on a day is a new
    /// request that supersedes the old absence, not an edit of it.</summary>
    public static void SupersedeAbsences(ShiftOMatorDbContext db, Absence incoming, string actorId)
    {
        var existing = db.Absences
            .Where(a => a.PersonId == incoming.PersonId
                && a.Id != incoming.Id
                && a.From <= incoming.To && a.To >= incoming.From)
            .ToList();

        var plan = RangeSupersede.Against(
            existing, incoming.From, incoming.To, incoming.Portion,
            a => a.From, a => a.To, a => a.Portion,
            (a, from, to) => { a.From = from; a.To = to; });

        foreach (var gone in plan.Removed)
        {
            db.Absences.Remove(gone);
            db.RecordAbsence(HistoryAction.Deleted, gone, actorId, snapshot: false);
        }

        foreach (var kept in plan.Trimmed)
        {
            kept.Version += 1;
            db.RecordAbsence(HistoryAction.Updated, kept, actorId);
        }

        foreach (var (source, from, to) in plan.Split)
        {
            var tail = new Absence
            {
                Id = Guid.NewGuid().ToString("n"),
                PersonId = source.PersonId,
                EventTypeId = source.EventTypeId,
                From = from,
                To = to,
                Portion = source.Portion,
                Source = source.Source,
                Note = source.Note,
                Version = 1,
            };
            db.Absences.Add(tail);
            db.RecordAbsence(HistoryAction.Created, tail, actorId);
        }
    }

    public static Result Apply(
        ShiftOMatorDbContext db, Request request, RequestType type, string actorId, DateTimeOffset now)
    {
        return type.Materializer switch
        {
            Domain.RequestMaterializer.None => new Result(null, null),
            Domain.RequestMaterializer.Presence => ApplyPresence(db, request, type, actorId, now),
            Domain.RequestMaterializer.Absence => ApplyAbsence(db, request, type, actorId, now),
            Domain.RequestMaterializer.CompDay => PlaceCompDay(db, request, actorId, now),
            _ => new Result(null, $"Unknown materializer {type.Materializer}."),
        };
    }

    private static Result ApplyPresence(
        ShiftOMatorDbContext db, Request request, RequestType type, string actorId, DateTimeOffset now)
    {
        if (type.PresenceTypeId is null)
            return new Result(null, $"Request type {type.Code} produces presence but names no kind.");

        var payload = RequestPayload.Read(request.PayloadJson);
        var record = new PresenceRecord
        {
            Id = Guid.NewGuid().ToString("n"),
            PersonId = request.SubjectPersonId,
            TypeId = type.PresenceTypeId,
            SiteLocationId = payload.SiteLocationId,
            SiteLabel = payload.SiteLabel,
            From = request.From,
            To = request.To,
            Source = PresenceSource.Request,
            Portion = request.Portion,
            RequestId = request.Id,
            Note = request.Note,
            Version = 1,
            CreatedBy = actorId,
            CreatedAt = now,
        };

        SupersedePresence(db, record, actorId, now);
        db.Presence.Add(record);
        db.RecordPresence(HistoryAction.Created, record, actorId);
        return new Result(record.Id, null);
    }

    /// <summary>
    /// Settles *when* an earned comp day is taken (ADR-0052).
    ///
    /// WHY it moves a row rather than creating one: the accrual is created when the
    /// weekend shift is published, and it exists whether or not anybody has decided where
    /// to put it. A second row would mean the balance counted the same worked Saturday
    /// twice, and the link back to the shift that earned it — the thing the engineer and
    /// the manager both need to see — would live on only one of them.
    /// </summary>
    private static Result PlaceCompDay(
        ShiftOMatorDbContext db, Request request, string actorId, DateTimeOffset now)
    {
        var compDayId = RequestPayload.Read(request.PayloadJson).CompDayId;
        if (compDayId is null)
            return new Result(null, "This placement names no comp day.");

        var entry = db.CompDayEntries.FirstOrDefault(c => c.Id == compDayId);
        if (entry is null)
            return new Result(null, $"Comp day {compDayId} no longer exists.");

        if (entry.PersonId != request.SubjectPersonId)
            return new Result(null, "That comp day belongs to somebody else.");

        if (entry.Status == CompDayStatus.Taken)
            return new Result(null, "That comp day has already been taken.");

        entry.ActualDate = request.From;
        entry.Status = CompDayStatus.Scheduled;
        entry.Version += 1;

        db.ChangeHistory.Add(new ChangeHistoryEntry
        {
            Id = Guid.NewGuid().ToString("n"),
            EntityType = HistoryEntityType.CompDay,
            EntityId = entry.Id,
            PersonId = entry.PersonId,
            Action = HistoryAction.Updated,
            AffectedFrom = request.From,
            AffectedTo = request.From,
            Summary = $"Comp day for {entry.EarnedForDate:yyyy-MM-dd} placed on {request.From:yyyy-MM-dd} (approved request {request.Id})",
            ActorId = actorId,
            At = now,
        });

        return new Result(entry.Id, null);
    }

    private static Result ApplyAbsence(
        ShiftOMatorDbContext db, Request request, RequestType type, string actorId, DateTimeOffset now)
    {
        if (type.EventTypeId is null)
            return new Result(null, $"Request type {type.Code} produces leave but names no event type.");

        var absence = new Absence
        {
            Id = Guid.NewGuid().ToString("n"),
            PersonId = request.SubjectPersonId,
            EventTypeId = type.EventTypeId,
            From = request.From,
            To = request.To,
            Source = AbsenceSource.Request,
            Portion = request.Portion,
            Note = request.Note,
            Version = 1,
        };

        SupersedeAbsences(db, absence, actorId);
        db.Absences.Add(absence);
        db.ChangeHistory.Add(new ChangeHistoryEntry
        {
            Id = Guid.NewGuid().ToString("n"),
            EntityType = HistoryEntityType.Absence,
            EntityId = absence.Id,
            PersonId = absence.PersonId,
            Action = HistoryAction.Created,
            AffectedFrom = absence.From,
            AffectedTo = absence.To,
            Summary = $"{type.Label} {absence.From:yyyy-MM-dd}..{absence.To:yyyy-MM-dd} (approved request {request.Id})",
            ActorId = actorId,
            At = now,
        });

        return new Result(absence.Id, null);
    }
}
