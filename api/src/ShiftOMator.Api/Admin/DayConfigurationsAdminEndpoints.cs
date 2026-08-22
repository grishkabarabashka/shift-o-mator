using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Application;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>
/// DayConfiguration: the one entity with a real effective-dated resolver already wired
/// into Coverage/Timeline (<see cref="DayConfigurationResolver"/>, ADR-0021). Structural
/// fields (Key, Weekdays, Date, RoleRequirements, EffectiveFrom) are therefore
/// **create-only** — there is no PUT for them, on purpose: <c>Resolve</c> always picks
/// the latest applicable EffectiveFrom, so a new row with tomorrow's date is the only
/// edit action and old coverage stays untouched by construction. Only <c>Label</c> is
/// mutated in place (display text, not a rule).
/// </summary>
public static class DayConfigurationsAdminEndpoints
{
    public record RoleRequirementRequest(
        string RoleId, int Min, int? Max, bool IsDefault,
        TimeOnly? TimingOverrideStart, TimeOnly? TimingOverrideEnd, bool? TimingOverrideCrossesMidnight);

    public record NewVersionRequest(
        string RegionId, DayConfigKey Key, List<IsoWeekday> Weekdays, DateOnly? Date,
        string? Label, DateOnly EffectiveFrom, List<RoleRequirementRequest> RoleRequirements);

    public record LabelRequest(string? Label);

    public static void MapDayConfigurationsAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/day-configurations").RequireAuthorization(AuthPolicies.AdminOnly);

        // Full history, not just the currently-effective row — the UI needs every
        // version to render the timeline the plan calls for.
        group.MapGet("/", async (ScheduleDbContext db, CancellationToken ct) =>
            Results.Ok(await db.DayConfigurations.AsNoTracking()
                .Include(c => c.RoleRequirements)
                .OrderBy(c => c.RegionId).ThenBy(c => c.Key).ThenBy(c => c.EffectiveFrom)
                .ToListAsync(ct)));

        group.MapPost("/", async (NewVersionRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var configId = $"dc-{Guid.NewGuid():N}";
            var config = new DayConfiguration
            {
                Id = configId,
                RegionId = req.RegionId,
                Key = req.Key,
                Weekdays = req.Weekdays,
                Date = req.Key == DayConfigKey.Date ? req.Date : null,
                Label = req.Label,
                EffectiveFrom = req.EffectiveFrom,
                RoleRequirements = req.RoleRequirements.Select(r => new RoleRequirement
                {
                    DayConfigurationId = configId,
                    RoleId = r.RoleId,
                    Min = r.Min,
                    Max = r.Max,
                    IsDefault = r.IsDefault,
                    TimingOverrideStart = r.TimingOverrideStart,
                    TimingOverrideEnd = r.TimingOverrideEnd,
                    TimingOverrideCrossesMidnight = r.TimingOverrideCrossesMidnight,
                }).ToList(),
            };

            db.DayConfigurations.Add(config);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/admin/day-configurations/{config.Id}", config);
        });

        group.MapPut("/{id}/label", async (string id, LabelRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var config = await db.DayConfigurations.Include(c => c.RoleRequirements).FirstOrDefaultAsync(c => c.Id == id, ct);
            if (config is null) return AdminValidation.NotFound("day-configuration", id);

            config.Label = req.Label;
            await db.SaveChangesAsync(ct);
            return Results.Ok(config);
        });

        // Undo for a version that has not taken effect yet — deleting anything already
        // in force would be the in-place-repaint ADR-0021 exists to prevent.
        group.MapDelete("/{id}", async (string id, ScheduleDbContext db, CancellationToken ct) =>
        {
            var config = await db.DayConfigurations.FirstOrDefaultAsync(c => c.Id == id, ct);
            if (config is null) return AdminValidation.NotFound("day-configuration", id);

            if (config.EffectiveFrom <= DateOnly.FromDateTime(DateTime.UtcNow))
                return AdminValidation.Conflict(
                    "DAY_CONFIGURATION_ALREADY_EFFECTIVE",
                    $"Day configuration {id} took effect on {config.EffectiveFrom:yyyy-MM-dd} and is history now — create a new version instead of deleting it.");

            db.DayConfigurations.Remove(config);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    private static async Task<AdminValidation> ValidateAsync(NewVersionRequest req, ScheduleDbContext db, CancellationToken ct)
    {
        var v = new AdminValidation();
        v.Require(nameof(req.RegionId), req.RegionId);
        if (!string.IsNullOrWhiteSpace(req.RegionId) && !await db.Regions.AnyAsync(r => r.Id == req.RegionId, ct))
            v.Add(nameof(req.RegionId), $"Region {req.RegionId} does not exist.");

        if (req.Key == DayConfigKey.Date)
            v.Require(nameof(req.Date), req.Date, "is required when key is Date.");
        else
            v.Check(nameof(req.Weekdays), req.Weekdays is { Count: > 0 }, "must include at least one weekday.");

        v.Check(nameof(req.RoleRequirements), req.RoleRequirements is { Count: > 0 }, "must include at least one role.");
        foreach (var (r, i) in req.RoleRequirements.Select((r, i) => (r, i)))
        {
            var field = $"{nameof(req.RoleRequirements)}[{i}]";
            v.Require($"{field}.roleId", r.RoleId);
            v.Check($"{field}.min", r.Min >= 0, "must be zero or greater.");
            if (r.Max is { } max) v.Check($"{field}.max", max >= r.Min, "must be at least min.");
            if (!string.IsNullOrWhiteSpace(r.RoleId)
                && !string.IsNullOrWhiteSpace(req.RegionId)
                && !await db.Roles.AnyAsync(role => role.Id == r.RoleId && role.RegionId == req.RegionId, ct))
                v.Add($"{field}.roleId", $"Role {r.RoleId} does not belong to region {req.RegionId}.");
        }

        return v;
    }
}
