using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>Per-region, per-role-pool absence limits (ADR-0010, owner-confirmed
/// defaults). Fully in-place — a limit is a setting, not a historical fact.</summary>
public static class AbsenceCapacityRulesAdminEndpoints
{
    public record RuleRequest(
        string RegionId, AbsenceCapacityScopeKind ScopeKind, string? ScopeRoleId,
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
                RegionId = req.RegionId,
                ScopeKind = req.ScopeKind,
                ScopeRoleId = req.ScopeKind == AbsenceCapacityScopeKind.RolePool ? req.ScopeRoleId : null,
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

            rule.RegionId = req.RegionId;
            rule.ScopeKind = req.ScopeKind;
            rule.ScopeRoleId = req.ScopeKind == AbsenceCapacityScopeKind.RolePool ? req.ScopeRoleId : null;
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
        v.Require(nameof(req.RegionId), req.RegionId);
        if (!string.IsNullOrWhiteSpace(req.RegionId) && !await db.Regions.AnyAsync(r => r.Id == req.RegionId, ct))
            v.Add(nameof(req.RegionId), $"Region {req.RegionId} does not exist.");
        v.Check(nameof(req.MaxConcurrent), req.MaxConcurrent >= 0, "must be zero or greater.");
        v.Check(nameof(req.LongThresholdWorkdays), req.LongThresholdWorkdays >= 0, "must be zero or greater.");
        if (req.ScopeKind == AbsenceCapacityScopeKind.RolePool)
        {
            v.Require(nameof(req.ScopeRoleId), req.ScopeRoleId, "is required when scope is RolePool.");
            if (!string.IsNullOrWhiteSpace(req.ScopeRoleId) && !await db.Roles.AnyAsync(r => r.Id == req.ScopeRoleId, ct))
                v.Add(nameof(req.ScopeRoleId), $"Role {req.ScopeRoleId} does not exist.");
        }
        return v;
    }
}
