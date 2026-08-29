using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>
/// Who may do what, and where (ADR-0051).
///
/// WHY it is an admin screen rather than identity-provider configuration: the grants are
/// scoped to planning units, which are this product's own concept. Making somebody the
/// approver for EMEA is a decision the team makes on a Tuesday, and routing it through a
/// directory change would mean it never happens.
///
/// Granting is itself scoped: a unit's admin manages that unit's roles. Only a **global**
/// admin can grant a global role, which is the rule that stops a unit admin from quietly
/// promoting themselves out of their unit.
/// </summary>
public static class RoleAssignmentsAdminEndpoints
{
    public static void MapRoleAssignmentsAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/role-assignments")
            .RequireAuthorization(AuthPolicies.AdminSomewhere);

        // WHY reading is open to everybody while writing is not: "who approves my leave"
        // and "who plans my unit" are fair questions for the person waiting on an answer,
        // and there was no way to find out — you could not see who administers anything
        // without already administering something. Mapped outside the group so it does not
        // inherit the admin policy.
        app.MapGet("/api/admin/role-assignments", async (
            string? unitId, ScheduleDbContext db, CancellationToken ct) =>
        {
            var query = db.RoleAssignments.AsNoTracking();
            if (!string.IsNullOrEmpty(unitId)) query = query.Where(r => r.UnitId == unitId);

            return Results.Ok(await query
                .OrderBy(r => r.UnitId).ThenBy(r => r.Role).ThenBy(r => r.PersonId)
                .ToListAsync(ct));
        })
        .WithName("ListRoleAssignments")
        .Produces<IReadOnlyList<RoleAssignment>>()
        .RequireAuthorization(AuthPolicies.Authenticated);

        group.MapPost("/", async (
            GrantRoleRequest req, ClaimsPrincipal user, ActorResolver actors,
            ScheduleDbContext db, CancellationToken ct) =>
        {
            if (!CanManage(user, req.UnitId))
                return Refuse(req.UnitId);

            if (req.Role == AppRole.Viewer)
            {
                return Results.BadRequest(new ErrorResponse("ROLE_NOT_GRANTABLE",
                    "Everyone signed in is a Viewer; there is nothing to grant."));
            }

            if (!await db.People.AsNoTracking().AnyAsync(p => p.Id == req.PersonId, ct))
                return Results.BadRequest(new ErrorResponse("PERSON_NOT_FOUND", req.PersonId));

            if (req.UnitId is not null
                && !await db.PlanningUnits.AsNoTracking().AnyAsync(u => u.Id == req.UnitId, ct))
                return Results.BadRequest(new ErrorResponse("UNIT_NOT_FOUND", req.UnitId));

            var existing = await db.RoleAssignments.FirstOrDefaultAsync(
                r => r.PersonId == req.PersonId && r.UnitId == req.UnitId && r.Role == req.Role, ct);
            if (existing is not null) return Results.Ok(existing);

            var actorId = await actors.RequireAsync(user, ct);
            var grant = new RoleAssignment
            {
                Id = Guid.NewGuid().ToString("n"),
                PersonId = req.PersonId,
                UnitId = req.UnitId,
                Role = req.Role,
                GrantedBy = actorId,
                GrantedAt = DateTimeOffset.UtcNow,
            };

            db.RoleAssignments.Add(grant);
            db.RecordConfiguration(HistoryAction.Created, grant.Id,
                $"Granted {req.Role} in {req.UnitId ?? "all units"} to {req.PersonId}",
                grant, actorId, HistoryEntityType.RoleAssignment);
            await db.SaveChangesAsync(ct);

            return Results.Created($"/api/admin/role-assignments/{grant.Id}", grant);
        })
        .Produces<RoleAssignment>(StatusCodes.Status201Created)
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden);

        group.MapDelete("/{id}", async (
            string id, ClaimsPrincipal user, ActorResolver actors,
            ScheduleDbContext db, CancellationToken ct) =>
        {
            var grant = await db.RoleAssignments.FirstOrDefaultAsync(r => r.Id == id, ct);
            if (grant is null) return Results.NotFound(new NotFoundResponse("ROLE_ASSIGNMENT_NOT_FOUND", id));

            if (!CanManage(user, grant.UnitId)) return Refuse(grant.UnitId);

            // Revoking the last global admin locks everybody out of the configuration that
            // belongs to no unit, and nothing else can grant it back.
            if (grant is { Role: AppRole.Admin, UnitId: null }
                && await db.RoleAssignments.CountAsync(r => r.Role == AppRole.Admin && r.UnitId == null, ct) == 1)
            {
                return Results.BadRequest(new ErrorResponse("LAST_GLOBAL_ADMIN",
                    "This is the only global administrator. Grant another one first."));
            }

            var actorId = await actors.RequireAsync(user, ct);
            db.RoleAssignments.Remove(grant);
            db.RecordConfiguration(HistoryAction.Deleted, grant.Id,
                $"Revoked {grant.Role} in {grant.UnitId ?? "all units"} from {grant.PersonId}",
                grant, actorId, HistoryEntityType.RoleAssignment);
            await db.SaveChangesAsync(ct);

            return Results.NoContent();
        })
        .Produces(StatusCodes.Status204NoContent)
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<NotFoundResponse>(StatusCodes.Status403Forbidden)
        .Produces<NotFoundResponse>(StatusCodes.Status404NotFound);
    }

    /// <summary>A global grant is a global admin's to make; a unit's grants are its own
    /// admin's. Without the first half, any unit admin could grant themselves everything.</summary>
    private static bool CanManage(ClaimsPrincipal user, string? unitId) =>
        unitId is null ? user.CanAdministerGlobally() : user.CanAdminister(unitId);

    private static IResult Refuse(string? unitId) =>
        Results.Json(
            new ErrorResponse("NOT_YOUR_UNIT",
                unitId is null
                    ? "Only a global administrator can grant a role in every unit."
                    : $"You do not administer {unitId}."),
            statusCode: StatusCodes.Status403Forbidden);
}

/// <summary>Granting one role to one person, in one unit or globally.</summary>
public record GrantRoleRequest(string PersonId, string? UnitId, AppRole Role);
