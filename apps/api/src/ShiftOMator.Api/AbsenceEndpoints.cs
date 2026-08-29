using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Absences;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api;

/// <summary>
/// Time off — direct writes, not draft changes (ADR-0052).
///
/// WHY the split: a draft exists so a planner can rearrange the rota privately and publish
/// it as one atomic decision. Time off is not part of that decision. It is asked for and
/// granted, on its own schedule, by different people — and staging it in somebody's draft
/// meant a sick day sat invisible until an unrelated planner happened to publish, and that
/// a non-planner recording one got a 403 from an endpoint they had no business calling.
///
/// The control that replaces the draft is **approval**, and it belongs to the kind of
/// absence rather than to the caller: an <see cref="EventType"/> with
/// <c>RequiresApproval</c> cannot be written here at all, by anyone. It goes through
/// <c>/api/requests</c>, and the approval writes the row.
///
/// Drafts and publication are now exclusively about shifts.
/// </summary>
public static class AbsenceEndpoints
{
    public static void MapAbsenceEndpoints(this WebApplication app)
    {
        app.MapGet("/api/absences", async (
            DateOnly from, DateOnly to, string? personId, ScheduleDbContext db, CancellationToken ct) =>
        {
            if (to < from) return Results.BadRequest(new ErrorResponse("INVALID_RANGE", "`to` is before `from`."));

            // Overlap, not containment: leave that started last week still covers days
            // inside this window.
            var query = db.Absences.AsNoTracking().Where(a => a.From <= to && a.To >= from);
            if (!string.IsNullOrEmpty(personId)) query = query.Where(a => a.PersonId == personId);

            var records = await query.OrderBy(a => a.From).ThenBy(a => a.PersonId).ToListAsync(ct);
            return Results.Ok(new AbsenceListResponse(records));
        })
        .WithName("ListAbsences")
        .Produces<AbsenceListResponse>()
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .RequireAuthorization(AuthPolicies.Authenticated);

        app.MapPost("/api/absences", async (
            UpsertAbsenceRequest req, ClaimsPrincipal user, ActorResolver actors,
            ScheduleDbContext db, CancellationToken ct) =>
        {
            var actorId = await actors.RequireAsync(user, ct);
            var checks = await ValidateAsync(req, user, actorId, db, ct);
            if (checks.Refusal is not null) return checks.Refusal;

            var now = DateTimeOffset.UtcNow;
            var record = new Absence
            {
                Id = Guid.NewGuid().ToString("n"),
                PersonId = req.PersonId,
                EventTypeId = req.EventTypeId,
                From = req.From,
                To = req.To,
                Portion = req.Portion,
                Source = AbsenceSource.Manual,
                Note = req.Note,
                Version = 1,
            };

            // Same rule as presence: a day gets one absence, and the newest wins
            // (ADR-0052).
            Requests.ApprovedRequestApplier.SupersedeAbsences(db, record, actorId);
            db.Absences.Add(record);
            db.RecordAbsence(HistoryAction.Created, record, actorId, checks.TypeLabel);

            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/absences/{record.Id}", record);
        })
        .WithName("CreateAbsence")
        .Produces<Absence>(StatusCodes.Status201Created)
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden)
        // Authenticated, not Planner: everyone records their own. Which records a caller
        // may touch is a per-resource question (ADR-0046), answered in ValidateAsync.
        .RequireAuthorization(AuthPolicies.Authenticated);

