using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>
/// Shift: belongs to a region, carries its own fixed-timezone window (ADR-0004,
/// ADR-0001). See the scope note on <c>DayConfigurationsAdminEndpoints</c> — edited
/// in-place for the same reason (no resolver exists yet for shift time versions).
/// Color/label/hotkey were always meant to be unversioned per CLAUDE.md point 14; the
/// time-window fields ride along in the same in-place PUT as a documented scope
/// reduction, not a design endorsement of retroactively repainting shift timing.
/// </summary>
public static class ShiftsAdminEndpoints
{
    public record ShiftRequest(
        string UnitId, string Code, string Label, string? Description, string Color, string? Hotkey,
        string TimeZone, TimeOnly Start, TimeOnly End, bool CrossesMidnight, int BreakMinutes,
        bool CountsAsCoverage, bool EditableTime);

    public static void MapShiftsAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/shifts").RequireAuthorization(AuthPolicies.AdminOnly);

        group.MapGet("/", async (ScheduleDbContext db, CancellationToken ct) =>
            Results.Ok(await db.Shifts.AsNoTracking().OrderBy(s => s.Id).ToListAsync(ct)));

        group.MapGet("/{id}", async (string id, ScheduleDbContext db, CancellationToken ct) =>
        {
            var shift = await db.Shifts.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, ct);
            return shift is null ? AdminValidation.NotFound("shift", id) : Results.Ok(shift);
        });

        group.MapPost("/", async (ShiftRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var shift = new Shift
            {
                Id = $"{req.UnitId}:{req.Code}",
                UnitId = req.UnitId,
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
            if (await db.Shifts.AnyAsync(s => s.Id == shift.Id, ct))
            {
                validation.Add(nameof(req.Code), $"Shift {shift.Id} already exists in this unit.");
                return validation.ToBadRequestOrNull()!;
            }

            db.Shifts.Add(shift);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/admin/shifts/{shift.Id}", shift);
        });

        group.MapPut("/{id}", async (string id, ShiftRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var shift = await db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
            if (shift is null) return AdminValidation.NotFound("shift", id);

            shift.UnitId = req.UnitId;
            shift.Code = req.Code;
            shift.Label = req.Label;
            shift.Description = req.Description;
            shift.Color = req.Color;
            shift.Hotkey = req.Hotkey;
            shift.TimeZone = req.TimeZone;
            shift.Start = req.Start;
            shift.End = req.End;
            shift.CrossesMidnight = req.CrossesMidnight;
            shift.BreakMinutes = req.BreakMinutes;
            shift.CountsAsCoverage = req.CountsAsCoverage;
            shift.EditableTime = req.EditableTime;
            await db.SaveChangesAsync(ct);
            return Results.Ok(shift);
        });

        group.MapDelete("/{id}", async (string id, ScheduleDbContext db, CancellationToken ct) =>
        {
            var shift = await db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
            if (shift is null) return AdminValidation.NotFound("shift", id);

            var inUse = await db.Assignments.AnyAsync(a => a.ShiftId == id, ct)
                || await db.ShiftRequirements.AnyAsync(r => r.ShiftId == id, ct)
                || await db.ShiftEligibilities.AnyAsync(e => e.ShiftId == id, ct);
            if (inUse) return AdminValidation.Conflict("SHIFT_IN_USE", $"Shift {id} is used by assignments, requirements or eligibility.");

            db.Shifts.Remove(shift);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    private static async Task<AdminValidation> ValidateAsync(ShiftRequest req, ScheduleDbContext db, CancellationToken ct)
    {
        var v = new AdminValidation();
        v.Require(nameof(req.UnitId), req.UnitId);
        v.Require(nameof(req.Code), req.Code);
        v.Require(nameof(req.Label), req.Label);
        v.Require(nameof(req.Color), req.Color);
        v.Require(nameof(req.TimeZone), req.TimeZone);
        v.Check(nameof(req.BreakMinutes), req.BreakMinutes >= 0, "must be zero or greater.");
        if (!string.IsNullOrWhiteSpace(req.UnitId) && !await db.PlanningUnits.AnyAsync(u => u.Id == req.UnitId, ct))
            v.Add(nameof(req.UnitId), $"Unit {req.UnitId} does not exist.");
        return v;
    }
}
