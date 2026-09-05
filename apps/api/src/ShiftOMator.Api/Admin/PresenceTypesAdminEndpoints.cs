using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>
/// Ways of working — what they are called, what colour they draw, whether they are
/// offered, and whether recording one needs approving (ADR-0043, ADR-0054).
///
/// The set is open. It was closed, because <c>PresenceKind</c> was an enum two branches
/// depended on; those branches are now the <see cref="PresenceType.NamesALocation"/> and
/// <see cref="PresenceType.CountsAs"/> columns, and "standby", "conference" or "a
/// customer's office" are exactly the sort of thing a team invents without asking anybody
/// here.
///
/// <b>Deleting is refused once anything points at the type.</b> Not out of caution: a
/// presence record names its type and nothing else, so removing the row would leave days
/// on the grid describing a way of working nobody can name. Retiring is
/// <c>IsActive = false</c>, which drops it from the cell menu and leaves history intact.
///
/// A type that <see cref="PresenceType.RequiresApproval"/> owns a matching
/// <see cref="RequestType"/>, created and retired with it. Without that, ticking the box
/// on a new type would produce a menu item with nowhere to send the request — a dead end
/// an administrator could reach in two clicks and diagnose in none.
/// </summary>
public static class PresenceTypesAdminEndpoints
{
    public static void MapPresenceTypesAdminEndpoints(this WebApplication app)
    {
        // Where people work means the same thing in every unit, like locations and kinds
        // of leave, so changing it needs a global grant (ADR-0051).
        var group = app.MapGroup("/api/admin/presence-types")
            .RequireAuthorization(AuthPolicies.AdminSomewhere);

        group.MapGet("/", async (ShiftOMatorDbContext db, CancellationToken ct) =>
            Results.Ok(await db.PresenceTypes.AsNoTracking().OrderBy(t => t.SortOrder).ToListAsync(ct)))
            .Produces<IReadOnlyList<PresenceType>>();

        group.MapPost("/", async (
            PresenceTypeRequest req, ClaimsPrincipal user, ActorResolver actors,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            if (!user.CanAdministerGlobally()) return GlobalOnly();
            if (Validate(req).ToBadRequestOrNull() is { } bad) return bad;

            var type = new PresenceType
            {
                Id = $"pt-{Guid.NewGuid():N}",
                Label = req.Label,
                Glyph = req.Glyph,
                Color = req.Color,
            };
            Apply(req, type);
            db.PresenceTypes.Add(type);
            await SyncRequestTypeAsync(db, type, ct);

            db.RecordConfiguration(HistoryAction.Created, type.Id,
                $"Way of working {type.Label}", type, await actors.RequireAsync(user, ct));
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/admin/presence-types/{type.Id}", type);
        })
        .Produces<PresenceType>(StatusCodes.Status201Created)
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden);

