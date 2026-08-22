using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>
/// ShiftDefinition: the person's contracted window (ADR-0018), distinct from role time.
///
/// Scope note (Phase 6 judgment call): unlike DayConfiguration, neither
/// <see cref="ShiftDefinition"/> nor <see cref="ShiftRole"/> carries an EffectiveFrom
/// today, and nothing resolves "the version in effect on date X" for them — that
/// machinery exists only for day configurations (<c>DayConfigurationResolver</c>), which
/// Coverage/Timeline already call. Retrofitting date-resolution for shifts/roles would
/// mean either threading a resolver through <c>CoverageCalculator</c>/timeline (Phase 3
/// application code, out of this pass's blast radius) or letting Assignment/Eligibility
/// FKs silently point at a stale version. Both are real design work belonging to a
/// dedicated pass, not a Phase 6 CRUD sweep. Shifts and roles are therefore edited
/// in-place here; only <c>day-configurations</c> gets the create-new-version treatment
/// this phase, which is also the one the acceptance criterion in the plan exercises.
/// </summary>
public static class ShiftsAdminEndpoints
{
    public record ShiftRequest(
        string RegionId, string Code, string Name, string TimeZone,
        TimeOnly Start, TimeOnly End, bool CrossesMidnight, int BreakMinutes);

    public static void MapShiftsAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/shifts").RequireAuthorization(AuthPolicies.AdminOnly);

        group.MapGet("/", async (ScheduleDbContext db, CancellationToken ct) =>
            Results.Ok(await db.Shifts.AsNoTracking().OrderBy(s => s.Id).ToListAsync(ct)));

        group.MapPost("/", async (ShiftRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var shift = new ShiftDefinition
            {
                Id = $"shift-{Guid.NewGuid():N}",
                RegionId = req.RegionId,
                Code = req.Code,
                Name = req.Name,
                TimeZone = req.TimeZone,
                Start = req.Start,
                End = req.End,
                CrossesMidnight = req.CrossesMidnight,
                BreakMinutes = req.BreakMinutes,
            };
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

            shift.RegionId = req.RegionId;
            shift.Code = req.Code;
            shift.Name = req.Name;
            shift.TimeZone = req.TimeZone;
            shift.Start = req.Start;
            shift.End = req.End;
            shift.CrossesMidnight = req.CrossesMidnight;
            shift.BreakMinutes = req.BreakMinutes;
            await db.SaveChangesAsync(ct);
            return Results.Ok(shift);
        });

        group.MapDelete("/{id}", async (string id, ScheduleDbContext db, CancellationToken ct) =>
        {
            var shift = await db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
            if (shift is null) return AdminValidation.NotFound("shift", id);

            var inUse = await db.People.AnyAsync(p => p.DefaultShiftId == id, ct);
            if (inUse) return AdminValidation.Conflict("SHIFT_IN_USE", $"Shift {id} is still someone's default shift.");

            db.Shifts.Remove(shift);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    private static async Task<AdminValidation> ValidateAsync(ShiftRequest req, ScheduleDbContext db, CancellationToken ct)
    {
        var v = new AdminValidation();
        v.Require(nameof(req.RegionId), req.RegionId);
        v.Require(nameof(req.Code), req.Code);
        v.Require(nameof(req.Name), req.Name);
        v.Require(nameof(req.TimeZone), req.TimeZone);
        v.Check(nameof(req.BreakMinutes), req.BreakMinutes >= 0, "must be zero or greater.");
        if (!string.IsNullOrWhiteSpace(req.RegionId) && !await db.Regions.AnyAsync(r => r.Id == req.RegionId, ct))
            v.Add(nameof(req.RegionId), $"Region {req.RegionId} does not exist.");
        return v;
    }
}
