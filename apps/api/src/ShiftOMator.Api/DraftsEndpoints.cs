using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Drafts;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Application;
using ShiftOMator.Application.Drafts;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api;

public static class DraftsEndpoints
{
    public static void MapDraftsEndpoints(this WebApplication app)
    {
        app.MapPost("/api/drafts", async (OpenDraftRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var session = DraftService.Open(req.EditorPersonId, req.UnitId, req.RangeFrom, req.RangeTo, DateTimeOffset.UtcNow);
            db.DraftSessions.Add(session);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/drafts/{session.Id}", session);
        })
        .WithName("OpenDraft")
        .Produces<DraftSession>(StatusCodes.Status201Created)
        .RequireAuthorization(AuthPolicies.PlannerOrAbove);

        // Overlapping, informational (Docs/03) — several concurrent drafts on the same
        // unit/range are allowed; the UI just needs to know they exist.
        app.MapGet("/api/drafts", async (string? unitId, DateOnly? from, DateOnly? to, ScheduleDbContext db, CancellationToken ct) =>
        {
            var query = db.DraftSessions.AsNoTracking().Where(s => s.Status == DraftStatus.Open);
            if (!string.IsNullOrEmpty(unitId)) query = query.Where(s => s.UnitId == unitId);
            if (from is not null) query = query.Where(s => s.RangeTo >= from);
            if (to is not null) query = query.Where(s => s.RangeFrom <= to);
            var sessions = await query.ToListAsync(ct);
            return Results.Ok(sessions);
        })
        .WithName("ListDrafts")
        .Produces<IReadOnlyList<DraftSession>>()
        .RequireAuthorization(AuthPolicies.ViewerOrAbove);

        app.MapGet("/api/drafts/{id}/changes", async (string id, ScheduleDbContext db, CancellationToken ct) =>
        {
            var session = await db.DraftSessions.AsNoTracking().Include(s => s.Changes)
                .FirstOrDefaultAsync(s => s.Id == id, ct);
            if (session is null) return Results.NotFound();
            return Results.Ok(session.Changes.OrderBy(c => c.Seq));
        })
        .WithName("ListDraftChanges")
        .Produces<IReadOnlyList<DraftChange>>()
        .Produces(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.ViewerOrAbove);

        app.MapPost("/api/drafts/{id}/changes", async (string id, AppendChangeRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var session = await db.DraftSessions.Include(s => s.Changes).FirstOrDefaultAsync(s => s.Id == id, ct);
            if (session is null) return Results.NotFound();

            var dataset = await ScheduleDatasetLoader.LoadAsync(db, ct);
            var index = DatasetIndex.Build(dataset);
            var now = DateTimeOffset.UtcNow;

            try
            {
                DraftChange change = req.TargetType switch
                {
                    DraftTargetType.Assignment => DraftService.AppendAssignmentChange(
                        session, req.Op,
                        dataset.Assignments.FirstOrDefault(a => a.Id == req.EntityId),
                        req.Op == DraftOp.Delete ? null : DraftJson.DeserializeElement<Assignment>(req.After!.Value),
                        index, now),
                    DraftTargetType.Absence => DraftService.AppendAbsenceChange(
                        session, req.Op,
                        dataset.Absences.FirstOrDefault(a => a.Id == req.EntityId),
                        req.Op == DraftOp.Delete ? null : DraftJson.DeserializeElement<Absence>(req.After!.Value),
                        index, now),
                    DraftTargetType.CompDay => DraftService.AppendCompDayChange(
                        session, req.Op,
                        dataset.CompDays.FirstOrDefault(c => c.Id == req.EntityId),
                        req.Op == DraftOp.Delete ? null : DraftJson.DeserializeElement<CompDayEntry>(req.After!.Value),
                        index, now),
                    _ => throw new DraftDomainException("UNKNOWN_TARGET_TYPE", $"Unknown target type {req.TargetType}."),
                };

                await db.SaveChangesAsync(ct);
                return Results.Created($"/api/drafts/{id}/changes/{change.Id}", change);
            }
            catch (DraftDomainException ex)
            {
                return Results.BadRequest(new ErrorResponse(ex.Code, ex.Message));
            }
        })
        .WithName("AppendDraftChange")
        .Produces<DraftChange>(StatusCodes.Status201Created)
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.PlannerOrAbove);