        app.MapPut("/api/absences/{id}", async (
            string id, UpsertAbsenceRequest req, ClaimsPrincipal user, ActorResolver actors,
            ScheduleDbContext db, CancellationToken ct) =>
        {
            var record = await db.Absences.FirstOrDefaultAsync(a => a.Id == id, ct);
            if (record is null) return Results.NotFound(new NotFoundResponse("ABSENCE_NOT_FOUND", id));

            var actorId = await actors.RequireAsync(user, ct);
            // Checked against the stored subject as well as the requested one: reassigning
            // a record to someone else is not a way around the ownership check.
            if (!await CanWriteFor(db, user, actorId, record.PersonId, ct)) return Forbidden(record.PersonId);

            var checks = await ValidateAsync(req, user, actorId, db, ct);
            if (checks.Refusal is not null) return checks.Refusal;

            if (req.Version is { } expected && expected != record.Version)
            {
                return Results.Json(
                    new ErrorResponse("ABSENCE_VERSION_CONFLICT",
                        $"This absence has changed since you loaded it (yours {expected}, current {record.Version})."),
                    statusCode: StatusCodes.Status409Conflict);
            }

            record.PersonId = req.PersonId;
            record.EventTypeId = req.EventTypeId;
            record.From = req.From;
            record.To = req.To;
            record.Portion = req.Portion;
            record.Note = req.Note;
            record.Version += 1;

            db.RecordAbsence(HistoryAction.Updated, record, actorId, checks.TypeLabel);

            await db.SaveChangesAsync(ct);
            return Results.Ok(record);
        })
        .WithName("UpdateAbsence")
        .Produces<Absence>()
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden)
        .Produces<ErrorResponse>(StatusCodes.Status409Conflict)
        .Produces<NotFoundResponse>(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.Authenticated);

        app.MapDelete("/api/absences/{id}", async (
            string id, ClaimsPrincipal user, ActorResolver actors,
            ScheduleDbContext db, CancellationToken ct) =>
        {
            var record = await db.Absences.FirstOrDefaultAsync(a => a.Id == id, ct);
            if (record is null) return Results.NotFound(new NotFoundResponse("ABSENCE_NOT_FOUND", id));

            var actorId = await actors.RequireAsync(user, ct);
            if (!await CanWriteFor(db, user, actorId, record.PersonId, ct)) return Forbidden(record.PersonId);

            db.Absences.Remove(record);
            db.RecordAbsence(HistoryAction.Deleted, record, actorId, snapshot: false);

            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        })
        .WithName("DeleteAbsence")
        .Produces(StatusCodes.Status204NoContent)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden)
        .Produces<NotFoundResponse>(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.Authenticated);
    }

    private sealed record Checks(IResult? Refusal, string? TypeLabel);

    private static async Task<Checks> ValidateAsync(
        UpsertAbsenceRequest req, ClaimsPrincipal user, string actorId,
        ScheduleDbContext db, CancellationToken ct)
    {
        if (req.To < req.From)
            return new Checks(Results.BadRequest(new ErrorResponse("INVALID_RANGE", "`to` is before `from`.")), null);

        if (!await CanWriteFor(db, user, actorId, req.PersonId, ct))
            return new Checks(Forbidden(req.PersonId), null);

        var type = await db.EventTypes.AsNoTracking().FirstOrDefaultAsync(t => t.Id == req.EventTypeId, ct);
        if (type is null)
        {
            return new Checks(
                Results.BadRequest(new ErrorResponse("EVENT_TYPE_NOT_FOUND", req.EventTypeId)), null);
        }

        if (!type.IsActive)
        {
            return new Checks(
                Results.BadRequest(new ErrorResponse("EVENT_TYPE_INACTIVE",
                    $"{type.Label} is no longer offered.")), null);
        }

        // The rule that makes this endpoint safe to expose to everybody. Needing approval
        // is a property of the kind of absence, so nobody writes one directly — not the
        // subject, and not a planner (ADR-0051).
        if (type.RequiresApproval)
        {
            return new Checks(
                Results.BadRequest(new ErrorResponse("APPROVAL_REQUIRED",
                    $"{type.Label} has to be requested and approved; it cannot be recorded directly.")),
                null);
        }

        if (req.Portion != DayPortion.Full && !type.AllowsHalfDay)
        {
            return new Checks(
                Results.BadRequest(new ErrorResponse("HALF_DAY_NOT_ALLOWED",
                    $"{type.Label} cannot be taken as half a day.")), null);
        }

        if (!await db.People.AsNoTracking().AnyAsync(p => p.Id == req.PersonId, ct))
        {
            return new Checks(
                Results.BadRequest(new ErrorResponse("PERSON_NOT_FOUND",
                    $"Person {req.PersonId} does not exist.")), null);
        }

        return new Checks(null, type.Label);
    }

    /// <summary>
    /// Your own record, or you plan the unit the subject belongs to (ADR-0051).
    ///
    /// The subject's unit has to be read, because planning rights are scoped to one:
    /// planning unit-amer says nothing about writing an unit-emea engineer's row.
    /// </summary>
    private static async Task<bool> CanWriteFor(
        ScheduleDbContext db, ClaimsPrincipal user, string actorId, string subjectPersonId,
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
                $"Only {subjectPersonId} or a planner of their unit can change this absence."),
            statusCode: StatusCodes.Status403Forbidden);
}
