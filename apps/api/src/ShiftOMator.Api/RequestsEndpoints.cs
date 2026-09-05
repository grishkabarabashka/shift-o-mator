using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Requests;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Api.Requests;
using ShiftOMator.Infrastructure.Notifications;
using ShiftOMator.Application;
using ShiftOMator.Application.Requests;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api;

/// <summary>
/// Self-service requests and approvals (ADR-0045, ADR-0046, ADR-0047).
///
/// All of it is gated at <see cref="AuthPolicies.Authenticated"/> on purpose: every
/// employee raises requests about themselves, and "employee" is not a rung on the
/// Viewer &lt; Planner &lt; Admin ladder. Ownership and approver-ness are per-resource
/// questions, answered inline.
/// </summary>
public static class RequestsEndpoints
{
    public static void MapRequestsEndpoints(this WebApplication app)
    {
        app.MapGet("/api/request-types", async (ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var types = await db.RequestTypes.AsNoTracking()
                .Where(t => t.IsActive)
                .OrderBy(t => t.SortOrder).ThenBy(t => t.Label)
                .ToListAsync(ct);
            return Results.Ok(types);
        })
        .WithName("ListRequestTypes")
        .Produces<IReadOnlyList<RequestType>>()
        .RequireAuthorization(AuthPolicies.Authenticated);

        app.MapGet("/api/requests", async (
            string? scope, string? state, ClaimsPrincipal user, ActorResolver actors,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var actorId = await actors.RequireAsync(user, ct);
            var context = await LoadContextAsync(db, ct);

            var query = db.Requests.AsNoTracking().Include(r => r.Decisions).AsQueryable();
            if (Enum.TryParse<RequestState>(state, ignoreCase: true, out var wanted))
                query = query.Where(r => r.State == wanted);

            var all = await query.OrderByDescending(r => r.CreatedAt).ToListAsync(ct);

            // "mine" and "inbox" are both cheap post-filters: at ~80 people the whole
            // table is small, and inbox membership needs route resolution anyway, which
            // is not expressible in SQL.
            var views = all
                .Select(r => Project(r, context, actorId))
                .Where(v => v is not null)
                .Select(v => v!)
                .Where(v => scope switch
                {
                    "mine" => v.Request.SubjectPersonId == actorId,
                    "inbox" => v.Request.State == RequestState.Submitted && v.CallerCanDecide,
                    _ => true,
                })
                .ToList();

            return Results.Ok(new RequestListResponse(views));
        })
        .WithName("ListRequests")
        .Produces<RequestListResponse>()
        .RequireAuthorization(AuthPolicies.Authenticated);

        app.MapPost("/api/requests", async (
            CreateRequestRequest req, ClaimsPrincipal user, ActorResolver actors,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var actorId = await actors.RequireAsync(user, ct);
            var subjectId = req.SubjectPersonId ?? actorId;

            var type = await db.RequestTypes.FirstOrDefaultAsync(t => t.Id == req.TypeId, ct);
            if (type is null) return Results.BadRequest(new ErrorResponse("REQUEST_TYPE_NOT_FOUND", req.TypeId));

            var subject = await db.People.AsNoTracking().FirstOrDefaultAsync(p => p.Id == subjectId, ct);
            if (subject is null) return Results.BadRequest(new ErrorResponse("PERSON_NOT_FOUND", subjectId));

            // Raising one on somebody else's behalf is a planner's job in their own unit.
            // Note it is still a *request*: a planner does not get to skip the approval,
            // because needing one is a property of the thing asked for (ADR-0051).
            if (!user.CanWriteRecordOf(actorId, subjectId, subject.UnitId))
            {
                return Results.Json(
                    new ErrorResponse("NOT_YOUR_REQUEST", "You can only raise requests about yourself."),
                    statusCode: StatusCodes.Status403Forbidden);
            }

            // A comp-day placement is checked before it is raised, not on approval: the
            // approver is being asked "is this a good day for the team", not "is this date
            // legal", and putting an illegal one in their inbox wastes the decision
            // (ADR-0052). The same rules drive what the client offers.
            if (type.Materializer == Domain.RequestMaterializer.CompDay)
            {
                var refusal = await CheckCompDayPlacementAsync(req, subject, db, ct);
                if (refusal is not null) return refusal;
            }

            var now = DateTimeOffset.UtcNow;

            // At most one live proposal per comp day (ADR-0056). Without this, asking for
            // the 12th and then, having changed your mind, the 19th, left both requests
            // Submitted — and if the first one was decided later by mistake, it placed the
            // day back on the 12th, silently undoing the second decision. Superseding is
            // the same operation `RangeSupersede` performs for a day of leave: the newer
            // record replaces the older, rather than the two coexisting.
            var supersededRequests = new List<Request>();
            if (type.Materializer == Domain.RequestMaterializer.CompDay && req.CompDayId is not null)
            {
                supersededRequests = await db.Requests
                    .Where(r => r.SubjectPersonId == subjectId && r.State == RequestState.Submitted)
                    .ToListAsync(ct);
                var compDayTypeIds = await db.RequestTypes
                    .Where(t => t.Materializer == Domain.RequestMaterializer.CompDay)
                    .Select(t => t.Id)
                    .ToListAsync(ct);
                supersededRequests = supersededRequests
                    .Where(r => compDayTypeIds.Contains(r.TypeId)
                        && Requests.RequestPayload.Read(r.PayloadJson).CompDayId == req.CompDayId)
                    .ToList();
                foreach (var old in supersededRequests) RequestService.Supersede(old, now);
            }
            Request request;
            try
            {
                request = RequestService.Open(
                    type, subject, req.From, req.To,
                    new RequestPayload(req.SiteLocationId, req.SiteLabel, req.CompDayId).Write(),
                    req.Note, actorId, now, req.Portion);
            }
            catch (RequestService.RequestDomainException ex)
            {
                return Results.BadRequest(new ErrorResponse(ex.Code, ex.Message));
            }

            db.Requests.Add(request);

            if (supersededRequests.Count > 0)
            {
                await db.NotifyAsync([subjectId], NotificationKind.RequestSuperseded,
                    $"Replaced: {type.Label}",
                    $"Your earlier request for {(supersededRequests.Count == 1 ? supersededRequests[0].From.ToString("yyyy-MM-dd") : "a different day")} "
                    + $"was replaced by this one, for {req.From:yyyy-MM-dd}.",
                    "request", request.Id, now, ct);
            }

            var context = await LoadContextAsync(db, ct);
            var approvers = context.ApproversFor(request);

            await db.NotifyAsync(approvers, NotificationKind.RequestSubmitted,
                $"{subject.DisplayName}: {type.Label}",
                $"{req.From:yyyy-MM-dd} – {req.To:yyyy-MM-dd}",
                "request", request.Id, now, ct);

            // A request nobody can act on would sit in Submitted forever with no inbox
            // showing it. Unit approvers, then admins as a last resort, normally prevent
            // that (ADR-0051); with neither configured, refuse rather than accept
            // something that cannot move.
            if (approvers.Count == 0)
            {
                return Results.BadRequest(new ErrorResponse("NO_APPROVER",
                    $"Nobody can approve {type.Label}: {subject.UnitId} has no approvers and there are no admins."));
            }

            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/requests/{request.Id}", request);
        })
        .WithName("CreateRequest")
        .Produces<Request>(StatusCodes.Status201Created)
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden)
        .RequireAuthorization(AuthPolicies.Authenticated);

