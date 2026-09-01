using System.Security.Claims;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;
using ShiftOMator.Infrastructure.Setup;

namespace ShiftOMator.Api.Admin;

/// <summary>
/// Settings → Maintenance: the two operations the removed <c>Seed:IncludeDemoData</c> and
/// <c>--reset-db</c>-from-a-values-file used to be (ADR-0059). Both are global-Admin only
/// — configuration belonging to no unit is a global grant's business (ADR-0051) — and
/// both write <see cref="ChangeHistoryEntry"/>, because reaching for either button is
/// exactly the kind of act "who did this and when" should answer.
/// </summary>
public static class MaintenanceAdminEndpoints
{
    public static void MapMaintenanceAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/maintenance").RequireAuthorization(AuthPolicies.AdminSomewhere);

        // Read-only, so it stops at the group's "administers something" policy rather than
        // the global-admin check the two writes below make: the button it feeds is only
        // rendered for a global admin anyway, and a unit admin learning that the system is
        // untouched tells them nothing they could not see by looking at it.
        group.MapGet("/can-load-demo-data", async (ScheduleDbContext db, CancellationToken ct) =>
            Results.Ok(new CanLoadDemoDataResponse(await SetupService.CanLoadDemoDataAsync(db, ct))))
            .WithName("CanLoadDemoData")
            .Produces<CanLoadDemoDataResponse>();

        group.MapPost("/load-demo-data", async (
            ClaimsPrincipal user, ActorResolver actors, ScheduleDbContext db, CancellationToken ct) =>
        {
            if (!user.CanAdministerGlobally())
            {
                return Results.Json(
                    new ErrorResponse("NOT_GLOBAL_ADMIN", "Only a global administrator may load demo data."),
                    statusCode: StatusCodes.Status403Forbidden);
            }

            if (!await SetupService.CanLoadDemoDataAsync(db, ct))
            {
                return Results.Conflict(new ErrorResponse(
                    "SYSTEM_NOT_UNTOUCHED",
                    "Demo data can only be loaded into a Bare system nobody has added people or a rota to yet."));
            }

            var actorId = await actors.RequireAsync(user, ct);
            await SetupService.LoadDemoDataAsync(db, ct);
            db.RecordConfiguration(HistoryAction.Updated, "system-setup", "Demo data loaded", null, actorId);
            await db.SaveChangesAsync(ct);

            return Results.NoContent();
        })
        .Produces(StatusCodes.Status204NoContent)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden)
        .Produces<ErrorResponse>(StatusCodes.Status409Conflict);

        group.MapPost("/reset", async (
            ClaimsPrincipal user, ActorResolver actors, ScheduleDbContext db,
            ILogger<Program> logger, CancellationToken ct) =>
        {
            if (!user.CanAdministerGlobally())
            {
                return Results.Json(
                    new ErrorResponse("NOT_GLOBAL_ADMIN", "Only a global administrator may reset the system."),
                    statusCode: StatusCodes.Status403Forbidden);
            }

            // Logged, not written to ChangeHistoryEntry: reset clears that table itself
            // (ADR-0059) — a row recording "reset happened" would be deleted by the very
            // reset it describes, which is not a record at all.
            var actorId = await actors.RequireAsync(user, ct);
            logger.LogWarning("System reset to empty by {ActorId}.", actorId);

            await SetupService.ResetAsync(db, ct);

            return Results.NoContent();
        })
        .Produces(StatusCodes.Status204NoContent)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden);
    }
}

public record CanLoadDemoDataResponse(bool Available);
