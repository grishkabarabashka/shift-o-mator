using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Admin;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Application;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>
/// DayConfiguration: the one entity with a real effective-dated resolver already wired
/// into Coverage/Timeline (<see cref="DayConfigurationResolver"/>, ADR-0021). Structural
/// fields (Key, Weekdays, Date, ShiftRequirements, EffectiveFrom) are therefore
/// **create-only** — there is no PUT for them, on purpose: <c>Resolve</c> always picks
/// the latest applicable EffectiveFrom, so a new row with tomorrow's date is the only
/// edit action and old coverage stays untouched by construction. Only <c>Label</c> is
/// mutated in place (display text, not a rule).
/// </summary>
public static class DayConfigurationsAdminEndpoints
{
    public static void MapDayConfigurationsAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/day-configurations").RequireAuthorization(AuthPolicies.AdminSomewhere);

        // Full history, not just the currently-effective row — the UI needs every
        // version to render the timeline the plan calls for.
        group.MapGet("/", async (ShiftOMatorDbContext db, CancellationToken ct) =>
            Results.Ok(await db.DayConfigurations.AsNoTracking()
                .Include(c => c.ShiftRequirements)
                .OrderBy(c => c.UnitId).ThenBy(c => c.Key).ThenBy(c => c.EffectiveFrom)
                .ToListAsync(ct)))
            .Produces<IReadOnlyList<DayConfiguration>>();

        group.MapPost("/", async (DayConfigurationNewVersionRequest req, ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var configId = $"dc-{Guid.NewGuid():N}";
            var config = new DayConfiguration
            {
                Id = configId,
                UnitId = req.UnitId,
                Key = req.Key,
                Weekdays = req.Weekdays,
                Date = req.Key == DayConfigKey.Date ? req.Date : null,
                Label = req.Label,
                EffectiveFrom = req.EffectiveFrom,
                ShiftRequirements = req.ShiftRequirements.Select(r => new ShiftRequirement
                {
                    DayConfigurationId = configId,
                    ShiftId = r.ShiftId,
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
        })
        .Produces<DayConfiguration>(StatusCodes.Status201Created)
        .Produces<ValidationErrorResponse>(StatusCodes.Status400BadRequest);

        group.MapPut("/{id}/label", async (string id, DayConfigurationLabelRequest req, ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var config = await db.DayConfigurations.Include(c => c.ShiftRequirements).FirstOrDefaultAsync(c => c.Id == id, ct);
            if (config is null) return AdminValidation.NotFound("day-configuration", id);

            config.Label = req.Label;
            await db.SaveChangesAsync(ct);
            return Results.Ok(config);
        })
        .Produces<DayConfiguration>()
        .Produces(StatusCodes.Status404NotFound);

        // Undo for a version that has not taken effect yet — deleting anything already
        // in force would be the in-place-repaint ADR-0021 exists to prevent.
        group.MapDelete("/{id}", async (string id, ShiftOMatorDbContext db, CancellationToken ct) =>
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
        })
        .Produces(StatusCodes.Status204NoContent)
        .Produces(StatusCodes.Status404NotFound)
        .Produces(StatusCodes.Status409Conflict);
    }

    private static async Task<AdminValidation> ValidateAsync(DayConfigurationNewVersionRequest req, ShiftOMatorDbContext db, CancellationToken ct)
    {
        var v = new AdminValidation();
        v.Require(nameof(req.UnitId), req.UnitId);
        if (!string.IsNullOrWhiteSpace(req.UnitId) && !await db.PlanningUnits.AnyAsync(u => u.Id == req.UnitId, ct))
            v.Add(nameof(req.UnitId), $"Unit {req.UnitId} does not exist.");

        if (req.Key == DayConfigKey.Date)
            v.Require(nameof(req.Date), req.Date, "is required when key is Date.");
        else
            v.Check(nameof(req.Weekdays), req.Weekdays is { Count: > 0 }, "must include at least one weekday.");

        v.Check(nameof(req.ShiftRequirements), req.ShiftRequirements is { Count: > 0 }, "must include at least one shift.");
        foreach (var (r, i) in req.ShiftRequirements.Select((r, i) => (r, i)))
        {
            var field = $"{nameof(req.ShiftRequirements)}[{i}]";
            v.Require($"{field}.shiftId", r.ShiftId);
            v.Check($"{field}.min", r.Min >= 0, "must be zero or greater.");
            if (r.Max is { } max) v.Check($"{field}.max", max >= r.Min, "must be at least min.");
            if (!string.IsNullOrWhiteSpace(r.ShiftId)
                && !string.IsNullOrWhiteSpace(req.UnitId)
                && !await db.Shifts.AnyAsync(shift => shift.Id == r.ShiftId && shift.UnitId == req.UnitId, ct))
                v.Add($"{field}.shiftId", $"Shift {r.ShiftId} does not belong to unit {req.UnitId}.");
        }

        return v;
    }
}