        app.MapPost("/api/requests/{id}/decide", async (
            string id, DecideRequestRequest req, ClaimsPrincipal user, ActorResolver actors,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var request = await db.Requests.Include(r => r.Decisions).FirstOrDefaultAsync(r => r.Id == id, ct);
            if (request is null) return Results.NotFound(new NotFoundResponse("REQUEST_NOT_FOUND", id));

            var actorId = await actors.RequireAsync(user, ct);
            var context = await LoadContextAsync(db, ct);
            var type = context.TypeFor(request);
            var subject = context.People.FirstOrDefault(p => p.Id == request.SubjectPersonId);

            if (type is null || subject is null)
                return Results.BadRequest(new ErrorResponse("REQUEST_MISCONFIGURED", "This request's type or subject no longer exists."));

            // State first, approver second: a request that has already been decided is
            // not waiting on anyone, so the approver check would report "not you" — which
            // is true but useless, and hides the actual reason.
            if (request.State != RequestState.Submitted)
            {
                return Results.BadRequest(new ErrorResponse("REQUEST_NOT_PENDING",
                    $"This request is {request.State}, not awaiting a decision."));
            }

            if (!context.ApproversFor(request).Contains(actorId))
            {
                return Results.Json(
                    new ErrorResponse("NOT_AN_APPROVER", "This request is not waiting on you."),
                    statusCode: StatusCodes.Status403Forbidden);
            }

            var now = DateTimeOffset.UtcNow;
            RequestService.DecisionOutcome outcome;
            try
            {
                outcome = RequestService.Decide(request, req.Decision, actorId, req.Comment, now);
            }
            catch (RequestService.RequestDomainException ex)
            {
                return Results.BadRequest(new ErrorResponse(ex.Code, ex.Message));
            }

            if (outcome.IsFinalApproval)
            {
                var applied = ApprovedRequestApplier.Apply(db, request, type, actorId, now);
                RequestService.RecordApplication(request, applied.EntityId, applied.FailureReason, now);

                if (applied.FailureReason is not null)
                {
                    // The approver's decision stands; only the write failed. Both of them
                    // need to know, because neither can infer it from the other's screen.
                    await db.NotifyAsync([request.SubjectPersonId, actorId], NotificationKind.RequestApplyFailed,
                        "Approved, but could not be applied", applied.FailureReason, "request", request.Id, now, ct);
                }
                else
                {
                    await db.NotifyAsync([request.SubjectPersonId], NotificationKind.RequestApproved,
                        $"Approved: {type.Label}",
                        $"{request.From:yyyy-MM-dd} – {request.To:yyyy-MM-dd}", "request", request.Id, now, ct);
                }
            }
            else if (request.State == RequestState.Rejected)
            {
                await db.NotifyAsync([request.SubjectPersonId], NotificationKind.RequestRejected,
                    $"Declined: {type.Label}", req.Comment, "request", request.Id, now, ct);
            }

            await db.SaveChangesAsync(ct);
            return Results.Ok(request);
        })
        .WithName("DecideRequest")
        .Produces<Request>()
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden)
        .Produces<NotFoundResponse>(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.Authenticated);

        app.MapPost("/api/requests/{id}/cancel", async (
            string id, ClaimsPrincipal user, ActorResolver actors, ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var request = await db.Requests.Include(r => r.Decisions).FirstOrDefaultAsync(r => r.Id == id, ct);
            if (request is null) return Results.NotFound(new NotFoundResponse("REQUEST_NOT_FOUND", id));

            var actorId = await actors.RequireAsync(user, ct);
            if (!user.CanWriteRecordOf(actorId, request.SubjectPersonId, request.UnitId))
            {
                return Results.Json(
                    new ErrorResponse("NOT_YOUR_REQUEST", "Only the requester or a planner can withdraw this."),
                    statusCode: StatusCodes.Status403Forbidden);
            }

            var now = DateTimeOffset.UtcNow;
            var wasApplied = request.State == RequestState.Applied;
            try
            {
                RequestService.Cancel(request, now);
            }
            catch (RequestService.RequestDomainException ex)
            {
                return Results.BadRequest(new ErrorResponse(ex.Code, ex.Message));
            }

            // Withdrawing something that already took effect has to undo it, or the
            // roster keeps showing leave the person cancelled.
            if (wasApplied && request.MaterializedEntityId is not null)
            {
                var presence = await db.Presence.FirstOrDefaultAsync(p => p.Id == request.MaterializedEntityId, ct);
                if (presence is not null)
                {
                    db.Presence.Remove(presence);
                    db.RecordPresence(HistoryAction.Deleted, presence, actorId, snapshot: false);
                }

                var absence = await db.Absences.FirstOrDefaultAsync(a => a.Id == request.MaterializedEntityId, ct);
                if (absence is not null)
                {
                    db.Absences.Remove(absence);
                    db.ChangeHistory.Add(new ChangeHistoryEntry
                    {
                        Id = Guid.NewGuid().ToString("n"),
                        EntityType = HistoryEntityType.Absence,
                        EntityId = absence.Id,
                        PersonId = absence.PersonId,
                        Action = HistoryAction.Deleted,
                        AffectedFrom = absence.From,
                        AffectedTo = absence.To,
                        Summary = $"Withdrawn request {request.Id}",
                        ActorId = actorId,
                        At = now,
                    });
                }
            }

            await db.SaveChangesAsync(ct);
            return Results.Ok(request);
        })
        .WithName("CancelRequest")
        .Produces<Request>()
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden)
        .Produces<NotFoundResponse>(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.Authenticated);

        MapNotifications(app);
    }

    private static void MapNotifications(WebApplication app)
    {
        app.MapGet("/api/notifications", async (
            bool? unreadOnly, ClaimsPrincipal user, ActorResolver actors,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var actorId = await actors.RequireAsync(user, ct);
            var query = db.Notifications.AsNoTracking().Where(n => n.RecipientPersonId == actorId);
            if (unreadOnly == true) query = query.Where(n => n.ReadAt == null);

            var items = await query.OrderByDescending(n => n.CreatedAt).Take(100).ToListAsync(ct);
            var unread = await db.Notifications
                .CountAsync(n => n.RecipientPersonId == actorId && n.ReadAt == null, ct);

            return Results.Ok(new NotificationListResponse(items, unread));
        })
        .WithName("ListNotifications")
        .Produces<NotificationListResponse>()
        .RequireAuthorization(AuthPolicies.Authenticated);

        app.MapPost("/api/notifications/read", async (
            ClaimsPrincipal user, ActorResolver actors, ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var actorId = await actors.RequireAsync(user, ct);
            var now = DateTimeOffset.UtcNow;
            var unread = await db.Notifications
                .Where(n => n.RecipientPersonId == actorId && n.ReadAt == null)
                .ToListAsync(ct);
            foreach (var item in unread) item.ReadAt = now;

            await db.SaveChangesAsync(ct);
            return Results.Ok(new { markedRead = unread.Count });
        })
        .WithName("MarkNotificationsRead")
        .RequireAuthorization(AuthPolicies.Authenticated);
    }

    /// <summary>
    /// Whether this engineer may take this comp day on this date.
    ///
    /// The rules themselves live in <see cref="CompDayPlacement"/> so the client can ask
    /// the same question about the dates it offers; this only assembles the inputs.
    /// </summary>
    private static async Task<IResult?> CheckCompDayPlacementAsync(
        CreateRequestRequest req, Person subject, ShiftOMatorDbContext db, CancellationToken ct)
    {
        if (req.CompDayId is null)
        {
            return Results.BadRequest(new ErrorResponse("COMP_DAY_REQUIRED",
                "A comp-day request has to name which earned day it is placing."));
        }

        var entry = await db.CompDayEntries.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == req.CompDayId, ct);
        if (entry is null)
            return Results.BadRequest(new ErrorResponse("COMP_DAY_NOT_FOUND", req.CompDayId));

        if (entry.PersonId != subject.Id)
        {
            return Results.Json(
                new ErrorResponse("NOT_YOUR_COMP_DAY", "That comp day belongs to somebody else."),
                statusCode: StatusCodes.Status403Forbidden);
        }

        var unit = await db.PlanningUnits.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == subject.UnitId, ct);
        if (unit is null)
            return Results.BadRequest(new ErrorResponse("UNIT_NOT_FOUND", subject.UnitId));

        // Days the person is already not working: another absence, or a comp day already
        // placed. A day off on a day off returns nothing.
        var taken = await db.Absences.AsNoTracking()
            .Where(a => a.PersonId == subject.Id && a.From <= req.From && a.To >= req.From)
            .Select(a => a.From)
            .ToListAsync(ct);

        var refusal = CompDayPlacement.Check(entry, req.From, unit.CompOffPolicy, [.. taken]);
        return refusal is null
            ? null
            : Results.BadRequest(new ErrorResponse(refusal.Code, refusal.Message));
    }

    /// <summary>Everything approver resolution needs, read once per request.</summary>
    private sealed record Context(
        List<Person> People,
        List<RequestType> Types,
        List<RoleAssignment> Roles,
        List<PlanningUnit> Units)
    {
        public RequestType? TypeFor(Request request) => Types.FirstOrDefault(t => t.Id == request.TypeId);

        public IReadOnlyList<string> ApproversFor(Request request) =>
            RequestService.ApproversFor(request, Roles, People);
    }

    private static async Task<Context> LoadContextAsync(ShiftOMatorDbContext db, CancellationToken ct) =>
        new(
            await db.People.AsNoTracking().ToListAsync(ct),
            await db.RequestTypes.AsNoTracking().ToListAsync(ct),
            await db.RoleAssignments.AsNoTracking().ToListAsync(ct),
            await db.PlanningUnits.AsNoTracking().ToListAsync(ct));

    private static RequestView? Project(Request request, Context context, string actorId)
    {
        var type = context.TypeFor(request);
        var subject = context.People.FirstOrDefault(p => p.Id == request.SubjectPersonId);
        if (type is null || subject is null) return null;

        var approvers = context.ApproversFor(request);

        return new RequestView(
            request, type.Code, type.Label, subject.DisplayName,
            approvers, approvers.Contains(actorId));
    }
}
