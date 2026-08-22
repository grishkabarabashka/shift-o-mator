using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>
/// ShiftRole: belongs to a region, carries its own fixed-timezone window (ADR-0004,
/// ADR-0001). See the scope note on <c>ShiftsAdminEndpoints</c> — edited in-place for
/// the same reason (no resolver exists yet for role time versions). Color/label/hotkey
/// were always meant to be unversioned per CLAUDE.md point 14; the time-window fields
/// ride along in the same in-place PUT as a documented scope reduction, not a design
/// endorsement of retroactively repainting role timing.
/// </summary>
public static class RolesAdminEndpoints
{
    public record RoleRequest(
        string RegionId, string Code, string Label, string? Description, string Color, string? Hotkey,
        string TimeZone, TimeOnly Start, TimeOnly End, bool CrossesMidnight, int BreakMinutes,
        bool CountsAsCoverage, bool EditableTime);

    public static void MapRolesAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/roles").RequireAuthorization(AuthPolicies.AdminOnly);

        group.MapGet("/", async (ScheduleDbContext db, CancellationToken ct) =>
            Results.Ok(await db.Roles.AsNoTracking().OrderBy(r => r.Id).ToListAsync(ct)));

        group.MapGet("/{id}", async (string id, ScheduleDbContext db, CancellationToken ct) =>
        {
            var role = await db.Roles.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id, ct);
            return role is null ? AdminValidation.NotFound("role", id) : Results.Ok(role);
        });

        group.MapPost("/", async (RoleRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var role = new ShiftRole
            {
                Id = $"{req.RegionId}:{req.Code}",
                RegionId = req.RegionId,
                Code = req.Code,
                Label = req.Label,
                Description = req.Description,
                Color = req.Color,
                Hotkey = req.Hotkey,
                TimeZone = req.TimeZone,
                Start = req.Start,
                End = req.End,
                CrossesMidnight = req.CrossesMidnight,
                BreakMinutes = req.BreakMinutes,
                CountsAsCoverage = req.CountsAsCoverage,
                EditableTime = req.EditableTime,
            };
            if (await db.Roles.AnyAsync(r => r.Id == role.Id, ct))
            {
                validation.Add(nameof(req.Code), $"Role {role.Id} already exists in this region.");
                return validation.ToBadRequestOrNull()!;
            }

            db.Roles.Add(role);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/admin/roles/{role.Id}", role);
        });

        group.MapPut("/{id}", async (string id, RoleRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var role = await db.Roles.FirstOrDefaultAsync(r => r.Id == id, ct);
            if (role is null) return AdminValidation.NotFound("role", id);

            role.RegionId = req.RegionId;
            role.Code = req.Code;
            role.Label = req.Label;
            role.Description = req.Description;
            role.Color = req.Color;
            role.Hotkey = req.Hotkey;
            role.TimeZone = req.TimeZone;
            role.Start = req.Start;
            role.End = req.End;
            role.CrossesMidnight = req.CrossesMidnight;
            role.BreakMinutes = req.BreakMinutes;
            role.CountsAsCoverage = req.CountsAsCoverage;
            role.EditableTime = req.EditableTime;
            await db.SaveChangesAsync(ct);
            return Results.Ok(role);
        });

        group.MapDelete("/{id}", async (string id, ScheduleDbContext db, CancellationToken ct) =>
        {
            var role = await db.Roles.FirstOrDefaultAsync(r => r.Id == id, ct);
            if (role is null) return AdminValidation.NotFound("role", id);

            var inUse = await db.Assignments.AnyAsync(a => a.RoleId == id, ct)
                || await db.RoleRequirements.AnyAsync(r => r.RoleId == id, ct)
                || await db.RoleEligibilities.AnyAsync(e => e.RoleId == id, ct);
            if (inUse) return AdminValidation.Conflict("ROLE_IN_USE", $"Role {id} is used by assignments, requirements or eligibility.");

            db.Roles.Remove(role);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    private static async Task<AdminValidation> ValidateAsync(RoleRequest req, ScheduleDbContext db, CancellationToken ct)
    {
        var v = new AdminValidation();
        v.Require(nameof(req.RegionId), req.RegionId);
        v.Require(nameof(req.Code), req.Code);
        v.Require(nameof(req.Label), req.Label);
        v.Require(nameof(req.Color), req.Color);
        v.Require(nameof(req.TimeZone), req.TimeZone);
        v.Check(nameof(req.BreakMinutes), req.BreakMinutes >= 0, "must be zero or greater.");
        if (!string.IsNullOrWhiteSpace(req.RegionId) && !await db.Regions.AnyAsync(r => r.Id == req.RegionId, ct))
            v.Add(nameof(req.RegionId), $"Region {req.RegionId} does not exist.");
        return v;
    }
}