        // The client syncs *desired cell state*, not a log of ops (SyncChangesRequest):
        // one request for a whole painted range, one change kept per cell, and the op
        // derived here from published data. Repainting a cell the same draft created is
        // then an ordinary replacement rather than an UPDATE against a row that does not
        // exist yet — which used to 400 and take the rest of the client's batch with it.
        app.MapPost("/api/drafts/{id}/changes/sync", async (string id, SyncChangesRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var session = await db.DraftSessions.Include(s => s.Changes).FirstOrDefaultAsync(s => s.Id == id, ct);
            if (session is null) return Results.NotFound();

            var dataset = await ScheduleDatasetLoader.LoadAsync(db, ct);
            var index = DatasetIndex.Build(dataset);
            var now = DateTimeOffset.UtcNow;

            try
            {
                foreach (var item in req.Changes)
                {
                    foreach (var stale in DraftService.TakeChangesForKey(session, item.TargetType, item.Key))
                        db.DraftChanges.Remove(stale);

                    switch (item.TargetType)
                    {
                        case DraftTargetType.Assignment:
                            SyncAssignment(session, item, index, now);
                            break;
                        case DraftTargetType.Absence:
                            SyncAbsence(session, item, dataset, index, now);
                            break;
                        case DraftTargetType.CompDay:
                            SyncCompDay(session, item, dataset, index, now);
                            break;
                        default:
                            throw new DraftDomainException("UNKNOWN_TARGET_TYPE", $"Unknown target type {item.TargetType}.");
                    }
                }
            }
            catch (DraftDomainException ex)
            {
                // Nothing is saved: SaveChangesAsync is below the loop, so a bad item
                // leaves the draft exactly as it was rather than half-applied.
                return Results.BadRequest(new ErrorResponse(ex.Code, ex.Message));
            }

            await db.SaveChangesAsync(ct);
            return Results.Ok(session.Changes.OrderBy(c => c.Seq));
        })
        .WithName("SyncDraftChanges")
        .Produces<IReadOnlyList<DraftChange>>()
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.PlannerOrAbove);

        app.MapDelete("/api/drafts/{id}/changes/{changeId}", async (string id, string changeId, ScheduleDbContext db, CancellationToken ct) =>
        {
            var session = await db.DraftSessions.Include(s => s.Changes).FirstOrDefaultAsync(s => s.Id == id, ct);
            if (session is null) return Results.NotFound();

            try
            {
                DraftService.RemoveChange(session, changeId);
            }
            catch (DraftDomainException ex)
            {
                return Results.BadRequest(new ErrorResponse(ex.Code, ex.Message));
            }

            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        })
        .WithName("RemoveDraftChange")
        .Produces(StatusCodes.Status204NoContent)
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.PlannerOrAbove);

        app.MapPost("/api/drafts/{id}/discard", async (string id, ScheduleDbContext db, CancellationToken ct) =>
        {
            var session = await db.DraftSessions.Include(s => s.Changes).FirstOrDefaultAsync(s => s.Id == id, ct);
            if (session is null) return Results.NotFound();

            try
            {
                DraftService.Discard(session, DateTimeOffset.UtcNow);
            }
            catch (DraftDomainException ex)
            {
                return Results.BadRequest(new ErrorResponse(ex.Code, ex.Message));
            }

            await db.SaveChangesAsync(ct);
            return Results.Ok(session);
        })
        .WithName("DiscardDraft")
        .Produces<DraftSession>()
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.PlannerOrAbove);

        app.MapPost("/api/drafts/{id}/publish", async (string id, ScheduleDbContext db, CancellationToken ct) =>
            await PublishAsync(id, db, ct))
        .WithName("PublishDraft")
        .Produces<PublishDraftResponse>()
        .Produces<PublishConflictResponse>(StatusCodes.Status409Conflict)
        .Produces<ErrorResponse>(StatusCodes.Status409Conflict)
        .Produces(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.PlannerOrAbove);
    }

    /// <summary>
    /// Turns "this cell should end up like this" into the create/update/delete the draft
    /// needs, against published data. The client's locally-minted id is discarded when the
    /// cell already holds a published row: the planner edited that row, whatever the grid
    /// called it while the draft was open.
    /// </summary>
    private static void SyncAssignment(DraftSession session, SyncChangeItem item, DatasetIndex index, DateTimeOffset now)
    {
        var before = index.AssignmentsByCell.GetValueOrDefault(item.Key);
        var after = DeserializeAfter<Assignment>(item);

        if (after is not null)
        {
            if (DraftService.AssignmentKeyOf(after) != item.Key)
            {
                throw new DraftDomainException("KEY_MISMATCH",
                    $"Payload describes cell {DraftService.AssignmentKeyOf(after)}, not {item.Key}.");
            }
            if (before is not null)
            {
                after.Id = before.Id;
                after.Version = before.Version;
            }
        }

        if (before is null && after is null) return; // an empty cell that stayed empty
        var op = before is null ? DraftOp.Create : after is null ? DraftOp.Delete : DraftOp.Update;
        DraftService.AppendAssignmentChange(session, op, before, after, index, now);
    }

    private static void SyncAbsence(
        DraftSession session, SyncChangeItem item, ScheduleDataset dataset, DatasetIndex index, DateTimeOffset now)
    {
        var before = dataset.Absences.FirstOrDefault(a => a.Id == item.Key);
        var after = DeserializeAfter<Absence>(item);
        if (before is null && after is null) return;
        var op = before is null ? DraftOp.Create : after is null ? DraftOp.Delete : DraftOp.Update;
        DraftService.AppendAbsenceChange(session, op, before, after, index, now);
    }

    private static void SyncCompDay(
        DraftSession session, SyncChangeItem item, ScheduleDataset dataset, DatasetIndex index, DateTimeOffset now)
    {
        var before = dataset.CompDays.FirstOrDefault(c => c.Id == item.Key);
        var after = DeserializeAfter<CompDayEntry>(item);
        if (before is null && after is null) return;
        var op = before is null ? DraftOp.Create : after is null ? DraftOp.Delete : DraftOp.Update;
        DraftService.AppendCompDayChange(session, op, before, after, index, now);
    }

    /// <summary>An absent field and an explicit <c>null</c> mean the same thing here:
    /// the client wants this cell/row gone.</summary>
    private static T? DeserializeAfter<T>(SyncChangeItem item) where T : class =>
        item.After is null || item.After.Value.ValueKind == JsonValueKind.Null
            ? null
            : DraftJson.DeserializeElement<T>(item.After.Value);

    /// <summary>
    /// One serializable transaction (ADR-0015): the plan is read fresh inside the
    /// transaction, every change is revalidated against it, and either everything is
    /// written or nothing is — a failed publish never touches the draft, so it stays
    /// open for the planner to compare/refresh/reapply.
    /// </summary>
    private static async Task<IResult> PublishAsync(string id, ScheduleDbContext db, CancellationToken ct)
    {
        var session = await db.DraftSessions.Include(s => s.Changes).FirstOrDefaultAsync(s => s.Id == id, ct);
        if (session is null) return Results.NotFound();
        if (session.Status != DraftStatus.Open)
            return Results.Conflict(new ErrorResponse("DRAFT_NOT_OPEN", $"Draft {id} is {session.Status}, not open."));

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);

        var dataset = await ScheduleDatasetLoader.LoadAsync(db, ct);
        var index = DatasetIndex.Build(dataset);
        var now = DateTimeOffset.UtcNow;
        var actorId = session.EditorPersonId;

        var outcome = DraftService.Publish(dataset, index, session, actorId, now);

        if (!outcome.Success)
        {
            await transaction.RollbackAsync(ct);
            return Results.Json(new PublishConflictResponse(outcome.Conflicts), statusCode: StatusCodes.Status409Conflict);
        }

        foreach (var change in session.Changes.OrderBy(c => c.Seq))
        {
            switch (change.TargetType)
            {
                case DraftTargetType.Assignment:
                    await ApplyAssignmentChange(db, change, outcome.Assignments, ct);
                    break;
                case DraftTargetType.Absence:
                    await ApplyAbsenceChange(db, change, outcome.Absences, ct);
                    break;
                case DraftTargetType.CompDay:
                    await ApplyCompDayChange(db, change, outcome.CompDays, ct);
                    break;
            }
        }

        db.AssignmentHistory.AddRange(outcome.History);
        db.CompDayEntries.AddRange(outcome.GeneratedCompDays);
        session.Status = DraftStatus.Published;
        session.UpdatedAt = now;

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return Results.Ok(new PublishDraftResponse(outcome.RemainingGaps, outcome.History, outcome.GeneratedCompDays));
    }

    private static async Task ApplyAssignmentChange(
        ScheduleDbContext db, DraftChange change, IReadOnlyList<Assignment> final, CancellationToken ct)
    {
        switch (change.Op)
        {
            case DraftOp.Create:
            {
                var id = DraftJson.Deserialize<Assignment>(change.AfterJson!).Id;
                db.Assignments.Add(final.First(a => a.Id == id));
                break;
            }
            case DraftOp.Update:
            {
                var id = DraftJson.Deserialize<Assignment>(change.AfterJson!).Id;
                var value = final.First(a => a.Id == id);
                var tracked = await db.Assignments.FindAsync([id], ct);
                if (tracked is null) { db.Assignments.Add(value); break; }
                CopyAssignment(value, tracked);
                break;
            }
            case DraftOp.Delete:
            {
                var id = DraftJson.Deserialize<Assignment>(change.BeforeJson!).Id;
                var tracked = await db.Assignments.FindAsync([id], ct);
                if (tracked is not null) db.Assignments.Remove(tracked);
                break;
            }
        }
    }

    private static void CopyAssignment(Assignment from, Assignment to)
    {
        to.PersonId = from.PersonId;
        to.Date = from.Date;
        to.UnitId = from.UnitId;
        to.ContentKind = from.ContentKind;
        to.ShiftId = from.ShiftId;
        to.TimeOverride = from.TimeOverride;
        to.Marker = from.Marker;
        to.IsWeekend = from.IsWeekend;
        to.Note = from.Note;
        to.Source = from.Source;
        to.Version = from.Version;
        to.UpdatedBy = from.UpdatedBy;
        to.UpdatedAt = from.UpdatedAt;
    }

    private static async Task ApplyAbsenceChange(
        ScheduleDbContext db, DraftChange change, IReadOnlyList<Absence> final, CancellationToken ct)
    {
        switch (change.Op)
        {
            case DraftOp.Create:
            {
                var id = DraftJson.Deserialize<Absence>(change.AfterJson!).Id;
                db.Absences.Add(final.First(a => a.Id == id));
                break;
            }
            case DraftOp.Update:
            {
                var id = DraftJson.Deserialize<Absence>(change.AfterJson!).Id;
                var value = final.First(a => a.Id == id);
                var tracked = await db.Absences.FindAsync([id], ct);
                if (tracked is null) { db.Absences.Add(value); break; }
                CopyAbsence(value, tracked);
                break;
            }
            case DraftOp.Delete:
            {
                var id = DraftJson.Deserialize<Absence>(change.BeforeJson!).Id;
                var tracked = await db.Absences.FindAsync([id], ct);
                if (tracked is not null) db.Absences.Remove(tracked);
                break;
            }
        }
    }

    private static void CopyAbsence(Absence from, Absence to)
    {
        to.PersonId = from.PersonId;
        to.Type = from.Type;
        to.From = from.From;
        to.To = from.To;
        to.Source = from.Source;
        to.ImportBatchId = from.ImportBatchId;
        to.LastSeenInImportAt = from.LastSeenInImportAt;
        to.SyncedToHrAt = from.SyncedToHrAt;
        to.Note = from.Note;
    }

    private static async Task ApplyCompDayChange(
        ScheduleDbContext db, DraftChange change, IReadOnlyList<CompDayEntry> final, CancellationToken ct)
    {
        switch (change.Op)
        {
            case DraftOp.Create:
            {
                var id = DraftJson.Deserialize<CompDayEntry>(change.AfterJson!).Id;
                db.CompDayEntries.Add(final.First(c => c.Id == id));
                break;
            }
            case DraftOp.Update:
            {
                var id = DraftJson.Deserialize<CompDayEntry>(change.AfterJson!).Id;
                var value = final.First(c => c.Id == id);
                var tracked = await db.CompDayEntries.FindAsync([id], ct);
                if (tracked is null) { db.CompDayEntries.Add(value); break; }
                CopyCompDay(value, tracked);
                break;
            }
            case DraftOp.Delete:
            {
                var id = DraftJson.Deserialize<CompDayEntry>(change.BeforeJson!).Id;
                var tracked = await db.CompDayEntries.FindAsync([id], ct);
                if (tracked is not null) db.CompDayEntries.Remove(tracked);
                break;
            }
        }
    }

    private static void CopyCompDay(CompDayEntry from, CompDayEntry to)
    {
        to.PersonId = from.PersonId;
        to.EarnedForAssignmentId = from.EarnedForAssignmentId;
        to.EarnedForDate = from.EarnedForDate;
        to.Trigger = from.Trigger;
        to.ProposedDate = from.ProposedDate;
        to.ActualDate = from.ActualDate;
        to.Status = from.Status;
        to.SyncedToHrAt = from.SyncedToHrAt;
    }
}
