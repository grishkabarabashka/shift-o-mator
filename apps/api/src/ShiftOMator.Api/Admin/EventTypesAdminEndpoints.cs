using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>
/// Kinds of non-working day — their colour, their behaviour, and whether they need
/// approving (ADR-0049).
///
/// WHY this is CRUD and not a code change: the whole point of event types being data is
/// that adding "sabbatical" is a row. Until this screen existed that row went in the seed
/// or the database by hand, which made the claim untrue in practice.
///
/// **Retiring is `IsActive = false`, not DELETE.** Absences point at these by id, and
/// deleting one would leave rows describing a kind of leave nobody can name. The seeded
/// set is also topped up on every start, so a deleted seeded type reappears on the next
/// boot — deactivating is the only thing that sticks.
/// </summary>
public static class EventTypesAdminEndpoints
{
    public static void MapEventTypesAdminEndpoints(this WebApplication app)
    {
        // Kinds of leave are not a unit's business — they are the same everywhere, like
        // locations and holidays — so this needs a global grant (ADR-0051).
        var group = app.MapGroup("/api/admin/event-types")
            .RequireAuthorization(AuthPolicies.AdminSomewhere);

        group.MapGet("/", async (ScheduleDbContext db, CancellationToken ct) =>
            Results.Ok(await db.EventTypes.AsNoTracking().OrderBy(t => t.SortOrder).ToListAsync(ct)))
            .Produces<IReadOnlyList<EventType>>();

        group.MapPost("/", async (
            EventTypeRequest req, ClaimsPrincipal user, ActorResolver actors,
            ScheduleDbContext db, CancellationToken ct) =>
        {
            if (!user.CanAdministerGlobally()) return GlobalOnly();
            if (Validate(req).ToBadRequestOrNull() is { } bad) return bad;

            if (await db.EventTypes.AnyAsync(t => t.Code == req.Code, ct))
            {
                return Results.BadRequest(new ErrorResponse("EVENT_TYPE_CODE_TAKEN",
                    $"An event type with code {req.Code} already exists."));
            }

            var type = new EventType
            {
                Id = $"et-{Guid.NewGuid():N}",
                Code = req.Code,
                Label = req.Label,
                ShortLabel = req.ShortLabel,
                Color = req.Color,
            };
            Apply(req, type);
            db.EventTypes.Add(type);
            db.RecordConfiguration(HistoryAction.Created, type.Id, $"Leave type {type.Label}", type,
                await actors.RequireAsync(user, ct));
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/admin/event-types/{type.Id}", type);
        })
        .Produces<EventType>(StatusCodes.Status201Created)
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden);

        group.MapPut("/{id}", async (
            string id, EventTypeRequest req, ClaimsPrincipal user, ActorResolver actors,
            ScheduleDbContext db, CancellationToken ct) =>
        {
            if (!user.CanAdministerGlobally()) return GlobalOnly();
            if (Validate(req).ToBadRequestOrNull() is { } bad) return bad;

            var type = await db.EventTypes.FirstOrDefaultAsync(t => t.Id == id, ct);
            if (type is null) return AdminValidation.NotFound("event type", id);

            Apply(req, type);
            // ADR-0040: every write leaves a history row. This screen had none, so "who
            // made sick leave stop needing approval" had no answer at all.
            db.RecordConfiguration(HistoryAction.Updated, type.Id, $"Leave type {type.Label}", type,
                await actors.RequireAsync(user, ct));
            await db.SaveChangesAsync(ct);
            return Results.Ok(type);
        })
        .Produces<EventType>()
        .Produces(StatusCodes.Status404NotFound)
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden);

        // No DELETE on purpose — see the class remarks.
    }

    private static void Apply(EventTypeRequest req, EventType type)
    {
        type.Code = req.Code;
        type.Label = req.Label;
        type.ShortLabel = req.ShortLabel;
        type.Color = req.Color;
        type.Category = req.Category;
        type.BlocksAssignment = req.BlocksAssignment;
        type.CountsTowardCapacity = req.CountsTowardCapacity;
        type.RequiresApproval = req.RequiresApproval;
        type.AllowsHalfDay = req.AllowsHalfDay;
        type.IsActive = req.IsActive;
        type.SortOrder = req.SortOrder;
    }

    private static AdminValidation Validate(EventTypeRequest req) =>
        new AdminValidation()
            .Require(nameof(req.Code), req.Code)
            .Require(nameof(req.Label), req.Label)
            // The short label is what a 62px cell shows; without one the cell is blank.
            .Require(nameof(req.ShortLabel), req.ShortLabel)
            .Require(nameof(req.Color), req.Color);

    private static IResult GlobalOnly() =>
        Results.Json(
            new ErrorResponse("GLOBAL_ADMIN_REQUIRED",
                "Kinds of leave are the same in every unit, so changing them needs a global administrator."),
            statusCode: StatusCodes.Status403Forbidden);
}

/// <summary>Everything about an event type that an admin decides. `Id` is not here: it is
/// the route for an update and generated for a create.</summary>
public record EventTypeRequest(
    string Code,
    string Label,
    string ShortLabel,
    string Color,
    EventCategory Category,
    bool BlocksAssignment,
    bool CountsTowardCapacity,
    bool RequiresApproval,
    bool AllowsHalfDay,
    bool IsActive,
    int SortOrder);