        group.MapPut("/{id}", async (
            string id, PresenceTypeRequest req, ClaimsPrincipal user, ActorResolver actors,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            if (!user.CanAdministerGlobally()) return GlobalOnly();
            if (Validate(req).ToBadRequestOrNull() is { } bad) return bad;

            var type = await db.PresenceTypes.FirstOrDefaultAsync(t => t.Id == id, ct);
            if (type is null) return AdminValidation.NotFound("presence type", id);

            Apply(req, type);
            await SyncRequestTypeAsync(db, type, ct);

            db.RecordConfiguration(HistoryAction.Updated, type.Id,
                $"Way of working {type.Label}", type, await actors.RequireAsync(user, ct));
            await db.SaveChangesAsync(ct);
            return Results.Ok(type);
        })
        .Produces<PresenceType>()
        .Produces(StatusCodes.Status404NotFound)
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden);

        group.MapDelete("/{id}", async (
            string id, ClaimsPrincipal user, ActorResolver actors,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            if (!user.CanAdministerGlobally()) return GlobalOnly();

            var type = await db.PresenceTypes.FirstOrDefaultAsync(t => t.Id == id, ct);
            if (type is null) return AdminValidation.NotFound("presence type", id);

            // The rule that makes retiring the ordinary answer: a presence record names
            // its type and carries nothing else, so a deleted row leaves days on the grid
            // describing something nobody can name. People also default to one.
            var used = await db.Presence.AsNoTracking().AnyAsync(p => p.TypeId == id, ct)
                || await db.People.AsNoTracking().AnyAsync(p => p.DefaultPresenceTypeId == id, ct);
            if (used)
            {
                return Results.BadRequest(new ErrorResponse("PRESENCE_TYPE_IN_USE",
                    $"{type.Label} is recorded against days or people. Untick Offered to retire "
                    + "it instead — that hides it from the menu and leaves the history readable."));
            }

            db.PresenceTypes.Remove(type);
            var owned = await db.RequestTypes.FirstOrDefaultAsync(r => r.PresenceTypeId == id, ct);
            if (owned is not null) db.RequestTypes.Remove(owned);

            db.RecordConfiguration(HistoryAction.Deleted, type.Id,
                $"Way of working {type.Label}", null, await actors.RequireAsync(user, ct));
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        })
        .Produces(StatusCodes.Status204NoContent)
        .Produces(StatusCodes.Status404NotFound)
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden);
    }

    private static void Apply(PresenceTypeRequest req, PresenceType type)
    {
        type.Label = req.Label;
        type.Glyph = req.Glyph;
        type.Color = req.Color;
        type.NamesALocation = req.NamesALocation;
        type.CountsAs = req.CountsAs;
        type.RequiresApproval = req.RequiresApproval;
        type.IsActive = req.IsActive;
        type.SortOrder = req.SortOrder;
    }

    /// <summary>
    /// Keeps the request type that carries this way of working in step with it.
    ///
    /// A type that needs approving has to have somewhere to send the request. Ticking the
    /// box otherwise produces a menu item that silently does nothing, which is the failure
    /// this whole area keeps producing when a flag and its plumbing are edited separately.
    /// </summary>
    private static async Task SyncRequestTypeAsync(ShiftOMatorDbContext db, PresenceType type, CancellationToken ct)
    {
        var existing = await db.RequestTypes.FirstOrDefaultAsync(r => r.PresenceTypeId == type.Id, ct);

        if (!type.RequiresApproval || !type.IsActive)
        {
            // Left in place rather than deleted: requests already raised through it still
            // name it, and a request nobody can label is worse than a spare row.
            if (existing is not null) existing.IsActive = false;
            return;
        }

        if (existing is null)
        {
            db.RequestTypes.Add(new RequestType
            {
                Id = $"rt-presence-{type.Id}",
                Code = type.Id.ToUpperInvariant(),
                Label = type.Label,
                Category = RequestCategory.Presence,
                Materializer = RequestMaterializer.Presence,
                PresenceTypeId = type.Id,
                SortOrder = type.SortOrder,
            });
            return;
        }

        existing.Label = type.Label;
        existing.SortOrder = type.SortOrder;
        existing.IsActive = true;
    }

    private static AdminValidation Validate(PresenceTypeRequest req) =>
        new AdminValidation()
            .Require(nameof(req.Label), req.Label)
            // The band is 9px wide. Two characters is what fits; more is drawn clipped,
            // which reads as a rendering fault rather than as a long name.
            .Require(nameof(req.Glyph), req.Glyph)
            .Check(nameof(req.Glyph), req.Glyph?.Length is > 0 and <= 2, "must be one or two characters.")
            .Require(nameof(req.Color), req.Color);

    private static IResult GlobalOnly() =>
        Results.Json(
            new ErrorResponse("GLOBAL_ADMIN_REQUIRED",
                "Where people work means the same thing in every unit, so changing it needs a global administrator."),
            statusCode: StatusCodes.Status403Forbidden);
}

/// <summary>Everything about a way of working that an administrator decides. `Id` is not
/// here: it is the route for an update and generated for a create.</summary>
public record PresenceTypeRequest(
    string Label,
    string Glyph,
    string Color,
    bool NamesALocation,
    PresenceGroup CountsAs,
    bool RequiresApproval,
    bool IsActive,
    int SortOrder);
