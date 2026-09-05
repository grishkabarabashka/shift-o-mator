using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Presence;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api;

/// <summary>
/// Where people work (ADR-0043) — the first self-service surface, and the first thing
/// this product absorbs from the separate portal that used to own it.
///
/// WHY these are direct writes rather than draft changes: presence is not a roster
/// decision. It never affects coverage, never blocks a publish, and is owned by the
/// person it describes rather than by a planner. Routing it through
/// <c>DraftService.Publish</c> would mean an employee's "remote on Tuesday" sat invisible
/// until some planner happened to publish. It is still versioned and still audited —
/// the two properties the draft was actually providing.
/// </summary>
public static class PresenceEndpoints
{
    public static void MapPresenceEndpoints(this WebApplication app)
    {
        app.MapGet("/api/presence", async (
            DateOnly from, DateOnly to, string? personId, ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            if (to < from) return Results.BadRequest(new ErrorResponse("INVALID_RANGE", "`to` is before `from`."));

            // Overlap, not containment: a block that started last week still covers days
            // inside this window.
            var query = db.Presence.AsNoTracking().Where(p => p.From <= to && p.To >= from);
            if (!string.IsNullOrEmpty(personId)) query = query.Where(p => p.PersonId == personId);

            var records = await query.OrderBy(p => p.From).ThenBy(p => p.PersonId).ToListAsync(ct);
            return Results.Ok(new PresenceListResponse(records));
        })
        .WithName("ListPresence")
        .Produces<PresenceListResponse>()
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .RequireAuthorization(AuthPolicies.Authenticated);

        app.MapPost("/api/presence", async (
            UpsertPresenceRequest req, ClaimsPrincipal user, ActorResolver actors,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var actorId = await actors.RequireAsync(user, ct);
            var (refusal, type) = await ValidateAsync(req, user, actorId, db, ct);
            if (refusal is not null) return refusal;

            var now = DateTimeOffset.UtcNow;
            var record = new PresenceRecord
            {
                Id = Guid.NewGuid().ToString("n"),
                PersonId = req.PersonId,
                TypeId = req.TypeId,
                SiteLocationId = type.NamesALocation ? req.SiteLocationId : null,
                SiteLabel = type.NamesALocation ? null : req.SiteLabel,
                From = req.From,
                To = req.To,
                Source = PresenceSource.Manual,
                Note = req.Note,
                Version = 1,
                CreatedBy = actorId,
                CreatedAt = now,
            };
            // Recording a day replaces what already covered it (ADR-0052) — otherwise
            // "in the office" over a remote week left both rows and the cell showed
            // whichever the projection reached last.
            Requests.ApprovedRequestApplier.SupersedePresence(db, record, actorId, now);
            db.Presence.Add(record);
            db.RecordPresence(HistoryAction.Created, record, actorId);

            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/presence/{record.Id}", record);
        })
        .WithName("CreatePresence")
        .Produces<PresenceRecord>(StatusCodes.Status201Created)
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden)
        // Viewer, not Planner: everyone records their own presence. Which records a
        // caller may touch is a per-resource question (ADR-0046), answered below.
        .RequireAuthorization(AuthPolicies.Authenticated);

