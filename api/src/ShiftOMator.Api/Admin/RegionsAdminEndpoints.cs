using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>
/// Region: the rule boundary (ADR-0020). No create/delete — the three regions
/// (AMER/EMEA/APAC) are structural, referenced by role/shift/day-config FKs and by the
/// seed; only their editable attributes (name, timezone, primary location, member
/// locations, comp-off policy) are in-place.
/// </summary>
public static class RegionsAdminEndpoints
{
    public record CompOffPolicyRequest(
        int WindowBeforeDays, int WindowAfterDays, List<IsoWeekday> ExcludedWeekdays,
        int AgingThresholdDays, bool RequiresApprovalWhenNoSlot);

    public record RegionRequest(
        string Name, string PrimaryTimeZone, string PrimaryLocationId,
        List<string> LocationIds, CompOffPolicyRequest CompOffPolicy);

    public static void MapRegionsAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/regions").RequireAuthorization(AuthPolicies.AdminOnly);

        group.MapGet("/", async (ScheduleDbContext db, CancellationToken ct) =>
            Results.Ok(await db.Regions.AsNoTracking().OrderBy(r => r.Id).ToListAsync(ct)));

        group.MapPut("/{id}", async (string id, RegionRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var region = await db.Regions.FirstOrDefaultAsync(r => r.Id == id, ct);
            if (region is null) return AdminValidation.NotFound("region", id);

            region.Name = req.Name;
            region.PrimaryTimeZone = req.PrimaryTimeZone;
            region.PrimaryLocationId = req.PrimaryLocationId;
            region.LocationIds = req.LocationIds;
            region.CompOffPolicy = new CompOffPolicy
            {
                WindowBeforeDays = req.CompOffPolicy.WindowBeforeDays,
                WindowAfterDays = req.CompOffPolicy.WindowAfterDays,
                ExcludedWeekdays = req.CompOffPolicy.ExcludedWeekdays,
                AgingThresholdDays = req.CompOffPolicy.AgingThresholdDays,
                RequiresApprovalWhenNoSlot = req.CompOffPolicy.RequiresApprovalWhenNoSlot,
            };
            await db.SaveChangesAsync(ct);
            return Results.Ok(region);
        });
    }

    private static async Task<AdminValidation> ValidateAsync(RegionRequest req, ScheduleDbContext db, CancellationToken ct)
    {
        var v = new AdminValidation();
        v.Require(nameof(req.Name), req.Name);
        v.Require(nameof(req.PrimaryTimeZone), req.PrimaryTimeZone);
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
