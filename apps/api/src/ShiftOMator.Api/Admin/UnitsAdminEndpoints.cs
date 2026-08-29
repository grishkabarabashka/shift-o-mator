using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Admin;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>
/// Planning unit: the single rule axis since Phase 8 deleted Region (it duplicated
/// PlanningUnit for 65 of 76 people; Service Transition was the only real second axis,
/// and it is now just another unit). Carries what Region used to own — name, primary
/// location, member locations, comp-off policy — alongside Kind/GroupBy, which were
/// always PlanningUnit's. No create/delete for the structural fields shifts, day
/// configurations and absence-capacity rules touch separately (their own admin
/// endpoints); creating or deleting a *unit* itself is still supported since units are
/// not FK-anchored the way AMER/EMEA/APAC's old regions were.
/// </summary>
public static class UnitsAdminEndpoints
{
    public static void MapUnitsAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/units").RequireAuthorization(AuthPolicies.AdminSomewhere);

        group.MapGet("/", async (ScheduleDbContext db, CancellationToken ct) =>
            Results.Ok(await db.PlanningUnits.AsNoTracking().OrderBy(u => u.Id).ToListAsync(ct)))
            .Produces<IReadOnlyList<PlanningUnit>>();

        group.MapPost("/", async (UnitRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var unit = new PlanningUnit
            {
                Id = $"unit-{Guid.NewGuid():N}",
                Name = req.Name,
                Kind = req.Kind,
                GroupBy = req.GroupBy,
                PrimaryLocationId = req.PrimaryLocationId,
                LocationIds = req.LocationIds,
                CompOffPolicy = ToCompOffPolicy(req.CompOffPolicy),
            };
            db.PlanningUnits.Add(unit);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/admin/units/{unit.Id}", unit);
        })
        .Produces<PlanningUnit>(StatusCodes.Status201Created)
        .Produces<ValidationErrorResponse>(StatusCodes.Status400BadRequest);

        group.MapPut("/{id}", async (string id, UnitRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var unit = await db.PlanningUnits.FirstOrDefaultAsync(u => u.Id == id, ct);
            if (unit is null) return AdminValidation.NotFound("unit", id);

            unit.Name = req.Name;
            unit.Kind = req.Kind;
            unit.GroupBy = req.GroupBy;
            unit.PrimaryLocationId = req.PrimaryLocationId;
            unit.LocationIds = req.LocationIds;
            unit.CompOffPolicy = ToCompOffPolicy(req.CompOffPolicy);
            await db.SaveChangesAsync(ct);
            return Results.Ok(unit);
        })
        .Produces<PlanningUnit>()
        .Produces(StatusCodes.Status404NotFound)
        .Produces<ValidationErrorResponse>(StatusCodes.Status400BadRequest);

        group.MapDelete("/{id}", async (string id, ScheduleDbContext db, CancellationToken ct) =>
        {
            if (id == "ALL_UNITS") return AdminValidation.Conflict("UNIT_PROTECTED", "ALL_UNITS is the required default and cannot be deleted.");

            var unit = await db.PlanningUnits.FirstOrDefaultAsync(u => u.Id == id, ct);
            if (unit is null) return AdminValidation.NotFound("unit", id);

            var inUse = await db.People.AnyAsync(p => p.UnitId == id, ct);
            if (inUse) return AdminValidation.Conflict("UNIT_IN_USE", $"Unit {id} still has people assigned.");

            db.PlanningUnits.Remove(unit);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        })
        .Produces(StatusCodes.Status204NoContent)
        .Produces(StatusCodes.Status404NotFound)
        .Produces(StatusCodes.Status409Conflict);
    }

    private static CompOffPolicy ToCompOffPolicy(CompOffPolicyRequest req) => new()
    {
        WindowBeforeDays = req.WindowBeforeDays,
        WindowAfterDays = req.WindowAfterDays,
        ExcludedWeekdays = req.ExcludedWeekdays,
        AgingThresholdDays = req.AgingThresholdDays,
        RequiresApprovalWhenNoSlot = req.RequiresApprovalWhenNoSlot,
    };

    private static async Task<AdminValidation> ValidateAsync(UnitRequest req, ScheduleDbContext db, CancellationToken ct)
    {
        var v = new AdminValidation();
        v.Require(nameof(req.Name), req.Name);
        v.Require(nameof(req.PrimaryLocationId), req.PrimaryLocationId);
        if (!string.IsNullOrWhiteSpace(req.PrimaryLocationId)
            && !await db.Locations.AnyAsync(l => l.Id == req.PrimaryLocationId, ct))
            v.Add(nameof(req.PrimaryLocationId), $"Location {req.PrimaryLocationId} does not exist.");
        v.Check(nameof(req.LocationIds), req.LocationIds.Contains(req.PrimaryLocationId ?? ""),
            "must include the primary location.");
        v.Check($"{nameof(req.CompOffPolicy)}.{nameof(req.CompOffPolicy.WindowBeforeDays)}",
            req.CompOffPolicy.WindowBeforeDays >= 0, "must be zero or greater.");
        v.Check($"{nameof(req.CompOffPolicy)}.{nameof(req.CompOffPolicy.WindowAfterDays)}",
            req.CompOffPolicy.WindowAfterDays >= 0, "must be zero or greater.");
        return v;
    }
}