        app.MapPut("/api/presence/{id}", async (
            string id, UpsertPresenceRequest req, ClaimsPrincipal user, ActorResolver actors,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var record = await db.Presence.FirstOrDefaultAsync(p => p.Id == id, ct);
            if (record is null) return Results.NotFound(new NotFoundResponse("PRESENCE_NOT_FOUND", id));

            var actorId = await actors.RequireAsync(user, ct);
            // Checked against the stored subject as well as the requested one: reassigning
            // a record to someone else is not a way around the ownership check.
            if (!await CanWriteFor(db, user, actorId, record.PersonId, ct)) return Forbidden(record.PersonId);

            var (refusal, type) = await ValidateAsync(req, user, actorId, db, ct);
            if (refusal is not null) return refusal;

            if (req.Version is not null && req.Version != record.Version)
            {
                return Results.Conflict(new ErrorResponse("PRESENCE_VERSION_CONFLICT",
                    $"This record changed since you loaded it (now at version {record.Version})."));
            }

            record.PersonId = req.PersonId;
            record.TypeId = req.TypeId;
            record.SiteLocationId = type.NamesALocation ? req.SiteLocationId : null;
            record.SiteLabel = type.NamesALocation ? null : req.SiteLabel;
            record.From = req.From;
            record.To = req.To;
            record.Note = req.Note;
            record.Version += 1;
            record.UpdatedBy = actorId;
            record.UpdatedAt = DateTimeOffset.UtcNow;

            db.RecordPresence(HistoryAction.Updated, record, actorId);
            await db.SaveChangesAsync(ct);
            return Results.Ok(record);
        })
        .WithName("UpdatePresence")
        .Produces<PresenceRecord>()
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden)
        .Produces<ErrorResponse>(StatusCodes.Status409Conflict)
        .Produces<NotFoundResponse>(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.Authenticated);

        app.MapDelete("/api/presence/{id}", async (
            string id, ClaimsPrincipal user, ActorResolver actors, ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var record = await db.Presence.FirstOrDefaultAsync(p => p.Id == id, ct);
            if (record is null) return Results.NotFound(new NotFoundResponse("PRESENCE_NOT_FOUND", id));

            var actorId = await actors.RequireAsync(user, ct);
            if (!await CanWriteFor(db, user, actorId, record.PersonId, ct)) return Forbidden(record.PersonId);

            db.Presence.Remove(record);
            db.RecordPresence(HistoryAction.Deleted, record, actorId, snapshot: false);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        })
        .WithName("DeletePresence")
        .Produces(StatusCodes.Status204NoContent)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden)
        .Produces<NotFoundResponse>(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.Authenticated);
    }

    /// <summary>
    /// Your own record, or you plan the unit the subject belongs to (ADR-0051).
    ///
    /// The subject's unit has to be read, because planning rights are scoped to one:
    /// planning unit-amer says nothing about writing an unit-emea engineer's row.
    /// </summary>
    private static async Task<bool> CanWriteFor(
        ShiftOMatorDbContext db, ClaimsPrincipal user, string actorId, string subjectPersonId,
        CancellationToken ct)
    {
        if (actorId == subjectPersonId) return true;

        var unitId = await db.People.AsNoTracking()
            .Where(p => p.Id == subjectPersonId)
            .Select(p => p.UnitId)
            .FirstOrDefaultAsync(ct);

        return unitId is not null && user.CanPlan(unitId);
    }

    private static IResult Forbidden(string subjectPersonId) =>
        Results.Json(
            new ErrorResponse("NOT_YOUR_RECORD",
                $"Only {subjectPersonId} or a planner can change this presence record."),
            statusCode: StatusCodes.Status403Forbidden);

    /// <summary>
    /// Refuses, or hands back the type the caller named — which both write paths then need
    /// for the one behavioural question a type answers: whether the record points at one
    /// of our offices or carries free text.
    /// </summary>
    private static async Task<(IResult? Refusal, PresenceType? Type)> ValidateAsync(
        UpsertPresenceRequest req, ClaimsPrincipal user, string actorId, ShiftOMatorDbContext db, CancellationToken ct)
    {
        if (req.To < req.From)
            return (Results.BadRequest(new ErrorResponse("INVALID_RANGE", "`to` is before `from`.")), null);

        if (!await CanWriteFor(db, user, actorId, req.PersonId, ct)) return (Forbidden(req.PersonId), null);

        if (!await db.People.AsNoTracking().AnyAsync(p => p.Id == req.PersonId, ct))
            return (Results.BadRequest(new ErrorResponse("PERSON_NOT_FOUND", $"Person {req.PersonId} does not exist.")), null);

        var type = await db.PresenceTypes.AsNoTracking().FirstOrDefaultAsync(t => t.Id == req.TypeId, ct);
        if (type is null)
        {
            return (Results.BadRequest(new ErrorResponse("PRESENCE_TYPE_NOT_FOUND",
                $"There is no way of working called {req.TypeId}.")), null);
        }

        // The same rule absences follow (ADR-0052): if the thing needs approving, no
        // direct write of it is accepted from anybody, planner included. The client routes
        // it to a request; this is what makes that more than a client-side convention.
        if (type.RequiresApproval)
        {
            return (Results.BadRequest(new ErrorResponse("APPROVAL_REQUIRED",
                $"{type.Label} has to be asked for and approved; it cannot be recorded directly.")), null);
        }

        if (type.NamesALocation && !string.IsNullOrEmpty(req.SiteLocationId)
            && !await db.Locations.AsNoTracking().AnyAsync(l => l.Id == req.SiteLocationId, ct))
        {
            return (Results.BadRequest(new ErrorResponse("LOCATION_NOT_FOUND",
                $"Location {req.SiteLocationId} does not exist.")), null);
        }

        return (null, type);
    }
}
