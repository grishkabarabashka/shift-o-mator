using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>Per-region, per-shift-pool absence limits (ADR-0010, owner-confirmed
/// defaults). Fully in-place — a limit is a setting, not a historical fact.</summary>
public static class AbsenceCapacityRulesAdminEndpoints
{
    public record RuleRequest(
        string UnitId, AbsenceCapacityScopeKind ScopeKind, string? ScopeShiftId,
        AbsenceDurationBucket DurationBucket, int LongThresholdWorkdays, int MaxConcurrent,
        List<AbsenceType> CountsTypes, bool CountsCompDays);

    public static void MapAbsenceCapacityRulesAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/absence-capacity-rules").RequireAuthorization(AuthPolicies.AdminOnly);

        group.MapGet("/", async (ScheduleDbContext db, CancellationToken ct) =>
            Results.Ok(await db.AbsenceCapacityRules.AsNoTracking().OrderBy(r => r.Id).ToListAsync(ct)));

        group.MapPost("/", async (RuleRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var rule = new AbsenceCapacityRule
            {
                Id = $"acr-{Guid.NewGuid():N}",
                UnitId = req.UnitId,
                ScopeKind = req.ScopeKind,
                ScopeShiftId = req.ScopeKind == AbsenceCapacityScopeKind.ShiftPool ? req.ScopeShiftId : null,
                DurationBucket = req.DurationBucket,
                LongThresholdWorkdays = req.LongThresholdWorkdays,
                MaxConcurrent = req.MaxConcurrent,
                CountsTypes = req.CountsTypes,
                CountsCompDays = req.CountsCompDays,
            };
            db.AbsenceCapacityRules.Add(rule);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/admin/absence-capacity-rules/{rule.Id}", rule);
        });

        group.MapPut("/{id}", async (string id, RuleRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var rule = await db.AbsenceCapacityRules.FirstOrDefaultAsync(r => r.Id == id, ct);
            if (rule is null) return AdminValidation.NotFound("absence-capacity-rule", id);

            rule.UnitId = req.UnitId;
            rule.ScopeKind = req.ScopeKind;
            rule.ScopeShiftId = req.ScopeKind == AbsenceCapacityScopeKind.ShiftPool ? req.ScopeShiftId : null;
            rule.DurationBucket = req.DurationBucket;
            rule.LongThresholdWorkdays = req.LongThresholdWorkdays;
            rule.MaxConcurrent = req.MaxConcurrent;
            rule.CountsTypes = req.CountsTypes;
            rule.CountsCompDays = req.CountsCompDays;
            await db.SaveChangesAsync(ct);
            return Results.Ok(rule);
        });

        group.MapDelete("/{id}", async (string id, ScheduleDbContext db, CancellationToken ct) =>
        {
            var rule = await db.AbsenceCapacityRules.FirstOrDefaultAsync(r => r.Id == id, ct);
            if (rule is null) return AdminValidation.NotFound("absence-capacity-rule", id);

            db.AbsenceCapacityRules.Remove(rule);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    private static async Task<AdminValidation> ValidateAsync(RuleRequest req, ScheduleDbContext db, CancellationToken ct)
    {
        var v = new AdminValidation();
        v.Require(nameof(req.UnitId), req.UnitId);
        if (!string.IsNullOrWhiteSpace(req.UnitId) && !await db.PlanningUnits.AnyAsync(u => u.Id == req.UnitId, ct))
            v.Add(nameof(req.UnitId), $"Unit {req.UnitId} does not exist.");
        v.Check(nameof(req.MaxConcurrent), req.MaxConcurrent >= 0, "must be zero or greater.");
        v.Check(nameof(req.LongThresholdWorkdays), req.LongThresholdWorkdays >= 0, "must be zero or greater.");
        if (req.ScopeKind == AbsenceCapacityScopeKind.ShiftPool)
        {
            v.Require(nameof(req.ScopeShiftId), req.ScopeShiftId, "is required when scope is ShiftPool.");
            if (!string.IsNullOrWhiteSpace(req.ScopeShiftId) && !await db.Shifts.AnyAsync(r => r.Id == req.ScopeShiftId, ct))
                v.Add(nameof(req.ScopeShiftId), $"Role {req.ScopeShiftId} does not exist.");
        }
        return v;
    }
}
