using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>Planning unit: whose screen, orthogonal to Region — a default filter, not a
/// write boundary (ADR-0020/0025). Fully in-place.</summary>
public static class UnitsAdminEndpoints
{
    public record UnitRequest(string Name, UnitKind Kind, string? RegionId, GroupBy GroupBy);

    public static void MapUnitsAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/units").RequireAuthorization(AuthPolicies.AdminOnly);

        group.MapGet("/", async (ScheduleDbContext db, CancellationToken ct) =>
            Results.Ok(await db.PlanningUnits.AsNoTracking().OrderBy(u => u.Id).ToListAsync(ct)));

        group.MapPost("/", async (UnitRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var unit = new PlanningUnit
            {
                Id = $"unit-{Guid.NewGuid():N}",
                Name = req.Name,
                Kind = req.Kind,
                RegionId = req.Kind == UnitKind.Region ? req.RegionId : null,
                GroupBy = req.GroupBy,
            };
            db.PlanningUnits.Add(unit);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/admin/units/{unit.Id}", unit);
        });

        group.MapPut("/{id}", async (string id, UnitRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var unit = await db.PlanningUnits.FirstOrDefaultAsync(u => u.Id == id, ct);
            if (unit is null) return AdminValidation.NotFound("unit", id);

            unit.Name = req.Name;
            unit.Kind = req.Kind;
            unit.RegionId = req.Kind == UnitKind.Region ? req.RegionId : null;
            unit.GroupBy = req.GroupBy;
            await db.SaveChangesAsync(ct);
            return Results.Ok(unit);
        });

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
        });
    }

    private static async Task<AdminValidation> ValidateAsync(UnitRequest req, ScheduleDbContext db, CancellationToken ct)
    {
        var v = new AdminValidation();
        v.Require(nameof(req.Name), req.Name);
        if (req.Kind == UnitKind.Region)
        {
            v.Require(nameof(req.RegionId), req.RegionId);
            if (!string.IsNullOrWhiteSpace(req.RegionId) && !await db.Regions.AnyAsync(r => r.Id == req.RegionId, ct))
                v.Add(nameof(req.RegionId), $"Region {req.RegionId} does not exist.");
        }
        return v;
    }
}
